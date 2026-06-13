"""Email/password JWT authentication."""
import os
import secrets
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, EmailStr

from db import db, now_iso

JWT_ALGORITHM = "HS256"
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


# ----------------- helpers -----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _public_user(user: dict) -> dict:
    user = dict(user)
    user["id"] = str(user.get("_id", user.get("id")))
    user.pop("_id", None)
    user.pop("password_hash", None)
    return user


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        return _public_user(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


# ----------------- schemas -----------------
class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileInput(BaseModel):
    name: str | None = None
    phone: str | None = None
    cargo: str | None = None
    avatar_url: str | None = None


# ----------------- endpoints -----------------
@auth_router.post("/register")
async def register(body: RegisterInput):
    # Cadastro público DESATIVADO — sistema privado de acesso restrito.
    # Novos usuários só podem ser criados internamente (seed/admin).
    raise HTTPException(status_code=403, detail="Cadastro desativado. Contate o administrador.")


@auth_router.post("/login")
async def login(body: LoginInput):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    token = create_access_token(str(user["_id"]), email)
    return {"token": token, "user": _public_user(user)}


@auth_router.get("/me")
async def me(current=Depends(get_current_user)):
    return current


@auth_router.put("/profile")
async def update_profile(body: UpdateProfileInput, current=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.users.update_one({"_id": ObjectId(current["id"])}, {"$set": updates})
    user = await db.users.find_one({"_id": ObjectId(current["id"])})
    return _public_user(user)


@auth_router.post("/change-password")
async def change_password(body: ChangePasswordInput, current=Depends(get_current_user)):
    user = await db.users.find_one({"_id": ObjectId(current["id"])})
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    await db.users.update_one(
        {"_id": ObjectId(current["id"])},
        {"$set": {"password_hash": hash_password(body.new_password)}},
    )
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
