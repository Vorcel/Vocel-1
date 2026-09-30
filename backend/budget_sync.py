"""Orçamento (ERP) colaborativo: salvamento granular + sincronização em tempo real.

Antes, o frontend fazia `PUT /bids/{id}/budget` com a planilha INTEIRA e o backend
regravava o array `rows` — a última sessão a salvar apagava o que as outras tinham
alterado. Agora cada alteração é uma operação pequena e atômica no MongoDB:

- PATCH  /bids/{id}/budget/rows/{row_id}  -> `$set` só dos campos alterados da linha
- POST   /bids/{id}/budget/rows           -> `$push` de uma linha nova
- DELETE /bids/{id}/budget/rows/{row_id}  -> `$pull` da linha
- PUT    /bids/{id}/budget/order          -> reordenação (compare-and-set na revisão)
- PUT    /bids/{id}/budget/summary        -> totais agregados (só se a revisão bater)

Regras:
- Linhas identificadas pelo `_id` estável da própria linha (nunca pelo índice).
- Last-write-wins POR CAMPO: dois `$set` em campos diferentes nunca se anulam; no
  mesmo campo vence o último aplicado pelo MongoDB.
- Toda operação incrementa `revision` no mesmo update atômico. A revisão ordena os
  eventos no cliente e detecta estado antigo; ela NÃO é usada para rejeitar edições
  de campos diferentes.
- Ordem: persiste no MongoDB -> responde -> publica o evento na sala (owner + bid).
- As fórmulas continuam SÓ em `frontend/src/lib/calc.js`; os campos calculados são
  função pura das entradas e cada cliente os recalcula igual ao modo de uma sessão.
  O backend guarda apenas `summary` (usado por Execução/Análises), enviado pelo
  cliente com a revisão em que foi calculado.
- Isolamento: todas as consultas filtram `owner_id` do usuário autenticado; a sala
  do WebSocket é `budget:{owner_id}:{bid_id}`, validada no servidor."""
import asyncio
import logging
import uuid
from typing import Any, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user, user_id_from_token
from db import db, now_iso
from realtime import hub
from routes import BudgetInput, _owned_bid, ser, uid

logger = logging.getLogger(__name__)

budget_router = APIRouter(prefix="/api", tags=["budget"])

# Campos de ENTRADA editáveis de uma linha (os calculados nunca são gravados por patch).
ROW_FIELDS = {
    "selecionado", "lote", "item", "produto", "marca", "fornecedor", "site",
    "valor_compra", "qtd", "valor_venda", "margem", "icms", "pis_cofins",
    "outros_sem_imp", "outros_com_imp", "frete_receber", "frete_enviar", "mode",
}
MAX_STR = 5000
ROW_GONE = {"code": "row_not_found", "msg": "Este item foi excluído em outra sessão."}


def _room(owner: str, bid_id: str) -> str:
    return f"budget:{owner}:{bid_id}"


def _clean_value(v: Any) -> Any:
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, str):
        return v[:MAX_STR]
    raise HTTPException(status_code=422, detail="Valor inválido")


def _clean_fields(fields: dict) -> dict:
    out = {k: _clean_value(v) for k, v in (fields or {}).items() if k in ROW_FIELDS}
    if not out:
        raise HTTPException(status_code=422, detail="Nenhum campo editável informado")
    return out


def _normalize_rows(rows: list) -> tuple:
    """Garante `_id` único e estável em toda linha (orçamentos antigos podem não ter)."""
    seen, out, changed = set(), [], False
    for r in rows or []:
        if not isinstance(r, dict):
            changed = True
            continue
        rid = r.get("_id")
        if not isinstance(rid, str) or not rid or rid in seen:
            r = {**r, "_id": f"r{uuid.uuid4().hex}"}
            changed = True
        seen.add(r["_id"])
        out.append(r)
    return out, changed


async def _defaults(owner: str) -> dict:
    prefs = await db.preferences.find_one({"owner_id": owner}) or {}
    return {
        "icms": prefs.get("icms_padrao", 18),
        "pis_cofins": prefs.get("pis_cofins_padrao", 9.25),
        "margem": prefs.get("margem_padrao", 30),
    }


