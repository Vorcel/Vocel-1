"""Autenticação JWT: usuário principal (e-mail) + usuários internos (login).

- Principal (dono da conta): entra com e-mail + senha, como sempre.
- Usuário interno: entra com LOGIN + senha (sem e-mail). Pertence à conta do
  principal (`account_owner_id`) e só faz o que as permissões dele permitem
  (ver permissions.py).

`get_current_user` devolve o PRINCIPAL EFETIVO da requisição:
    id            = dono dos dados (o principal da conta) — chave de owner_id
    actor_id      = quem está agindo (o próprio principal ou o usuário interno)
    actor_name / actor_login, is_owner, permissions
Assim todas as consultas existentes por owner_id continuam iguais e a
auditoria registra o usuário real.

Revogação imediata: o JWT carrega `tv` (token_version). Redefinir senha,
desativar, encerrar sessões ou trocar o login incrementa a versão no banco e
todo token anterior passa a ser recusado na próxima requisição. Status e
permissões são lidos do banco A CADA requisição (nunca do token)."""
import os
import re
import time
import logging
from collections import defaultdict, deque
from typing import Optional
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field
from starlette.requests import HTTPConnection

from db import db, now_iso

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

INTERNAL = "internal"
MIN_PASSWORD = 8
MAX_PASSWORD = 128
LOGIN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")   # 2–32: letras, números, ponto, hífen, sublinhado


# ----------------- helpers -----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# Hash fixo para gastar o mesmo tempo quando o login não existe (evita enumeração por tempo).
_DUMMY_HASH = hash_password("vorcel-dummy-password")


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def normalize_login(value: str) -> str:
    return (value or "").strip().lower()


def validate_login(value: str) -> str:
    login = normalize_login(value)
    if not LOGIN_RE.match(login):
        raise HTTPException(status_code=400, detail=(
            "Login inválido: use de 2 a 32 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado), "
            "começando por letra ou número."))
    return login


def validate_password(value: str) -> str:
    if not isinstance(value, str) or len(value) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"A senha deve ter pelo menos {MIN_PASSWORD} caracteres.")
    if len(value) > MAX_PASSWORD:
        raise HTTPException(status_code=400, detail=f"A senha deve ter no máximo {MAX_PASSWORD} caracteres.")
    return value


