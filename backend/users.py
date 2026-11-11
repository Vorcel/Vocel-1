"""Usuários internos da conta (Configurações › Usuários).

Somente o USUÁRIO PRINCIPAL (dono da conta) acessa estas rotas — a checagem
fica na tabela central (permissions.RULES: OWNER_ONLY) e é repetida aqui
(`_owner_only`) como segunda barreira.

Regras:
- Usuário interno nasce SEMPRE dentro da conta de quem o cria
  (`account_owner_id` = principal autenticado; nunca vem do corpo).
- Login único no sistema, normalizado (trim + minúsculas), sem e-mail.
- Senha só como hash bcrypt; nunca é devolvida, registrada ou exibida de novo.
- Sem exclusão física: o caminho é inativar (preserva a auditoria).
- Redefinir senha, inativar, trocar login ou "encerrar sessões" incrementam
  `token_version` → tokens antigos deixam de valer na próxima requisição.
- O principal não aparece como editável aqui: não dá para inativá-lo,
  rebaixá-lo nem redefinir a senha dele por esta tela."""
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from auth import (INTERNAL, MAX_PASSWORD, audit, get_current_user, hash_password, public_user,
                  validate_login, validate_password)
from db import db, now_iso
from permissions import CATALOG, normalize_permissions

users_router = APIRouter(prefix="/api/users", tags=["users"])


def _owner_only(current: dict) -> None:
    if not current.get("is_owner"):
        raise HTTPException(status_code=403, detail={"code": "forbidden", "msg": "Acesso restrito ao administrador da conta."})


class UserCreate(BaseModel):
    model_config = {"extra": "forbid"}   # nada de is_owner/account_id/permissions=["*"] escondidos
    name: str = Field(max_length=120)
    login: str = Field(max_length=64)
    password: str = Field(max_length=MAX_PASSWORD)
    active: bool = True
    permissions: List[str] = Field(default_factory=list, max_length=200)


class UserUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(default=None, max_length=120)
    login: Optional[str] = Field(default=None, max_length=64)
    active: Optional[bool] = None
    permissions: Optional[List[str]] = Field(default=None, max_length=200)


class PasswordReset(BaseModel):
    model_config = {"extra": "forbid"}
    password: str = Field(max_length=MAX_PASSWORD)


def _out(u: dict) -> dict:
    out = public_user(u)
    out["permissions"] = sorted(u.get("permissions") or []) if u.get("user_type") == INTERNAL else ["*"]
    return out