async def _require_bid(bid_id: str, owner: str) -> dict:
    bid = await _owned_bid(bid_id, owner)
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    return bid


async def _load_budget(bid_id: str, owner: str) -> Optional[dict]:
    """Lê o orçamento e faz o backfill de ids estáveis de forma segura (compare-and-set
    na revisão: se outra sessão alterou no meio, relê em vez de sobrescrever)."""
    for _ in range(3):
        doc = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner})
        if not doc:
            return None
        rows, changed = _normalize_rows(doc.get("rows", []))
        if not changed:
            return doc
        res = await db.budgets.update_one(
            {"_id": doc["_id"], "revision": doc.get("revision")},
            {"$set": {"rows": rows}},
        )
        if res.modified_count:
            doc["rows"] = rows
            return doc
    return await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner})


async def _ensure_budget_doc(bid_id: str, owner: str) -> None:
    await db.budgets.update_one(
        {"bid_id": bid_id, "owner_id": owner},
        {"$setOnInsert": {"rows": [], "summary": {}, "revision": 0, "updated_at": now_iso()}},
        upsert=True,
    )


async def _apply(bid_id: str, owner: str, match: dict, update: dict, array_filters=None) -> Optional[dict]:
    """Aplica UMA operação atômica no orçamento + incrementa a revisão.
    Devolve o documento depois da operação (ou None se `match` não casou)."""
    update.setdefault("$inc", {})["revision"] = 1
    update.setdefault("$set", {})["updated_at"] = now_iso()
    return await db.budgets.find_one_and_update(
        {"bid_id": bid_id, "owner_id": owner, **match},
        update,
        array_filters=array_filters,
        projection={"rows": 1, "revision": 1},
        return_document=ReturnDocument.AFTER,
    )


async def _emit(owner: str, bid_id: str, event: dict) -> None:
    await hub.publish(_room(owner, bid_id), {"bid_id": bid_id, "updated_at": now_iso(), **event})


def _ack(doc: dict) -> dict:
    """Resposta das operações: revisão nova + linhas atuais (o cliente de origem usa
    as linhas autoritativas só para calcular o `summary` com o motor único)."""
    return {"revision": doc.get("revision", 0), "rows": doc.get("rows", [])}


# ---------------------------------------------------------------- leitura
@budget_router.get("/bids/{bid_id}/budget")
async def get_budget(bid_id: str, current=Depends(get_current_user)):
    owner = uid(current)
    bid = await _require_bid(bid_id, owner)
    bud = await _load_budget(bid_id, owner) or {}
    return {
        "bid_id": bid_id,
        "bid": ser(bid),
        "rows": bud.get("rows", []),
        "summary": bud.get("summary", {}),
        # Orçamentos antigos não têm revisão: valem 0 até a 1ª operação ($inc cria).
        "revision": bud.get("revision", 0),
        "summary_revision": bud.get("summary_revision"),
        "defaults": await _defaults(owner),
    }


# ---------------------------------------------------------------- operações granulares
class RowPatchInput(BaseModel):
    fields: dict
    client_id: str = ""


class RowAddInput(BaseModel):
    row: dict
    client_id: str = ""


class RowsOrderInput(BaseModel):
    order: List[str]
    client_id: str = ""


class SummaryInput(BaseModel):
    revision: int
    summary: dict = Field(default_factory=dict)


@budget_router.patch("/bids/{bid_id}/budget/rows/{row_id}")
async def patch_budget_row(bid_id: str, row_id: str, body: RowPatchInput, current=Depends(get_current_user)):
    """Atualiza SÓ os campos enviados de UMA linha. Linha inexistente => 404
    (nunca recria silenciosamente um item excluído por outra sessão)."""
    owner = uid(current)
    await _require_bid(bid_id, owner)
    fields = _clean_fields(body.fields)
    doc = await _apply(
        bid_id, owner, {"rows._id": row_id},
        {"$set": {f"rows.$[r].{k}": v for k, v in fields.items()}},
        array_filters=[{"r._id": row_id}],
    )
    if not doc:
        raise HTTPException(status_code=404, detail=ROW_GONE)
    await _emit(owner, bid_id, {
        "type": "budget_row_updated", "row_id": row_id, "fields": fields,
        "revision": doc["revision"], "source_client_id": body.client_id,
    })
    return _ack(doc)


