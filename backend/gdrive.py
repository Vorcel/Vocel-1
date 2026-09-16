"""Integração Google Drive / Google Docs — uma conta por usuário.

Mesma forma do `storage.py`: cliente + rotas no mesmo módulo. Aqui, porém, o
Google é uma camada ADICIONAL — o Cloudflare R2 continua sendo o armazenamento
principal das propostas (ver `propostas.py`). Nada neste arquivo substitui o R2.

Segurança:
- Só o `refresh_token` é persistido, **cifrado com Fernet**; o access token vive
  em memória, por request. Nenhum token vai para o frontend nem para log.
- O `state` do OAuth é um JWT curto assinado com o `JWT_SECRET` que já existe —
  é o que amarra o callback (sem header Authorization) ao usuário correto.
- Tudo é filtrado por `owner_id`: a integração de um usuário é invisível e
  inutilizável para os demais.
- Escopo mínimo `drive.file`: o app só enxerga o que ele próprio criou no Drive.
"""
import base64
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from auth import JWT_ALGORITHM, get_current_user, get_jwt_secret
from db import db, now_iso
from routes import uid

logger = logging.getLogger(__name__)

gdrive_router = APIRouter(prefix="/api/integrations/google", tags=["integrations"])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

# drive.file = acesso APENAS aos arquivos/pastas criados por este app.
SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email"

FOLDER_MIME = "application/vnd.google-apps.folder"
GDOC_MIME = "application/vnd.google-apps.document"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MIME = "application/pdf"

DEFAULT_ROOT_FOLDER = "Vorcel"
DEFAULT_FOLDER = "Propostas"

STATE_TTL_MINUTES = 10
HTTP_TIMEOUT = 60.0


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def is_configured() -> bool:
    """A aplicação Google foi configurada no ambiente? Sem isso o backend sobe
    normalmente e a tela mostra 'Integração não configurada'."""
    return bool(_env("GOOGLE_CLIENT_ID") and _env("GOOGLE_CLIENT_SECRET") and _env("GOOGLE_REDIRECT_URI"))


def frontend_url() -> str:
    return _env("FRONTEND_URL") or "http://localhost:3000"