async def _require_member(current: dict, user_id: str) -> dict:
    """Usuário interno DESTA conta (outro id/conta => 404, sem revelar existência)."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    u = await db.users.find_one({"_id": oid, "user_type": INTERNAL, "account_owner_id": current["id"]})
    if not u:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return u


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome.")
    return name


async def _login_taken(login: str, except_id=None) -> bool:
    q = {"login": login}
    if except_id is not None:
        q["_id"] = {"$ne": except_id}
    return bool(await db.users.find_one(q, {"_id": 1}))


@users_router.get("/permissions-catalog")
async def permissions_catalog(current=Depends(get_current_user)):
    _owner_only(current)
    return {"groups": [
        {"group": g["group"], "modules": [
            {"id": m["id"], "label": m["label"],
             "actions": [{"key": k, "label": label} for k, label in m["actions"]]}
            for m in g["modules"]]}
        for g in CATALOG]}


@users_router.get("")
async def list_users(current=Depends(get_current_user)):
    _owner_only(current)
    owner = await db.users.find_one({"_id": ObjectId(current["id"])})
    members = await db.users.find({"user_type": INTERNAL, "account_owner_id": current["id"]}) \
        .sort("created_at", 1).to_list(500)
    return {"owner": public_user(owner), "users": [_out(u) for u in members]}


@users_router.post("")
async def create_user(body: UserCreate, current=Depends(get_current_user)):
    _owner_only(current)
    name = _clean_name(body.name)
    login = validate_login(body.login)
    validate_password(body.password)
    perms = normalize_permissions(body.permissions)
    if await _login_taken(login):
        raise HTTPException(status_code=409, detail="Este login já está em uso. Escolha outro.")
    ts = now_iso()
    doc = {
        "name": name, "login": login, "password_hash": hash_password(body.password),
        "user_type": INTERNAL, "account_owner_id": current["id"],
        "active": bool(body.active), "permissions": perms, "token_version": 0,
        "phone": "", "cargo": "", "avatar_url": "",
        "created_at": ts, "updated_at": ts, "created_by": current["actor_id"], "last_login_at": None,
    }
    try:
        res = await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Este login já está em uso. Escolha outro.")
    doc["_id"] = res.inserted_id
    await audit(current, "usuario_criado", entity_id=str(res.inserted_id), entity_label=name,
                metadata={"login": login, "ativo": doc["active"], "permissoes": perms})
    return _out(doc)


@users_router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, current=Depends(get_current_user)):
    _owner_only(current)
    u = await _require_member(current, user_id)
    sent = body.model_fields_set
    updates: dict = {}
    changes = []
    bump = False
    if "name" in sent and body.name is not None:
        name = _clean_name(body.name)
        if name != u.get("name"):
            updates["name"] = name
            changes.append({"field": "name", "label": "Nome", "before": u.get("name"), "after": name})
    if "login" in sent and body.login is not None:
        login = validate_login(body.login)
        if login != u.get("login"):
            if await _login_taken(login, u["_id"]):
                raise HTTPException(status_code=409, detail="Este login já está em uso. Escolha outro.")
            updates["login"] = login
            changes.append({"field": "login", "label": "Login", "before": u.get("login"), "after": login})
            bump = True
    if "active" in sent and body.active is not None and bool(body.active) != (u.get("active", True) is not False):
        updates["active"] = bool(body.active)
        changes.append({"field": "active", "label": "Status", "before": "Ativo" if u.get("active", True) else "Inativo",
                        "after": "Ativo" if body.active else "Inativo"})
        if not body.active:
            bump = True
    perms_before = sorted(u.get("permissions") or [])
    perms_after = None
    if "permissions" in sent and body.permissions is not None:
        perms_after = normalize_permissions(body.permissions)
        if perms_after != perms_before:
            updates["permissions"] = perms_after
    if not updates:
        return _out(u)
    updates["updated_at"] = now_iso()
    op = {"$set": updates}
    if bump:
        op["$inc"] = {"token_version": 1}
    try:
        await db.users.update_one({"_id": u["_id"]}, op)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Este login já está em uso. Escolha outro.")
    label = updates.get("name") or u.get("name")
    if changes:
        action = "usuario_desativado" if updates.get("active") is False else (
            "usuario_ativado" if updates.get("active") is True else "usuario_editado")
        await audit(current, action, entity_id=user_id, entity_label=label, changes=changes,
                    metadata={"login": updates.get("login") or u.get("login"), "sessoes_encerradas": bump})
    if "permissions" in updates:
        add = sorted(set(perms_after) - set(perms_before))
        rem = sorted(set(perms_before) - set(perms_after))
        await audit(current, "permissoes_alteradas", entity_id=user_id, entity_label=label,
                    metadata={"login": updates.get("login") or u.get("login"), "concedidas": add, "removidas": rem})
    return _out(await db.users.find_one({"_id": u["_id"]}))


@users_router.post("/{user_id}/reset-password")
async def reset_password(user_id: str, body: PasswordReset, current=Depends(get_current_user)):
    _owner_only(current)
    u = await _require_member(current, user_id)
    validate_password(body.password)
    await db.users.update_one({"_id": u["_id"]}, {
        "$set": {"password_hash": hash_password(body.password), "updated_at": now_iso()},
        "$inc": {"token_version": 1}})
    await audit(current, "senha_redefinida", entity_id=user_id, entity_label=u.get("name"),
                metadata={"login": u.get("login"), "descricao": "Senha redefinida pelo administrador."})
    return {"message": "Senha redefinida. As sessões abertas deste usuário foram encerradas."}


@users_router.post("/{user_id}/revoke-sessions")
async def revoke_sessions(user_id: str, current=Depends(get_current_user)):
    _owner_only(current)
    u = await _require_member(current, user_id)
    await db.users.update_one({"_id": u["_id"]}, {"$inc": {"token_version": 1}, "$set": {"updated_at": now_iso()}})
    await audit(current, "sessoes_encerradas", entity_id=user_id, entity_label=u.get("name"),
                metadata={"login": u.get("login")})
    return {"message": "Sessões encerradas."}