@budget_router.post("/bids/{bid_id}/budget/rows")
async def add_budget_row(bid_id: str, body: RowAddInput, current=Depends(get_current_user)):
    """Acrescenta uma linha ($push atômico: inserções simultâneas se preservam).
    Idempotente pelo `_id` — um retry após falha de rede não duplica a linha."""
    owner = uid(current)
    await _require_bid(bid_id, owner)
    row_id = body.row.get("_id")
    if not isinstance(row_id, str) or not row_id or len(row_id) > 100:
        raise HTTPException(status_code=422, detail="Linha sem identificador")
    row = {k: _clean_value(v) for k, v in body.row.items() if k in ROW_FIELDS}
    row["_id"] = row_id
    await _ensure_budget_doc(bid_id, owner)
    doc = await _apply(bid_id, owner, {"rows._id": {"$ne": row_id}}, {"$push": {"rows": row}})
    if not doc:  # já existia (retry): devolve o estado atual sem novo evento
        cur = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"rows": 1, "revision": 1})
        return _ack(cur or {})
    await _emit(owner, bid_id, {
        "type": "budget_row_added", "row": row,
        "revision": doc["revision"], "source_client_id": body.client_id,
    })
    return _ack(doc)


@budget_router.delete("/bids/{bid_id}/budget/rows/{row_id}")
async def delete_budget_row(bid_id: str, row_id: str, client_id: str = "", current=Depends(get_current_user)):
    owner = uid(current)
    await _require_bid(bid_id, owner)
    doc = await _apply(bid_id, owner, {"rows._id": row_id}, {"$pull": {"rows": {"_id": row_id}}})
    if not doc:  # já excluída por outra sessão: resultado final é o mesmo
        cur = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"rows": 1, "revision": 1})
        return _ack(cur or {})
    await _emit(owner, bid_id, {
        "type": "budget_row_deleted", "row_id": row_id,
        "revision": doc["revision"], "source_client_id": client_id,
    })
    return _ack(doc)


@budget_router.put("/bids/{bid_id}/budget/order")
async def reorder_budget_rows(bid_id: str, body: RowsOrderInput, current=Depends(get_current_user)):
    """Reordena pelas ids enviadas. Linhas que o cliente ainda não conhecia (inseridas
    por outra sessão) são mantidas, no fim. Compare-and-set na revisão + retry: nunca
    grava por cima de uma alteração que chegou no meio."""
    owner = uid(current)
    await _require_bid(bid_id, owner)
    for _ in range(5):
        cur = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"rows": 1, "revision": 1})
        if not cur:
            raise HTTPException(status_code=404, detail="Orçamento não encontrado")
        by_id = {r.get("_id"): r for r in cur.get("rows", [])}
        ordered = [by_id[i] for i in dict.fromkeys(body.order) if i in by_id]
        known = {r["_id"] for r in ordered}
        ordered += [r for r in cur.get("rows", []) if r.get("_id") not in known]
        doc = await _apply(bid_id, owner, {"revision": cur.get("revision")}, {"$set": {"rows": ordered}})
        if doc:
            await _emit(owner, bid_id, {
                "type": "budget_rows_reordered", "order": [r["_id"] for r in ordered],
                "revision": doc["revision"], "source_client_id": body.client_id,
            })
            return _ack(doc)
    raise HTTPException(status_code=409, detail="Orçamento alterado ao mesmo tempo. Tente novamente.")


