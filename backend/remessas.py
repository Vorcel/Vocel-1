"""Remessas da Execução & Pós-Venda.

Uma licitação adjudicada continua sendo UMA licitação (Todas as Licitações,
Análises e contagens não mudam). As remessas são subdivisões OPERACIONAIS da sua
execução: cada uma tem timeline, prazo, atestado, documentos (Nota de Empenho /
Nota Fiscal / Outros) e orçamento próprios.

Modelagem (sem sistema paralelo):
- `executions.remessas` = lista de subdocumentos com `id` estável (uuid), `numero`
  sequencial por licitação (nunca reaproveitado: `remessas_seq`) e os mesmos
  campos operacionais que a execução já usa (`timeline`, `current_step`,
  `status_atual`, `atestado`, `documentos`, `tempo_entrega_dias`,
  `prazo_entrega_tipo`, `data_referencia_entrega`, `data_entrega`).
- `remessa_budgets` = orçamento operacional da remessa (mesmo formato de
  `budgets`; um documento por remessa). Nasce como CÓPIA do orçamento original ou
  da remessa anterior e depois é independente — editado pelas mesmas operações
  granulares + WebSocket do orçamento original (budget_sync.py).
- O orçamento original (`budgets`) continua sendo a referência comercial do que
  foi adjudicado e nunca é alterado aqui.

Execuções antigas: nada é migrado no banco. Enquanto não há remessas, a própria
execução é exibida como "Remessa 1". Ao criar a primeira remessa nova, a execução
vira a Remessa 1 (cópia da timeline, documentos, atestado e prazo, com o
orçamento original copiado) e os campos da execução permanecem como estavam.

Escritas concorrentes: campos de UMA remessa são gravados com `$set` posicional
(arrayFilters por `id`), documentos com `$push`/`$pull` — nunca regravando a
lista inteira. Isolamento: toda consulta filtra `owner_id` do usuário logado."""
import copy
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db, now_iso
from routes import (
    ATESTADO_DEFAULT, ATESTADO_OPTIONS, DOC_CATEGORIES, STEP_PENDENTE, TIMELINE_STEPS,
    _enrich_execution, _owned_bid, ser, uid,
)

remessas_router = APIRouter(prefix="/api", tags=["remessas"])

# Campos operacionais que uma remessa herda da execução ao virar Remessa 1.
_OPERATIONAL = (
    "timeline", "current_step", "status_atual", "atestado", "documentos",
    "tempo_entrega_dias", "prazo_entrega_tipo", "data_referencia_entrega",
    "data_entrega", "pagamento_pendente",
)


def _blank_timeline() -> list:
    return [{"step": i, "name": name, "status": STEP_PENDENTE, "files": []} for i, name in enumerate(TIMELINE_STEPS)]


async def _require_execution(bid_id: str, owner: str) -> dict:
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    ex = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not ex:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    return ex


async def _response(bid_id: str, owner: str) -> dict:
    ex = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    return await _enrich_execution(ser(ex), owner)


async def _insert_budget(owner: str, bid_id: str, remessa_id: str, source: Optional[dict], origem: str) -> None:
    """Orçamento da remessa = cópia profunda das linhas e do resumo da origem.
    Depois disso não existe vínculo: editar um não altera o outro."""
    src = source or {}
    summary = copy.deepcopy(src.get("summary") or {})
    await db.remessa_budgets.insert_one({
        "owner_id": owner,
        "bid_id": bid_id,
        "remessa_id": remessa_id,
        "rows": copy.deepcopy(src.get("rows") or []),
        "summary": summary,
        "revision": 0,
        # O resumo copiado corresponde exatamente às linhas copiadas (revisão 0).
        "summary_revision": 0 if summary else None,
        "origem": origem,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })


def _remessa_doc(numero: int, origem: str, base: Optional[dict] = None, defaults: Optional[dict] = None) -> dict:
    doc = {
        "id": uuid.uuid4().hex,
        "numero": numero,
        "nome": f"Remessa {numero}",
        "origem": origem,
        "created_at": now_iso(),
    }
    if base is not None:
        # Remessa 1 de uma execução antiga: cópia fiel do estado operacional.
        for k in _OPERATIONAL:
            if k in base:
                doc[k] = copy.deepcopy(base[k])
        if doc.get("atestado") not in ATESTADO_OPTIONS:
            doc["atestado"] = ATESTADO_DEFAULT
        doc.setdefault("timeline", _blank_timeline())
        doc.setdefault("current_step", 0)
        doc.setdefault("status_atual", TIMELINE_STEPS[0])
        doc.setdefault("documentos", {})
        return doc
    d = defaults or {}
    doc.update({
        "timeline": _blank_timeline(),
        "current_step": 0,
        "status_atual": TIMELINE_STEPS[0],
        "atestado": ATESTADO_DEFAULT,
        "documentos": {},
        "tempo_entrega_dias": d.get("tempo_entrega_dias") or 30,
        "prazo_entrega_tipo": d.get("prazo_entrega_tipo") or "corridos",
        "data_referencia_entrega": "",
        "data_entrega": "",
        "pagamento_pendente": True,
    })
    return doc


class RemessaCreateInput(BaseModel):
    base: str = "original"   # "original" | "anterior"


@remessas_router.post("/executions/{bid_id}/remessas")
async def create_remessa(bid_id: str, body: RemessaCreateInput, current=Depends(get_current_user)):
    owner = uid(current)
    if body.base not in ("original", "anterior"):
        raise HTTPException(status_code=400, detail="Base inválida. Use: original, anterior")
    for _ in range(3):
        ex = await _require_execution(bid_id, owner)
        remessas = list(ex.get("remessas") or [])
        original = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"rows": 1, "summary": 1})

        if not remessas:
            # Primeira remessa nova: a execução atual vira a Remessa 1 (nada se perde —
            # os campos da execução continuam gravados como estavam) e nasce a Remessa 2.
            r1 = _remessa_doc(1, "execucao", base=ex)
            nova = _remessa_doc(2, "original", defaults=ex)
            await _insert_budget(owner, bid_id, r1["id"], original, "original")
            await _insert_budget(owner, bid_id, nova["id"], original, "original")
            res = await db.executions.update_one(
                {"_id": ex["_id"], "owner_id": owner,
                 "$or": [{"remessas": {"$exists": False}}, {"remessas": {"$size": 0}}]},
                {"$set": {"remessas": [r1, nova], "remessas_seq": 2, "remessas_desde": now_iso()}},
            )
            if res.matched_count:
                return await _response(bid_id, owner)
            await db.remessa_budgets.delete_many({"remessa_id": {"$in": [r1["id"], nova["id"]]}, "owner_id": owner})
            continue

        seq = int(ex.get("remessas_seq") or max((r.get("numero") or 0) for r in remessas))
        anterior = remessas[-1]
        if body.base == "anterior":
            source = await db.remessa_budgets.find_one(
                {"bid_id": bid_id, "owner_id": owner, "remessa_id": anterior["id"]}, {"rows": 1, "summary": 1})
            origem = f"remessa:{anterior['id']}"
        else:
            source, origem = original, "original"
        nova = _remessa_doc(seq + 1, origem, defaults=ex)
        await _insert_budget(owner, bid_id, nova["id"], source, origem)
        # $push (não regrava as remessas existentes) + compare-and-set no contador:
        # duas criações simultâneas nunca recebem o mesmo número.
        seq_match = {"remessas_seq": seq} if ex.get("remessas_seq") is not None else {"remessas_seq": {"$exists": False}}
        res = await db.executions.update_one(
            {"_id": ex["_id"], "owner_id": owner, **seq_match},
            {"$push": {"remessas": nova}, "$set": {"remessas_seq": seq + 1}},
        )
        if res.matched_count:
            return await _response(bid_id, owner)
        await db.remessa_budgets.delete_one({"remessa_id": nova["id"], "owner_id": owner})
    raise HTTPException(status_code=409, detail="Execução alterada ao mesmo tempo. Tente novamente.")


class RemessaUpdate(BaseModel):
    timeline: Optional[list] = None
    current_step: Optional[int] = None
    status_atual: Optional[str] = None
    atestado: Optional[str] = None
    tempo_entrega_dias: Optional[int] = None
    prazo_entrega_tipo: Optional[str] = None
    data_referencia_entrega: Optional[str] = None
    data_entrega: Optional[str] = None
    pagamento_pendente: Optional[bool] = None