def create_access_token(user_id: str, email: Optional[str] = None, token_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "tv": int(token_version or 0),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    if email:
        payload["email"] = email
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def is_internal(user: dict) -> bool:
    return user.get("user_type") == INTERNAL


def public_user(user: dict) -> dict:
    """Perfil seguro para o frontend — nunca devolve hash nem versão de token."""
    out = {
        "id": str(user.get("_id", user.get("id"))),
        "name": user.get("name") or "",
        "email": user.get("email") or "",
        "login": user.get("login") or "",
        "phone": user.get("phone") or "",
        "cargo": user.get("cargo") or "",
        "avatar_url": user.get("avatar_url") or "",
        "user_type": INTERNAL if is_internal(user) else "owner",
        "active": user.get("active", True) is not False,
        "created_at": user.get("created_at"),
        "last_login_at": user.get("last_login_at"),
    }
    return out


# Compat: módulos antigos importam `_public_user`.
_public_user = public_user


def _decode(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "access" or not payload.get("sub"):
        return None
    return payload


async def _principal(payload: dict) -> dict:
    """Valida usuário/conta/versão do token e monta o principal efetivo.
    Levanta 401 em qualquer falha (token antigo, usuário inativo, conta inativa)."""
    from permissions import ALL_KEYS
    try:
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    except Exception:
        user = None
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    if int(user.get("token_version") or 0) != int(payload.get("tv") or 0):
        raise HTTPException(status_code=401, detail="Sessão encerrada. Entre novamente.")
    if user.get("active", True) is False:
        raise HTTPException(status_code=401, detail="Usuário inativo. Contate o administrador.")

    actor = public_user(user)
    if is_internal(user):
        try:
            owner = await db.users.find_one({"_id": ObjectId(user.get("account_owner_id"))})
        except Exception:
            owner = None
        if not owner or is_internal(owner) or owner.get("active", True) is False:
            raise HTTPException(status_code=401, detail="Conta indisponível. Contate o administrador.")
        owner_id = str(owner["_id"])
        # Chave desconhecida nunca vira acesso (deny by default).
        perms = sorted(k for k in (user.get("permissions") or []) if k in ALL_KEYS)
        is_owner = False
        account_name = owner.get("name") or ""
    else:
        owner_id = actor["id"]
        perms = sorted(ALL_KEYS)
        is_owner = True
        account_name = actor["name"]

    return {
        **actor,
        # `id` = DONO DOS DADOS. Todo o código existente usa current["id"] como owner_id.
        "id": owner_id,
        "account_id": owner_id,
        "account_name": account_name,
        "actor_id": actor["id"],
        "actor_name": actor["name"] or actor["login"] or actor["email"],
        "actor_login": actor["login"] or actor["email"],
        "is_owner": is_owner,
        "permissions": perms,
    }


async def principal_from_token(token: Optional[str]) -> Optional[dict]:
    """Para rotas que recebem o token fora do header (download por ?auth=, WebSocket).
    Mesmas validações do get_current_user; None se inválido."""
    payload = _decode(token)
    if not payload:
        return None
    try:
        return await _principal(payload)
    except HTTPException:
        return None


def user_id_from_token(token: str) -> Optional[str]:
    """LEGADO (só decodifica). Não use para autorizar — use principal_from_token."""
    payload = _decode(token)
    return payload.get("sub") if payload else None


async def get_current_user(request: HTTPConnection) -> dict:
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    if payload.get("type") != "access" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Token inválido")
    principal = await _principal(payload)
    request.state.principal = principal
    return principal


# ----------------- rate limit do login -----------------
# Em memória (uma instância no Render). Janela deslizante: muitas falhas seguidas
# para o mesmo login+IP (ou do mesmo IP) bloqueiam por alguns minutos — nunca
# permanentemente. Sucesso zera o contador do login.
WINDOW = 15 * 60
MAX_PER_LOGIN_IP = 8
MAX_PER_IP = 40
_fails: dict = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


def _prune(q: deque, now: float) -> None:
    while q and now - q[0] > WINDOW:
        q.popleft()


def _check_rate(ip: str, ident: str) -> None:
    now = time.time()
    for key, limit in ((f"li:{ident}|{ip}", MAX_PER_LOGIN_IP), (f"ip:{ip}", MAX_PER_IP)):
        q = _fails[key]
        _prune(q, now)
        if len(q) >= limit:
            wait = int(WINDOW - (now - q[0])) // 60 + 1
            raise HTTPException(status_code=429, detail=f"Muitas tentativas. Tente novamente em {wait} min.")


def _register_fail(ip: str, ident: str) -> None:
    now = time.time()
    _fails[f"li:{ident}|{ip}"].append(now)
    _fails[f"ip:{ip}"].append(now)
    if len(_fails) > 10000:   # proteção de memória
        for k in list(_fails)[:5000]:
            _fails.pop(k, None)


def _clear_fail(ip: str, ident: str) -> None:
    _fails.pop(f"li:{ident}|{ip}", None)


# ----------------- schemas -----------------
class LoginInput(BaseModel):
    # O frontend antigo envia `email`; o novo envia `login`. Ambos aceitam e-mail OU login.
    login: Optional[str] = Field(default=None, max_length=254)
    email: Optional[str] = Field(default=None, max_length=254)
    password: str = Field(max_length=MAX_PASSWORD)


class ChangePasswordInput(BaseModel):
    current_password: str = Field(max_length=MAX_PASSWORD)
    new_password: str = Field(max_length=MAX_PASSWORD)


class UpdateProfileInput(BaseModel):
    model_config = {"extra": "ignore"}   # nunca aceita campos de privilégio pelo perfil
    name: Optional[str] = Field(default=None, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    cargo: Optional[str] = Field(default=None, max_length=80)
    avatar_url: Optional[str] = Field(default=None, max_length=300)


async def audit(current: dict, action: str, *, module: str = "usuarios", entity_type: str = "usuario",
                entity_id: str = "", entity_label: str = "", changes: Optional[list] = None,
                metadata: Optional[dict] = None) -> None:
    """Evento no histórico imutável (fin_audit, o mesmo do Financeiro)."""
    from fin_core import log_event
    try:
        await log_event(current, action, module=module, entity_type=entity_type, entity_id=entity_id,
                        entity_label=entity_label, changes=changes, origin="Vorcel", metadata=metadata)
    except Exception as e:  # auditoria nunca derruba a operação principal
        logger.error(f"audit failed ({action}): {e}")


# ----------------- endpoints -----------------
@auth_router.post("/register")
async def register():
    # Cadastro público DESATIVADO — sistema privado de acesso restrito.
    # Usuários internos só nascem pelo administrador autenticado (users.py).
    raise HTTPException(status_code=403, detail="Cadastro desativado. Contate o administrador.")


INVALID = "Login ou senha inválidos."


@auth_router.post("/login")
async def login(body: LoginInput, request: Request):
    ident = normalize_login(body.login or body.email or "")
    ip = _client_ip(request)
    if not ident or not body.password:
        raise HTTPException(status_code=401, detail=INVALID)
    _check_rate(ip, ident)

    if "@" in ident:
        user = await db.users.find_one({"email": ident})
    elif LOGIN_RE.match(ident):
        user = await db.users.find_one({"login": ident, "user_type": INTERNAL})
    else:
        user = None

    ok = verify_password(body.password, user["password_hash"]) if user and user.get("password_hash") \
        else verify_password(body.password, _DUMMY_HASH) and False
    if not user or not ok:
        _register_fail(ip, ident)
        logger.info(f"login failed ip={ip}")
        raise HTTPException(status_code=401, detail=INVALID)

    if user.get("active", True) is False:
        raise HTTPException(status_code=401, detail="Usuário inativo. Contate o administrador.")
    tv = int(user.get("token_version") or 0)
    token = create_access_token(str(user["_id"]), user.get("email"), tv)
    principal = await _principal(_decode(token))   # valida conta do usuário interno
    _clear_fail(ip, ident)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now_iso()}})
    if not principal["is_owner"]:
        await audit(principal, "login_realizado", entity_id=principal["actor_id"],
                    entity_label=principal["actor_name"], metadata={"login": principal["actor_login"]})
    return {"token": token, "user": _me(principal)}