async def _propagate_execution(bid_id: str, owner: str, summary: dict) -> None:
    """Mesma propagação de sempre para a Execução vinculada (se existir)."""
    s = summary or {}
    await db.executions.update_one(
        {"bid_id": bid_id, "owner_id": owner},
        {"$set": {
            "valor_empenho": s.get("valor_total", 0),
            "valor_compra": s.get("custo_global", 0),
            "lucro_previsto": s.get("lucro_global", 0),
        }},
    )


@budget_router.put("/bids/{bid_id}/budget/summary")
async def save_budget_summary(bid_id: str, body: SummaryInput, current=Depends(get_current_user)):
    """Grava os totais calculados pelo cliente SÓ se ainda correspondem à revisão atual.
    Se outra operação entrou depois, o cliente dela grava o summary da revisão nova."""
    owner = uid(current)
    await _require_bid(bid_id, owner)
    res = await db.budgets.update_one(
        {"bid_id": bid_id, "owner_id": owner, "revision": body.revision},
        {"$set": {"summary": body.summary, "summary_revision": body.revision}},
    )
    if res.matched_count:
        await _propagate_execution(bid_id, owner, body.summary)
    return {"applied": bool(res.matched_count)}


@budget_router.put("/bids/{bid_id}/budget")
async def save_budget(bid_id: str, body: BudgetInput, client_id: str = "", current=Depends(get_current_user)):
    """Gravação da planilha inteira (legado: abas antigas ainda abertas e testes).
    Continua funcionando, mas agora incrementa a revisão e avisa as sessões abertas
    para ressincronizarem."""
    owner = uid(current)
    await _require_bid(bid_id, owner)
    rows, _ = _normalize_rows(body.rows)
    doc = await db.budgets.find_one_and_update(
        {"bid_id": bid_id, "owner_id": owner},
        {"$set": {"rows": rows, "summary": body.summary, "owner_id": owner, "updated_at": now_iso()},
         "$inc": {"revision": 1}},
        upsert=True, projection={"revision": 1}, return_document=ReturnDocument.AFTER,
    )
    await db.budgets.update_one(
        {"_id": doc["_id"], "revision": doc["revision"]}, {"$set": {"summary_revision": doc["revision"]}}
    )
    await _propagate_execution(bid_id, owner, body.summary)
    await _emit(owner, bid_id, {"type": "budget_replaced", "revision": doc["revision"], "source_client_id": client_id})
    return {"message": "Orçamento salvo", "summary": body.summary}


# ---------------------------------------------------------------- WebSocket
AUTH_TIMEOUT = 10


@budget_router.websocket("/ws/budget/{bid_id}")
async def budget_ws(ws: WebSocket, bid_id: str):
    """Canal de sincronização de UMA planilha. O navegador não envia header
    Authorization no WebSocket, então a 1ª mensagem deve ser
    `{"type": "auth", "token": "<jwt>"}` (mesmo JWT da API). O dono vem do token
    validado no servidor — nunca de um owner_id enviado pelo cliente — e a sala só é
    aberta se a licitação pertencer a esse usuário."""
    await ws.accept()
    try:
        msg = await asyncio.wait_for(ws.receive_json(), AUTH_TIMEOUT)
    except Exception:
        await ws.close(code=4401)
        return
    user_id = user_id_from_token(msg.get("token") if isinstance(msg, dict) and msg.get("type") == "auth" else None)
    user = None
    if user_id:
        try:
            user = await db.users.find_one({"_id": ObjectId(user_id)}, {"_id": 1})
        except Exception:
            user = None
    if not user:
        await ws.close(code=4401)
        return
    owner = str(user["_id"])
    if not await _owned_bid(bid_id, owner):
        await ws.close(code=4404)
        return

    room = _room(owner, bid_id)
    hub.join(room, ws)
    try:
        cur = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"revision": 1})
        await ws.send_json({"type": "ready", "revision": (cur or {}).get("revision", 0)})
        while True:
            data = await ws.receive_json()
            if isinstance(data, dict) and data.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:  # JSON inválido, conexão caída etc.
        logger.debug(f"budget ws closed: {e}")
    finally:
        hub.leave(room, ws)
