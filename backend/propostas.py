"""Proposta comercial (.docx) de cada licitação.

Arquitetura (ver plano): o **original** fica sempre no Cloudflare R2 — reusando
`storage.put_object/get_object` e a coleção `db.files`, sem tocar em `storage.py`.
O Google Drive/Docs é uma camada ADICIONAL (versão viva/editável) que pode falhar
ou nem existir sem comprometer a proposta salva.

A proposta é um subdocumento do próprio bid (`bids.proposta`), então:
- `GET /bids` já entrega o estado do ícone "P" sem request extra;
- excluir a licitação leva a proposta junto (nada de registro órfão).

Isolamento multi-usuário: todo acesso passa por `_owned_bid(bid_id, owner)`; bid de
outro usuário retorna 404 (não revela existência). Downloads usam o mesmo padrão
`?auth=` do `storage.py`, porque <iframe>/<a> não enviam header Authorization.
"""
import logging
import uuid
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile

import gdrive
from auth import get_current_user, user_id_from_token
from db import db, now_iso
from routes import _owned_bid, ser, uid
from storage import APP_NAME, MAX_SIZE, get_object, put_object

logger = logging.getLogger(__name__)

propostas_router = APIRouter(prefix="/api", tags=["propostas"])

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MIME = "application/pdf"

# Situações possíveis da cópia no Google Drive. O original no R2 independe disto.
SYNC_NOT_CONNECTED = "not_connected"  # usuário ainda não ligou a conta Google
SYNC_SYNCED = "synced"
SYNC_FAILED = "failed"

# Código do GoogleError -> status HTTP devolvido ao frontend.
_HTTP_POR_CODIGO = {"not_connected": 409, "no_folder": 409, "not_found": 404, "unauthorized": 401}


def _safe_name(name: str) -> str:
    """Nome de arquivo seguro para o cabeçalho Content-Disposition."""
    return (name or "proposta").replace('"', "").replace("\\", "").replace("\r", "").replace("\n", "")


def _with_ext(name: str, ext: str) -> str:
    base = _safe_name(name).rsplit(".", 1)[0] or "proposta"
    return f"{base}.{ext}"