# ----------------- erros -----------------
class GoogleError(Exception):
    """Falha da integração. `code` orienta a mensagem mostrada na tela."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code          # not_connected | no_folder | not_found | unauthorized | unavailable
        self.message = message or code


# ----------------- cifragem do refresh token -----------------
def _fernet() -> Fernet:
    """Chave dedicada (TOKEN_ENCRYPTION_KEY) ou derivada do JWT_SECRET."""
    key = _env("TOKEN_ENCRYPTION_KEY")
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(get_jwt_secret().encode()).digest()).decode()
    try:
        return Fernet(key)
    except Exception:
        raise GoogleError("unavailable", "Chave de criptografia inválida (TOKEN_ENCRYPTION_KEY)")


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        # Chave trocada/rotacionada: o vínculo não é recuperável — reconectar.
        raise GoogleError("unauthorized", "Credencial do Google ilegível. Reconecte sua conta.")


# ----------------- state do OAuth -----------------
def _make_state(owner: str) -> str:
    return jwt.encode(
        {
            "sub": owner,
            "type": "google_oauth",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=STATE_TTL_MINUTES),
        },
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


def _read_state(state: str) -> Optional[str]:
    try:
        payload = jwt.decode(state, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    return payload.get("sub") if payload.get("type") == "google_oauth" else None


# ----------------- persistência -----------------
async def get_integration(owner: str) -> Optional[dict]:
    return await db.integrations.find_one({"owner_id": owner, "provider": "google"})


async def _save(owner: str, updates: dict) -> None:
    await db.integrations.update_one(
        {"owner_id": owner, "provider": "google"},
        {"$set": {**updates, "owner_id": owner, "provider": "google", "updated_at": now_iso()}},
        upsert=True,
    )


async def public_status(owner: str) -> dict:
    """O que o frontend pode ver — jamais tokens."""
    integ = await get_integration(owner)
    if not integ:
        return {"configured": is_configured(), "connected": False}
    return {
        "configured": is_configured(),
        "connected": True,
        "email": integ.get("email"),
        "folder_id": integ.get("folder_id"),
        "folder_name": integ.get("folder_name"),
        "folder_link": integ.get("folder_link"),
        "status": integ.get("status", "connected"),
        "connected_at": integ.get("connected_at"),
    }


# ----------------- OAuth -----------------
async def _post_token(data: dict) -> dict:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(TOKEN_URL, data=data)
    if resp.status_code >= 400:
        # O corpo da resposta pode conter credenciais — só o código vai para o log.
        logger.warning(f"Google token endpoint respondeu {resp.status_code}")
        raise GoogleError("unauthorized", "Não foi possível validar a autorização do Google")
    return resp.json()


async def exchange_code(code: str) -> dict:
    return await _post_token({
        "code": code,
        "client_id": _env("GOOGLE_CLIENT_ID"),
        "client_secret": _env("GOOGLE_CLIENT_SECRET"),
        "redirect_uri": _env("GOOGLE_REDIRECT_URI"),
        "grant_type": "authorization_code",
    })


async def _access_token(owner: str) -> str:
    """Renova o access token a partir do refresh token guardado (cifrado).

    É o que evita reconectar o Google a cada uso. Se o usuário revogou o acesso,
    a integração é marcada como `expired` e a tela oferece [Reconectar].
    """
    integ = await get_integration(owner)
    if not integ or not integ.get("refresh_token_enc"):
        raise GoogleError("not_connected", "Conta Google não conectada")
    refresh_token = _decrypt(integ["refresh_token_enc"])
    try:
        data = await _post_token({
            "refresh_token": refresh_token,
            "client_id": _env("GOOGLE_CLIENT_ID"),
            "client_secret": _env("GOOGLE_CLIENT_SECRET"),
            "grant_type": "refresh_token",
        })
    except GoogleError:
        await _save(owner, {"status": "expired"})
        raise GoogleError("unauthorized", "Conexão com Google Drive expirada")
    if integ.get("status") != "connected":
        await _save(owner, {"status": "connected"})
    return data["access_token"]


async def fetch_email(access_token: str) -> Optional[str]:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    return resp.json().get("email") if resp.status_code < 400 else None


# ----------------- Drive -----------------
def _raise_for(resp: httpx.Response, acao: str) -> None:
    if resp.status_code < 400:
        return
    logger.warning(f"Google Drive: {acao} respondeu {resp.status_code}")
    if resp.status_code in (401, 403):
        raise GoogleError("unauthorized", "Autorização do Google Drive inválida ou revogada")
    if resp.status_code == 404:
        raise GoogleError("not_found", "Documento não encontrado no Google Drive")
    raise GoogleError("unavailable", "Google Drive indisponível no momento")


def _multipart(metadata: dict, data: bytes, mime: str):
    """Corpo multipart/related exigido pelo upload do Drive (metadados + arquivo)."""
    boundary = f"vorcel{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + json.dumps(metadata).encode()
        + f"\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n".encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/related; boundary={boundary}"


async def create_folder(owner: str, name: str, parent: Optional[str] = None) -> dict:
    token = await _access_token(owner)
    metadata = {"name": name, "mimeType": FOLDER_MIME}
    if parent:
        metadata["parents"] = [parent]
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(
            DRIVE_FILES,
            params={"fields": "id,name,webViewLink"},
            headers={"Authorization": f"Bearer {token}"},
            json=metadata,
        )
    _raise_for(resp, "criar pasta")
    return resp.json()


async def create_default_folder(owner: str, name: str = DEFAULT_FOLDER) -> dict:
    """Cria `Vorcel / <name>` no Meu Drive do usuário e guarda a referência.

    Com o escopo `drive.file` o app enxerga o que ele mesmo cria, então a pasta
    nasce sob o controle do Vorcel sem pedir acesso ao resto do Drive.
    """
    raiz = await create_folder(owner, DEFAULT_ROOT_FOLDER)
    pasta = await create_folder(owner, name, parent=raiz["id"])
    await _save(owner, {
        "folder_id": pasta["id"],
        "folder_name": f"{DEFAULT_ROOT_FOLDER} / {pasta['name']}",
        "folder_link": pasta.get("webViewLink"),
    })
    return pasta


async def file_meta(owner: str, file_id: str) -> dict:
    """Metadados do documento — usado para detectar exclusão manual no Drive."""
    token = await _access_token(owner)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{DRIVE_FILES}/{file_id}",
            params={"fields": "id,name,trashed,webViewLink,modifiedTime"},
            headers={"Authorization": f"Bearer {token}"},
        )
    _raise_for(resp, "ler metadados")
    meta = resp.json()
    if meta.get("trashed"):
        raise GoogleError("not_found", "Documento está na lixeira do Google Drive")
    return meta


async def upload_as_gdoc(owner: str, data: bytes, name: str, folder_id: str) -> dict:
    """Envia o DOCX e o converte em documento nativo do Google Docs."""
    token = await _access_token(owner)
    metadata = {"name": name, "mimeType": GDOC_MIME, "parents": [folder_id]}
    body, content_type = _multipart(metadata, data, DOCX_MIME)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(
            DRIVE_UPLOAD,
            params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
            content=body,
        )
    _raise_for(resp, "enviar documento")
    return resp.json()


async def update_gdoc(owner: str, file_id: str, data: bytes, name: Optional[str] = None) -> dict:
    """Substitui o CONTEÚDO do Google Doc existente, mantendo o mesmo id.

    Estratégia escolhida para "Substituir": preserva `webViewLink`, histórico de
    revisões e compartilhamentos, e não deixa documento duplicado nem órfão.
    Quem chama trata `not_found`/`unauthorized` recriando o documento.
    """
    token = await _access_token(owner)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.patch(
            f"{DRIVE_UPLOAD}/{file_id}",
            params={"uploadType": "media", "fields": "id,name,webViewLink"},
            headers={"Authorization": f"Bearer {token}", "Content-Type": DOCX_MIME},
            content=data,
        )
        _raise_for(resp, "atualizar documento")
        atualizado = resp.json()
        if name and name != atualizado.get("name"):
            renomeado = await client.patch(
                f"{DRIVE_FILES}/{file_id}",
                params={"fields": "id,name,webViewLink"},
                headers={"Authorization": f"Bearer {token}"},
                json={"name": name},
            )
            if renomeado.status_code < 400:
                atualizado = renomeado.json()
    return atualizado


async def export_file(owner: str, file_id: str, mime: str) -> bytes:
    """Exporta a versão ATUAL do Google Docs (PDF ou DOCX)."""
    token = await _access_token(owner)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(
            f"{DRIVE_FILES}/{file_id}/export",
            params={"mimeType": mime},
            headers={"Authorization": f"Bearer {token}"},
        )
    _raise_for(resp, "exportar documento")
    return resp.content


# =================== ENDPOINTS ===================
@gdrive_router.get("/status")
async def status(current=Depends(get_current_user)):
    return await public_status(uid(current))


@gdrive_router.get("/auth-url")
async def auth_url(current=Depends(get_current_user)):
    if not is_configured():
        raise HTTPException(status_code=503, detail="Integração com o Google não configurada no servidor")
    params = {
        "client_id": _env("GOOGLE_CLIENT_ID"),
        "redirect_uri": _env("GOOGLE_REDIRECT_URI"),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",     # necessário para receber refresh_token
        "prompt": "consent",          # garante refresh_token mesmo em reconexão
        "include_granted_scopes": "true",
        "state": _make_state(uid(current)),
    }
    return {"url": f"{AUTH_URL}?{urlencode(params)}"}


@gdrive_router.get("/callback")
async def callback(code: str = Query(None), state: str = Query(None), error: str = Query(None)):
    """Retorno do consentimento do Google. Sem header Authorization — o usuário
    vem do `state` assinado. Sempre redireciona de volta para as Configurações."""
    destino = f"{frontend_url().rstrip('/')}/configuracoes"

    if error:
        return RedirectResponse(f"{destino}?google=erro&motivo=acesso_negado")
    owner = _read_state(state) if state else None
    if not owner or not code:
        return RedirectResponse(f"{destino}?google=erro&motivo=sessao_invalida")

    try:
        tokens = await exchange_code(code)
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return RedirectResponse(f"{destino}?google=erro&motivo=sem_refresh_token")
        email = await fetch_email(tokens.get("access_token", ""))
        anterior = await get_integration(owner) or {}
        await _save(owner, {
            "email": email,
            "refresh_token_enc": _encrypt(refresh_token),
            "scopes": SCOPES,
            "status": "connected",
            "connected_at": anterior.get("connected_at") or now_iso(),
        })
    except GoogleError as e:
        logger.warning(f"Google callback falhou: {e.code}")
        return RedirectResponse(f"{destino}?google=erro&motivo={e.code}")
    except Exception:
        logger.exception("Google callback: falha inesperada")
        return RedirectResponse(f"{destino}?google=erro&motivo=falha_inesperada")

    return RedirectResponse(f"{destino}?google=ok")


class FolderInput(BaseModel):
    name: str = DEFAULT_FOLDER


@gdrive_router.post("/folder")
async def folder(body: FolderInput, current=Depends(get_current_user)):
    owner = uid(current)
    try:
        await create_default_folder(owner, (body.name or DEFAULT_FOLDER).strip() or DEFAULT_FOLDER)
    except GoogleError as e:
        raise HTTPException(status_code=409 if e.code != "unavailable" else 502, detail=e.message)
    return await public_status(owner)


@gdrive_router.post("/disconnect")
async def disconnect(current=Depends(get_current_user)):
    """Remove APENAS a conexão. Arquivos do R2, documentos no Google Drive,
    propostas e licitações permanecem intactos."""
    await db.integrations.delete_one({"owner_id": uid(current), "provider": "google"})
    return {"connected": False, "configured": is_configured()}