@remessas_router.put("/executions/{bid_id}/remessas/{remessa_id}")
async def update_remessa(bid_id: str, remessa_id: str, body: RemessaUpdate, current=Depends(get_current_user)):
    """Mesmas regras do PUT da execução, aplicadas SÓ a esta remessa."""
    owner = uid(current)
    await _require_execution(bid_id, owner)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "atestado" in updates and updates["atestado"] not in ATESTADO_OPTIONS:
        raise HTTPException(status_code=400, detail=f"Atestado inválido. Use: {', '.join(ATESTADO_OPTIONS)}")
    if "current_step" in updates and "status_atual" not in updates:
        idx = max(0, min(updates["current_step"], len(TIMELINE_STEPS) - 1))
        updates["status_atual"] = TIMELINE_STEPS[idx]
    if "status_atual" in updates and "current_step" not in updates and updates["status_atual"] in TIMELINE_STEPS:
        updates["current_step"] = TIMELINE_STEPS.index(updates["status_atual"])
    if updates:
        res = await db.executions.update_one(
            {"bid_id": bid_id, "owner_id": owner, "remessas.id": remessa_id},
            {"$set": {f"remessas.$[r].{k}": v for k, v in updates.items()}},
            array_filters=[{"r.id": remessa_id}],
        )
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Remessa não encontrada")
    return await _response(bid_id, owner)


class RemessaDocInput(BaseModel):
    file: dict   # {id, filename, url} — já enviado por POST /api/upload (R2)


def _check_categoria(categoria: str) -> str:
    if categoria not in DOC_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria inválida. Use: {', '.join(DOC_CATEGORIES)}")
    return categoria


@remessas_router.post("/executions/{bid_id}/remessas/{remessa_id}/documentos/{categoria}")
async def add_remessa_doc(bid_id: str, remessa_id: str, categoria: str, body: RemessaDocInput, current=Depends(get_current_user)):
    _check_categoria(categoria)
    owner = uid(current)
    await _require_execution(bid_id, owner)
    res = await db.executions.update_one(
        {"bid_id": bid_id, "owner_id": owner, "remessas.id": remessa_id},
        {"$push": {f"remessas.$[r].documentos.{categoria}": {**body.file, "uploaded_at": now_iso()}}},
        array_filters=[{"r.id": remessa_id}],
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Remessa não encontrada")
    return await _response(bid_id, owner)


@remessas_router.delete("/executions/{bid_id}/remessas/{remessa_id}/documentos/{categoria}/{file_id}")
async def remove_remessa_doc(bid_id: str, remessa_id: str, categoria: str, file_id: str, current=Depends(get_current_user)):
    """Desvincula o documento da remessa (o arquivo continua guardado no R2)."""
    _check_categoria(categoria)
    owner = uid(current)
    await _require_execution(bid_id, owner)
    res = await db.executions.update_one(
        {"bid_id": bid_id, "owner_id": owner, "remessas.id": remessa_id},
        {"$pull": {f"remessas.$[r].documentos.{categoria}": {"id": file_id}}},
        array_filters=[{"r.id": remessa_id}],
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Remessa não encontrada")
    return await _response(bid_id, owner)


@remessas_router.delete("/executions/{bid_id}/remessas/{remessa_id}")
async def delete_remessa(bid_id: str, remessa_id: str, current=Depends(get_current_user)):
    """Exclusão SEM perda: a remessa sai da execução e fica guardada em
    `remessas_excluidas` (com o orçamento marcado `deleted_at`). Uma execução com
    remessas precisa manter ao menos uma."""
    owner = uid(current)
    ex = await _require_execution(bid_id, owner)
    alvo = next((r for r in ex.get("remessas") or [] if r.get("id") == remessa_id), None)
    if not alvo:
        raise HTTPException(status_code=404, detail="Remessa não encontrada")
    res = await db.executions.update_one(
        {"_id": ex["_id"], "owner_id": owner, "remessas.id": remessa_id, "remessas.1": {"$exists": True}},
        {"$pull": {"remessas": {"id": remessa_id}},
         "$push": {"remessas_excluidas": {**alvo, "excluida_em": now_iso()}}},
    )
    if not res.matched_count:
        raise HTTPException(status_code=400, detail="A licitação precisa manter ao menos uma remessa.")
    await db.remessa_budgets.update_one(
        {"bid_id": bid_id, "owner_id": owner, "remessa_id": remessa_id}, {"$set": {"deleted_at": now_iso()}})
    return await _response(bid_id, owner)