async def _store_original(data: bytes, filename: str, owner: str) -> dict:
    """Grava o DOCX original no R2 e registra em `db.files`.

    Mesmo formato do `POST /api/upload` do storage.py — o arquivo continua
    baixável por `GET /api/files/{id}` com a checagem de dono já existente.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "docx"
    path = f"{APP_NAME}/uploads/{owner}/{uuid.uuid4()}.{ext}"
    result = put_object(path, data, DOCX_MIME)

    file_id = str(uuid.uuid4())
    await db.files.insert_one({
        "id": file_id,
        "storage_path": result["path"],
        "original_filename": filename,
        "content_type": DOCX_MIME,
        "size": result.get("size", len(data)),
        "owner_id": owner,
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"file_id": file_id, "filename": filename, "size": result.get("size", len(data))}


async def _read_docx_upload(file: UploadFile) -> bytes:
    """Valida extensão e tamanho, devolvendo os bytes do .docx."""
    filename = file.filename or ""
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Envie um arquivo Word (.docx)")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo vazio")
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo excede 10MB")
    return data


def _doc_name(filename: str) -> str:
    """Nome do documento no Google Docs — o nome do arquivo sem a extensão."""
    return (_safe_name(filename).rsplit(".", 1)[0] or "Proposta").strip()


async def _sync_to_google(owner: str, prop: dict, data: bytes) -> dict:
    """Espelha a proposta no Google Drive/Docs, quando a conta estiver conectada.

    NUNCA levanta exceção: o original no R2 já está salvo e não pode ser perdido
    por causa do Google. Devolve o `prop` com o status de sincronização atualizado.

    Se já existe um documento vinculado, ele é ATUALIZADO no lugar (mantém o mesmo
    id, link, histórico de revisões e compartilhamentos). Só quando o documento
    sumiu do Drive ou perdeu a permissão é que um novo é criado e a referência
    trocada — o que evita duplicatas a cada nova tentativa.
    """
    try:
        integracao = await gdrive.get_integration(owner)
        if not integracao:
            prop["google_sync_status"] = SYNC_NOT_CONNECTED
            prop["google_error"] = None
            return prop

        folder_id = integracao.get("folder_id")
        if not folder_id:
            prop["google_sync_status"] = SYNC_FAILED
            prop["google_error"] = "no_folder"
            return prop

        nome = _doc_name(prop.get("filename", "Proposta"))
        existente = prop.get("google_file_id")
        if existente:
            try:
                info = await gdrive.update_gdoc(owner, existente, data, nome)
            except gdrive.GoogleError as e:
                if e.code not in ("not_found", "unauthorized"):
                    raise
                info = await gdrive.upload_as_gdoc(owner, data, nome, folder_id)
        else:
            info = await gdrive.upload_as_gdoc(owner, data, nome, folder_id)

        prop.update({
            "google_file_id": info.get("id"),
            "google_file_name": info.get("name"),
            "google_web_view_link": info.get("webViewLink"),
            "google_folder_id": folder_id,
            "google_sync_status": SYNC_SYNCED,
            "google_synced_at": now_iso(),
            "google_error": None,
        })
    except gdrive.GoogleError as e:
        logger.warning(f"Proposta: sincronização com o Google falhou ({e.code})")
        prop["google_sync_status"] = SYNC_FAILED
        prop["google_error"] = e.code
    except Exception:
        logger.exception("Proposta: falha inesperada na sincronização com o Google")
        prop["google_sync_status"] = SYNC_FAILED
        prop["google_error"] = "unexpected"
    return prop


async def _save_proposta(bid_id: str, owner: str, prop: dict) -> dict:
    """Persiste a proposta no bid e mantém `proposta_enviada` derivado do documento."""
    await db.bids.update_one(
        {"_id": ObjectId(bid_id), "owner_id": owner},
        {"$set": {"proposta": prop, "proposta_enviada": True}},
    )
    return ser(await db.bids.find_one({"_id": ObjectId(bid_id)}))


async def _require_bid(bid_id: str, owner: str) -> dict:
    bid = await _owned_bid(bid_id, owner)
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    return bid


def _require_proposta(bid: dict) -> dict:
    prop = bid.get("proposta") or {}
    if not prop.get("file_id"):
        raise HTTPException(status_code=404, detail="Esta licitação não possui proposta")
    return prop


# =================== ENDPOINTS ===================
@propostas_router.post("/bids/{bid_id}/proposta")
async def create_proposta(bid_id: str, file: UploadFile = File(...), current=Depends(get_current_user)):
    """Primeiro upload: R2 primeiro (fonte de verdade), Google depois (best-effort)."""
    owner = uid(current)
    await _require_bid(bid_id, owner)

    data = await _read_docx_upload(file)
    try:
        stored = await _store_original(data, file.filename, owner)
    except Exception as e:
        logger.error(f"Proposta: falha ao gravar no R2 (bid={bid_id}): {e}")
        raise HTTPException(status_code=500, detail="Falha ao salvar a proposta")

    prop = {
        **stored,
        "content_type": DOCX_MIME,
        "google_file_id": None,
        "google_file_name": None,
        "google_web_view_link": None,
        "google_folder_id": None,
        "google_sync_status": SYNC_NOT_CONNECTED,
        "google_synced_at": None,
        "google_error": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    prop = await _sync_to_google(owner, prop, data)
    return await _save_proposta(bid_id, owner, prop)


@propostas_router.put("/bids/{bid_id}/proposta")
async def replace_proposta(bid_id: str, file: UploadFile = File(...), current=Depends(get_current_user)):
    """Substituir: novo original no R2, preservando as referências do Google
    (o mesmo Google Doc é atualizado no lugar — ver Fase 3)."""
    owner = uid(current)
    bid = await _require_bid(bid_id, owner)
    atual = _require_proposta(bid)

    data = await _read_docx_upload(file)
    try:
        stored = await _store_original(data, file.filename, owner)
    except Exception as e:
        logger.error(f"Proposta: falha ao gravar substituição no R2 (bid={bid_id}): {e}")
        raise HTTPException(status_code=500, detail="Falha ao salvar a proposta")

    prop = {
        **atual,
        **stored,
        "content_type": DOCX_MIME,
        "updated_at": now_iso(),
        "google_error": None,
    }
    prop = await _sync_to_google(owner, prop, data)
    bid = await _save_proposta(bid_id, owner, prop)

    # O original anterior deixa de ser referenciado — marcado como removido para
    # não ficar órfão visível, sem apagar o objeto no R2 (backup preservado).
    if atual.get("file_id") and atual["file_id"] != prop.get("file_id"):
        await db.files.update_one(
            {"id": atual["file_id"], "owner_id": owner},
            {"$set": {"superseded_at": now_iso()}},
        )
    return bid


@propostas_router.delete("/bids/{bid_id}/proposta")
async def delete_proposta(bid_id: str, current=Depends(get_current_user)):
    """Desvincula a proposta da licitação (o "P" volta a ficar desbotado).

    NÃO apaga o arquivo no R2 nem o documento no Google Drive — só remove o vínculo.
    """
    owner = uid(current)
    bid = await _require_bid(bid_id, owner)
    _require_proposta(bid)
    await db.bids.update_one(
        {"_id": ObjectId(bid_id), "owner_id": owner},
        {"$unset": {"proposta": ""}, "$set": {"proposta_enviada": False}},
    )
    return ser(await db.bids.find_one({"_id": ObjectId(bid_id)}))


async def _resolve_requester(auth: Optional[str], authorization: Optional[str]) -> str:
    """Token via `?auth=` (iframe/link) ou header Bearer — mesmo padrão do storage.py."""
    token = auth
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    requester = user_id_from_token(token)
    if not requester:
        raise HTTPException(status_code=401, detail="Não autenticado")
    return requester


async def _original_bytes(prop: dict, owner: str) -> bytes:
    """Recupera o DOCX original do R2 a partir do registro em `db.files`."""
    record = await db.files.find_one({"id": prop.get("file_id"), "owner_id": owner, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="Arquivo original não encontrado")
    data, _ = get_object(record["storage_path"])
    return data


@propostas_router.post("/bids/{bid_id}/proposta/sync")
async def sync_proposta(bid_id: str, current=Depends(get_current_user)):
    """(Re)envia a proposta para o Google Drive a partir do original guardado no R2.

    Serve aos três caminhos da tela — "Enviar para o Google Drive", "Tentar
    sincronizar novamente" e "Recriar no Google Drive" — porque a rotina é a
    mesma e é idempotente. Devolve a licitação; a tela lê `google_sync_status`.
    """
    owner = uid(current)
    bid = await _require_bid(bid_id, owner)
    prop = _require_proposta(bid)

    try:
        data = await _original_bytes(prop, owner)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Proposta: falha ao ler o original no R2 para sincronizar (bid={bid_id}): {e}")
        raise HTTPException(status_code=500, detail="Falha ao recuperar a proposta original")

    prop = await _sync_to_google(owner, dict(prop), data)
    return await _save_proposta(bid_id, owner, prop)


@propostas_router.get("/bids/{bid_id}/proposta/status")
async def proposta_status(bid_id: str, current=Depends(get_current_user)):
    """Situação REAL do documento agora (o Google Docs pode ter sido apagado à mão).

    A tela usa isto ao abrir o visualizador para escolher entre exibir o documento
    ou oferecer a ação certa: conectar, definir pasta, tentar de novo ou recriar.
    """
    owner = uid(current)
    bid = await _require_bid(bid_id, owner)
    prop = _require_proposta(bid)

    integracao = await gdrive.get_integration(owner)
    if not integracao:
        return {"state": SYNC_NOT_CONNECTED}
    if not integracao.get("folder_id"):
        return {"state": "no_folder"}
    if not prop.get("google_file_id"):
        return {"state": SYNC_FAILED, "error": prop.get("google_error")}

    try:
        meta = await gdrive.file_meta(owner, prop["google_file_id"])
    except gdrive.GoogleError as e:
        # not_found => apagado/na lixeira; unauthorized => autorização revogada.
        return {"state": "missing" if e.code == "not_found" else e.code}
    return {
        "state": SYNC_SYNCED,
        "web_view_link": meta.get("webViewLink") or prop.get("google_web_view_link"),
        "modified_time": meta.get("modifiedTime"),
    }


def _google_http_error(e: "gdrive.GoogleError") -> HTTPException:
    return HTTPException(status_code=_HTTP_POR_CODIGO.get(e.code, 502), detail=e.message)


@propostas_router.get("/bids/{bid_id}/proposta/preview.pdf")
async def preview_proposta(bid_id: str, auth: str = Query(None), authorization: str = Header(None)):
    """Representação PDF da versão ATUAL do Google Docs, exibida no <iframe> do
    visualizador. É o que permite ler a proposta sem baixar e sem abrir o Docs."""
    requester = await _resolve_requester(auth, authorization)
    bid = await _require_bid(bid_id, requester)
    prop = _require_proposta(bid)

    if not prop.get("google_file_id"):
        raise HTTPException(status_code=409, detail="Proposta ainda não sincronizada com o Google Drive")
    try:
        data = await gdrive.export_file(requester, prop["google_file_id"], PDF_MIME)
    except gdrive.GoogleError as e:
        raise _google_http_error(e)

    return Response(
        content=data,
        media_type=PDF_MIME,
        headers={
            "Content-Disposition": f'inline; filename="{_with_ext(prop.get("filename", "proposta"), "pdf")}"',
            "Cache-Control": "no-store",  # sempre a versão atual, nunca uma cópia velha do navegador
        },
    )


@propostas_router.get("/bids/{bid_id}/proposta/download")
async def download_proposta(
    bid_id: str,
    format: str = Query("docx", pattern="^(docx|pdf)$"),
    auth: str = Query(None),
    authorization: str = Header(None),
):
    """Baixa a proposta. Com Google sincronizado devolve a versão ATUAL do Google
    Docs (incorpora as edições feitas lá); em DOCX, o original do R2 é o fallback
    quando o Google estiver indisponível ou a conta não conectada."""
    requester = await _resolve_requester(auth, authorization)
    bid = await _require_bid(bid_id, requester)
    prop = _require_proposta(bid)
    google_id = prop.get("google_file_id")

    if format == "pdf":
        if not google_id:
            raise HTTPException(status_code=409, detail="Conecte sua conta Google para baixar em PDF")
        try:
            data = await gdrive.export_file(requester, google_id, PDF_MIME)
        except gdrive.GoogleError as e:
            raise _google_http_error(e)
        return Response(
            content=data,
            media_type=PDF_MIME,
            headers={"Content-Disposition": f'attachment; filename="{_with_ext(prop.get("filename", "proposta"), "pdf")}"'},
        )

    data = None
    if google_id:
        try:
            data = await gdrive.export_file(requester, google_id, DOCX_MIME)
        except gdrive.GoogleError as e:
            logger.info(f"Proposta: export DOCX do Google falhou ({e.code}); usando o original do R2")

    if data is None:
        try:
            data = await _original_bytes(prop, requester)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Proposta: falha ao ler o original no R2 (bid={bid_id}): {e}")
            raise HTTPException(status_code=500, detail="Falha ao recuperar a proposta")

    filename = _with_ext(prop.get("filename", "proposta"), "docx")
    return Response(
        content=data,
        media_type=DOCX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