def _me(principal: dict) -> dict:
    """O que o frontend precisa: perfil do ATOR + conta + permissões."""
    return {
        "id": principal["actor_id"],
        "name": principal["name"],
        "email": principal["email"],
        "login": principal["login"],
        "phone": principal["phone"],
        "cargo": principal["cargo"],
        "avatar_url": principal["avatar_url"],
        "user_type": principal["user_type"],
        "is_owner": principal["is_owner"],
        "account_id": principal["account_id"],
        "account_name": principal["account_name"],
        "permissions": principal["permissions"],
    }


@auth_router.get("/me")
async def me(current=Depends(get_current_user)):
    return _me(current)


@auth_router.put("/profile")
async def update_profile(body: UpdateProfileInput, current=Depends(get_current_user)):
    updates = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump().items() if v is not None}
    if "name" in updates and not updates["name"]:
        raise HTTPException(status_code=400, detail="Informe o nome.")
    if updates:
        updates["updated_at"] = now_iso()
        await db.users.update_one({"_id": ObjectId(current["actor_id"])}, {"$set": updates})
    user = await db.users.find_one({"_id": ObjectId(current["actor_id"])})
    return public_user(user)


@auth_router.post("/change-password")
async def change_password(body: ChangePasswordInput, current=Depends(get_current_user)):
    user = await db.users.find_one({"_id": ObjectId(current["actor_id"])})
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    validate_password(body.new_password)
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}},
    )
    if not current["is_owner"]:
        await audit(current, "senha_alterada_pelo_usuario", entity_id=current["actor_id"],
                    entity_label=current["actor_name"])
    return {"message": "Senha alterada com sucesso"}


@auth_router.post("/logout")
async def logout(current=Depends(get_current_user)):
    return {"message": "Logout efetuado"}


async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@licita.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "name": "Administrador",
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "phone": "",
            "cargo": "Gestor",
            "avatar_url": "",
            "created_at": now_iso(),
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )


async def create_user_indexes():
    """Índices de usuários. O índice único de e-mail passa a ser PARCIAL (só quando
    o e-mail existe), porque usuário interno não tem e-mail. Não mexe em dados."""
    info = await db.users.index_information()
    email_idx = info.get("email_1")
    if email_idx and "partialFilterExpression" not in email_idx:
        await db.users.drop_index("email_1")
        email_idx = None
    if not email_idx:
        await db.users.create_index("email", name="email_1", unique=True,
                                    partialFilterExpression={"email": {"$type": "string"}})
    # Login de usuário interno: único NO SISTEMA (o login não informa a conta).
    await db.users.create_index("login", name="login_unique", unique=True,
                                partialFilterExpression={"login": {"$type": "string"}})
    await db.users.create_index("account_owner_id")
