"""Integração Execução & Pós-Venda -> Financeiro (recebíveis).

Fluxo (nunca automático):
    Execução "Enviar para Recebíveis" -> SOLICITAÇÃO (fin_requests, status pendente)
    -> Financeiro aprova (informa o vencimento/previsão) -> RECEBÍVEL oficial
       (fin_entries tipo receber, com `request_id`)
    -> ou rejeita (com motivo) -> a Execução vê "Rejeitado" e pode reenviar.

Enquanto pendente, a solicitação NÃO é recebível: não entra em A Receber, nos
cards nem no Caixa Projetado (essas consultas só leem fin_entries).

Unidade = a execução inteira (sem remessas) ou UMA remessa. `active_key`
(`bid_id:remessa_id`) só existe enquanto a solicitação está pendente ou aprovada
e tem índice único — então não há duas solicitações ativas para a mesma unidade,
nem dois recebíveis para a mesma solicitação (índice único em request_id).

O valor enviado é o EMPENHO FIXO da unidade (empenho.py), nunca a venda
dinâmica do orçamento. Depois de aprovado, mudar o empenho NUNCA sobrescreve o
recebível: a Execução pergunta e, se o usuário quiser, cria uma SOLICITAÇÃO DE
ATUALIZAÇÃO (`fin_requests.update_request`, no MESMO vínculo — sem novo
lançamento). O Financeiro vê "Alteração recebida da Execução" e decide
Ignorar / Atualizar valor.

A Data de Entrega da Execução é logística e nunca é usada como data financeira."""
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from auth import get_current_user
from db import db, now_iso
from fin_core import (
    CANCELADO, PARCIAL, PENDENTE, RECEBER, RECEBIDO, in_transaction, log_event, new_id, parse_date,
    open_cents, to_cents, today_sp,
)
from fin_contatos import resolve_contact
from financeiro import _entry_label, _entry_out, _resolve_refs, resolve_classification
from routes import TIMELINE_STEPS, _enrich_execution, ser
from analytics import EMPENHO_STEP_INDEX, step_index

rec_router = APIRouter(prefix="/api/fin/recebiveis", tags=["financeiro-recebiveis"])

STEP_DONE = "Concluído"
LEGACY_ATESTADO_STEP = "Solicitar Atestado"


def _key(bid_id: str, remessa_id: Optional[str]) -> str:
    return f"{bid_id}:{remessa_id or ''}"


def _clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("owner_id", None)
    return doc


async def _executions(owner: str, bid_ids: list) -> dict:
    """Execuções enriquecidas (valores do orçamento) por bid_id."""
    out = {}
    async for ex in db.executions.find({"owner_id": owner, "bid_id": {"$in": list(set(bid_ids))}}):
        out[ex["bid_id"]] = await _enrich_execution(ser(ex), owner)
    return out


def _unit(ex: dict, remessa_id: Optional[str]) -> Optional[dict]:
    if not ex:
        return None
    if remessa_id:
        return next((r for r in ex.get("remessas") or [] if r.get("id") == remessa_id), None)
    return ex


def _docs_ref(unit: dict, categoria: str) -> list:
    return [{"id": f.get("id"), "filename": f.get("filename")} for f in (unit.get("documentos") or {}).get(categoria) or []]


# ---------------- Execução: enviar / acompanhar ----------------
class SendInput(BaseModel):
    bid_id: str
    remessa_id: Optional[str] = None
    amount: Optional[Any] = None
    notes: Optional[str] = None


@rec_router.post("/solicitacoes")
async def send_request(body: SendInput, current=Depends(get_current_user)):
    owner = current["id"]
    try:
        bid = await db.bids.find_one({"_id": ObjectId(body.bid_id), "owner_id": owner})
    except Exception:
        bid = None
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    ex = (await _executions(owner, [body.bid_id])).get(body.bid_id)
    if not ex:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    if ex.get("remessas") and not body.remessa_id:
        raise HTTPException(status_code=400, detail="Esta licitação tem remessas: envie cada remessa separadamente.")
    unit = _unit(ex, body.remessa_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Remessa não encontrada")
    # Etapa mínima: a posição da etapa na timeline (índice em TIMELINE_STEPS, mesma
    # leitura robusta das Análises — trata nomes legados), nunca o texto do status.
    if step_index(unit) < EMPENHO_STEP_INDEX:
        raise HTTPException(status_code=400, detail="O envio ao Financeiro só é permitido quando a timeline estiver, no mínimo, na etapa Empenho Recebido.")
    if not unit.get("empenho_informado"):
        raise HTTPException(status_code=400, detail="Informe o valor do empenho antes de enviar ao Financeiro.")
    # Valor = empenho FIXO (nunca a venda selecionada do orçamento).
    valor_execucao = int(unit.get("empenho_cents") or 0)
    if body.amount not in (None, "") and to_cents(body.amount, "valor") != valor_execucao:
        raise HTTPException(status_code=400, detail="O valor enviado ao Financeiro é o valor do empenho. Para mudar, altere o empenho na Execução.")
    amount = valor_execucao
    if amount <= 0:
        raise HTTPException(status_code=400, detail="O valor do empenho deve ser maior que zero.")
    ts = now_iso()
    doc = {
        "id": new_id(), "owner_id": owner, "bid_id": body.bid_id, "remessa_id": body.remessa_id or None,
        "active_key": _key(body.bid_id, body.remessa_id), "status": "pendente",
        "amount_cents": amount, "source_amount_cents": valor_execucao,
        "snapshot": {
            "orgao": bid.get("orgao") or "", "pregao": bid.get("pregao") or "", "uasg": bid.get("uasg") or "",
            "objeto": bid.get("objeto") or "", "portal": bid.get("portal") or "",
            "remessa_nome": unit.get("nome") if body.remessa_id else None,
            "empenhos": _docs_ref(unit, "nota_empenho"), "notas_fiscais": _docs_ref(unit, "nota_fiscal"),
            "etapa": unit.get("status_atual"),
        },
        "notes": (body.notes or "").strip() or None,
        "sent_by": current.get("actor_id") or current["id"], "sent_by_name": current.get("actor_name") or current.get("name"), "sent_at": ts, "updated_at": ts,
    }
    label = _request_label(doc)

    async def tx(s):
        await db.fin_requests.insert_one(doc, session=s)
        await log_event(current, "solicitacao_enviada", module="receber", entity_type="solicitacao", entity_id=doc["id"],
                        entity_label=label, amount_cents=amount, origin="Execução",
                        metadata={"bid_id": body.bid_id, "remessa_id": body.remessa_id, "cliente": doc["snapshot"]["orgao"]},
                        session=s)
    try:
        await in_transaction(tx)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Esta execução já tem uma solicitação pendente ou um recebível aprovado.")
    return _clean(doc)


def _request_label(r: dict) -> str:
    sn = r.get("snapshot") or {}
    partes = [p for p in (f"Pregão {sn['pregao']}" if sn.get("pregao") else "", sn.get("remessa_nome") or "",
                          sn.get("orgao") or (sn.get("objeto") or "")[:50]) if p]
    return " · ".join(partes) or "Solicitação de recebível"


@rec_router.post("/solicitacoes/{request_id}/retirar")
async def withdraw_request(request_id: str, current=Depends(get_current_user)):
    """A Execução retira uma solicitação ainda pendente (para corrigir e reenviar)."""
    owner = current["id"]
    r = await db.fin_requests.find_one({"owner_id": owner, "id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")

    async def tx(s):
        res = await db.fin_requests.update_one({"_id": r["_id"], "status": "pendente"}, {
            "$set": {"status": "retirada", "updated_at": now_iso()}, "$unset": {"active_key": ""}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="A solicitação já foi analisada pelo Financeiro.")
        await log_event(current, "solicitacao_retirada", module="receber", entity_type="solicitacao", entity_id=r["id"],
                        entity_label=_request_label(r), amount_cents=r["amount_cents"], origin="Execução", session=s)
    await in_transaction(tx)
    return {"ok": True}


@rec_router.get("/vinculos")
async def execution_links(current=Depends(get_current_user)):
    """Estado financeiro por unidade da Execução (última solicitação de cada uma):
    nao_enviado (sem registro) | enviado | aprovado | recebido | rejeitado."""
    owner = current["id"]
    latest = {}
    async for r in db.fin_requests.find({"owner_id": owner, "status": {"$ne": "retirada"}}).sort("sent_at", -1):
        k = _key(r["bid_id"], r.get("remessa_id"))
        if k not in latest:
            latest[k] = r
    entry_ids = [r["entry_id"] for r in latest.values() if r.get("entry_id")]
    entries = {e["id"]: e async for e in db.fin_entries.find({"owner_id": owner, "id": {"$in": entry_ids}})}
    out = []
    for k, r in latest.items():
        e = entries.get(r.get("entry_id")) if r.get("entry_id") else None
        estado = {"pendente": "enviado", "rejeitada": "rejeitado", "cancelada": "cancelado"}.get(r["status"], r["status"])
        if r["status"] == "aprovado" and e:
            # Recebimento parcial NÃO conclui: a Execução continua em Aguardando Pagamento.
            estado = {RECEBIDO: "recebido", PARCIAL: "parcial"}.get(e["status"], "aprovado")
        out.append({
            "key": k, "bid_id": r["bid_id"], "remessa_id": r.get("remessa_id"), "request_id": r["id"],
            "estado": estado, "amount_cents": r["amount_cents"], "sent_at": r["sent_at"],
            "rejection_reason": r.get("rejection_reason"), "decided_at": r.get("decided_at"),
            "entry_id": r.get("entry_id"), "entry_status": e["status"] if e else None,
            "due_date": e["due_date"] if e else None, "entry_amount_cents": e["amount_cents"] if e else None,
            "settled_date": e.get("settled_date") if e else None,
            "received_cents": int(e.get("settled_cents") or 0) if e else 0,
            "update_pending": (r.get("update_request") or {}).get("status") == "pendente",
            "update_amount_cents": (r.get("update_request") or {}).get("amount_cents"),
            "open_cents": open_cents(e) if e and e["status"] != CANCELADO else 0,
            "atrasado": bool(e and e["status"] in (PENDENTE, PARCIAL) and e["due_date"] < today_sp()),
        })
    return out


# ---------------- Financeiro: fila, aprovação, rejeição ----------------
@rec_router.get("/solicitacoes")
async def list_requests(status: str = "pendente", current=Depends(get_current_user)):
    owner = current["id"]
    q = {"owner_id": owner}
    if status != "todas":
        q["status"] = {"$in": status.split(",")}
    items = await db.fin_requests.find(q).sort("sent_at", -1).to_list(500)
    execs = await _executions(owner, [r["bid_id"] for r in items if r["status"] == "pendente"])
    out = []
    for r in items:
        item = _clean(r)
        item["label"] = _request_label(r)
        if r["status"] == "pendente":
            unit = _unit(execs.get(r["bid_id"]), r.get("remessa_id"))
            atual = unit.get("empenho_cents") if unit else None
            item["valor_execucao_atual_cents"] = atual
            item["execucao_disponivel"] = unit is not None
        out.append(item)
    return out


class ApproveInput(BaseModel):
    due_date: str
    amount: Optional[Any] = None
    description: Optional[str] = None
    client_supplier: Optional[str] = None
    contact_id: Optional[str] = None     # cliente cadastrado (opcional: sem ele, vale o órgão da licitação)
    category_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    bank_account_id: Optional[str] = None
    notes: Optional[str] = None


@rec_router.post("/solicitacoes/{request_id}/aprovar")
async def approve_request(request_id: str, body: ApproveInput, current=Depends(get_current_user)):
    owner = current["id"]
    r = await db.fin_requests.find_one({"owner_id": owner, "id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    if r["status"] != "pendente":
        raise HTTPException(status_code=409, detail="Esta solicitação já foi analisada.")
    due = parse_date(body.due_date, "data de vencimento/previsão")
    amount = to_cents(body.amount, "valor") if body.amount not in (None, "") else r["amount_cents"]
    refs = await _resolve_refs(owner, RECEBER, {"category_id": body.category_id, "payment_method_id": body.payment_method_id,
                                                "bank_account_id": body.bank_account_id})
    sn = r.get("snapshot") or {}
    # Grupo DRE derivado da categoria escolhida (competência = vencimento, padrão).
    classif = await resolve_classification(owner, body.category_id, None) if body.category_id else {}
    # Cliente cadastrado escolhido na aprovação vira o vínculo; sem escolha, o
    # recebível continua usando o órgão da licitação como texto (compatível).
    contact = await resolve_contact(owner, RECEBER, body.contact_id) if body.contact_id else {
        "contact_id": None, "client_supplier": (body.client_supplier or "").strip() or sn.get("orgao") or None}
    desc = (body.description or "").strip() or f"Recebimento – {_request_label(r)}"
    ts = now_iso()
    entry = {
        "id": new_id(), "owner_id": owner, "type": RECEBER, "description": desc,
        **contact, **refs, **classif, "notes": (body.notes or "").strip() or None,
        "bid_id": r["bid_id"], "remessa_id": r.get("remessa_id"), "request_id": r["id"],
        "bid_label": " · ".join(p for p in (f"Pregão {sn['pregao']}" if sn.get("pregao") else "", sn.get("orgao") or "") if p) or None,
        "amount_cents": amount, "settled_cents": 0, "due_date": due, "status": PENDENTE, "mode": "avista",
        "tag_ids": [], "tag_names": [],
        "sequence_id": None, "sequence_index": None, "sequence_total": None, "frequency": None,
        "origin": "execucao", "created_by": current.get("actor_id") or current["id"], "created_by_name": current.get("actor_name") or current.get("name"),
        "created_at": ts, "updated_at": ts, "version": 1,
    }

    async def tx(s):
        # Transição condicional: dois cliques em "Aprovar" -> só o primeiro passa.
        res = await db.fin_requests.update_one({"_id": r["_id"], "status": "pendente"}, {"$set": {
            "status": "aprovado", "entry_id": entry["id"], "decided_by": current.get("actor_id") or current["id"],
            "decided_by_name": current.get("actor_name") or current.get("name"), "decided_at": ts, "updated_at": ts,
            "approved_amount_cents": amount}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="Esta solicitação já foi analisada.")
        await db.fin_entries.insert_one(entry, session=s)
        await log_event(current, "recebivel_aprovado", module="receber", entity_type="lancamento", entity_id=entry["id"],
                        entity_label=desc, amount_cents=amount, financial_date=due, origin="Execução",
                        metadata={"request_id": r["id"], "valor_solicitado": r["amount_cents"],
                                  "cliente": entry["client_supplier"]}, session=s)
    try:
        await in_transaction(tx)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Esta solicitação já gerou um recebível.")
    return _entry_out(entry, today_sp())


class RejectInput(BaseModel):
    reason: Optional[str] = None


@rec_router.post("/solicitacoes/{request_id}/rejeitar")
async def reject_request(request_id: str, body: RejectInput, current=Depends(get_current_user)):
    owner = current["id"]
    r = await db.fin_requests.find_one({"owner_id": owner, "id": request_id})
    if not r:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    motivo = (body.reason or "").strip() or None
    ts = now_iso()

    async def tx(s):
        res = await db.fin_requests.update_one({"_id": r["_id"], "status": "pendente"}, {
            "$set": {"status": "rejeitada", "rejection_reason": motivo, "decided_by": current.get("actor_id") or current["id"],
                     "decided_by_name": current.get("actor_name") or current.get("name"), "decided_at": ts, "updated_at": ts},
            "$unset": {"active_key": ""}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="Esta solicitação já foi analisada.")
        await log_event(current, "recebivel_rejeitado", module="receber", entity_type="solicitacao", entity_id=r["id"],
                        entity_label=_request_label(r), amount_cents=r["amount_cents"], origin="Execução",
                        metadata={"motivo": motivo, "request_id": r["id"]}, session=s)
    await in_transaction(tx)
    return {"ok": True}


# ---------------- Alterações vindas da Execução depois da aprovação ----------------
# Nada é detectado sozinho: só existe alteração quando a Execução ENVIA uma
# solicitação (botão "Enviar solicitação ao Financeiro"). Ela fica gravada no
# próprio vínculo aprovado (`update_request`) — o mesmo recebível, sem duplicar.
class UpdateRequestInput(BaseModel):
    bid_id: str
    remessa_id: Optional[str] = None


@rec_router.post("/atualizacoes/solicitar")
async def request_update(body: UpdateRequestInput, current=Depends(get_current_user)):
    owner = current["id"]
    r = await db.fin_requests.find_one({"owner_id": owner, "bid_id": body.bid_id, "remessa_id": body.remessa_id or None,
                                        "status": "aprovado"})
    e = await db.fin_entries.find_one({"owner_id": owner, "id": r.get("entry_id")}) if r and r.get("entry_id") else None
    if not r or not e or e["status"] == CANCELADO:
        raise HTTPException(status_code=404, detail="Esta execução não tem lançamento vinculado no Financeiro.")
    ex = await db.executions.find_one({"owner_id": owner, "bid_id": body.bid_id})
    unit = _unit(ex, body.remessa_id)
    novo = unit.get("empenho_cents") if unit else None
    if novo is None:
        raise HTTPException(status_code=400, detail="Informe o valor do empenho.")
    if novo == e["amount_cents"]:
        raise HTTPException(status_code=409, detail="O valor no Financeiro já é igual ao valor do empenho.")
    ts = now_iso()
    pedido = {"status": "pendente", "amount_cents": novo, "previous_cents": e["amount_cents"], "origin": "Execução & Pós-Venda",
              "requested_by": current.get("actor_id") or current["id"],
              "requested_by_name": current.get("actor_name") or current.get("name"), "requested_at": ts}

    async def tx(s):
        await db.fin_requests.update_one({"_id": r["_id"]}, {"$set": {"update_request": pedido, "updated_at": ts}}, session=s)
        await log_event(current, "atualizacao_solicitada", module="receber", entity_type="lancamento", entity_id=e["id"],
                        entity_label=_entry_label(e), amount_cents=novo, origin="Execução",
                        changes=[{"field": "amount_cents", "label": "Valor", "before": e["amount_cents"], "after": novo}],
                        metadata={"request_id": r["id"], "bid_id": body.bid_id, "remessa_id": body.remessa_id}, session=s)
    await in_transaction(tx)
    return {"ok": True, "request_id": r["id"], "amount_cents": novo, "previous_cents": e["amount_cents"]}


@rec_router.get("/atualizacoes")
async def pending_updates(current=Depends(get_current_user)):
    """Solicitações de atualização de valor enviadas pela Execução e ainda não
    decididas. Nada é gravado no recebível aqui — o Financeiro decide."""
    owner = current["id"]
    pedidos = await db.fin_requests.find({"owner_id": owner, "status": "aprovado",
                                          "update_request.status": "pendente"}).to_list(1000)
    if not pedidos:
        return []
    entries = {e["id"]: e async for e in db.fin_entries.find(
        {"owner_id": owner, "id": {"$in": [r.get("entry_id") for r in pedidos]}})}
    out = []
    for r in pedidos:
        e = entries.get(r.get("entry_id"))
        if not e or e["status"] == CANCELADO:
            continue
        up = r["update_request"]
        recebido = int(e.get("settled_cents") or 0)
        sn = r.get("snapshot") or {}
        out.append({"request_id": r["id"], "entry_id": e["id"], "label": _request_label(r),
                    "pregao": sn.get("pregao"), "remessa_nome": sn.get("remessa_nome"),
                    "description": e["description"], "client_supplier": e.get("client_supplier"),
                    "valor_anterior_cents": e["amount_cents"], "valor_novo_cents": up["amount_cents"],
                    "diferenca_cents": up["amount_cents"] - e["amount_cents"], "origem": up.get("origin") or "Execução & Pós-Venda",
                    "requested_at": up.get("requested_at"), "requested_by_name": up.get("requested_by_name"),
                    "entry_status": e["status"], "due_date": e["due_date"], "received_cents": recebido,
                    # Novo valor abaixo do já recebido: não pode ser aplicado sem tratar os recebimentos.
                    "bloqueado": up["amount_cents"] < recebido})
    return out


class UpdateDecision(BaseModel):
    action: str                 # aplicar | ignorar
    valor_novo_cents: int       # o valor que o usuário viu (evita aplicar algo diferente)
    include_settled: bool = False


@rec_router.post("/atualizacoes/{request_id}")
async def decide_update(request_id: str, body: UpdateDecision, current=Depends(get_current_user)):
    owner = current["id"]
    r = await db.fin_requests.find_one({"owner_id": owner, "id": request_id, "status": "aprovado"})
    if not r:
        raise HTTPException(status_code=404, detail="Recebível não encontrado")
    e = await db.fin_entries.find_one({"owner_id": owner, "id": r.get("entry_id")})
    if not e:
        raise HTTPException(status_code=404, detail="Recebível não encontrado")
    up = r.get("update_request") or {}
    if up.get("status") != "pendente":
        raise HTTPException(status_code=409, detail="Esta solicitação de atualização já foi resolvida.")
    novo = int(up["amount_cents"])
    if novo != body.valor_novo_cents:
        raise HTTPException(status_code=409, detail="A Execução enviou outro valor. Recarregue para ver a solicitação atual.")
    ts = now_iso()
    decided = {"update_request.decided_by": current.get("actor_id") or current["id"],
               "update_request.decided_by_name": current.get("actor_name") or current.get("name"),
               "update_request.decided_at": ts, "updated_at": ts}
    pend = {"_id": r["_id"], "update_request.status": "pendente", "update_request.amount_cents": novo}
    if body.action == "ignorar":
        async def tx_ign(s):
            res = await db.fin_requests.update_one(pend, {"$set": {"update_request.status": "ignorada", **decided}}, session=s)
            if not res.modified_count:
                raise HTTPException(status_code=409, detail="Esta solicitação de atualização já foi resolvida.")
            await log_event(current, "atualizacao_ignorada", module="receber", entity_type="lancamento", entity_id=e["id"],
                            entity_label=_entry_label(e), origin="Execução",
                            changes=[{"field": "amount_cents", "label": "Valor solicitado pela Execução",
                                      "before": e["amount_cents"], "after": novo}],
                            metadata={"request_id": r["id"]}, session=s)
        await in_transaction(tx_ign)
        return {"ok": True}
    if body.action != "aplicar":
        raise HTTPException(status_code=400, detail="Ação inválida")
    recebido = int(e.get("settled_cents") or 0)
    if novo < recebido:
        raise HTTPException(status_code=400, detail={"code": "below_received", "msg": (
            f"O novo valor do empenho ({_brl(novo)}) é menor que o total já recebido ({_brl(recebido)}). "
            "Estorne ou corrija os recebimentos antes de atualizar, ou ignore esta solicitação.")})
    if recebido and not body.include_settled:
        raise HTTPException(status_code=409, detail={"code": "settled", "msg": "Este recebível já tem recebimento registrado. Confirme para alterar o valor de um registro realizado."})

    async def tx(s):
        novo_entry = {"amount_cents": novo, "updated_at": ts}
        if recebido:
            # Valor original muda; o total recebido fica intacto e o saldo é recalculado.
            novo_entry["status"] = RECEBIDO if novo == recebido else PARCIAL
        res = await db.fin_requests.update_one(pend, {"$set": {"update_request.status": "aplicada",
                                                               "source_amount_cents": novo, **decided}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="Esta solicitação de atualização já foi resolvida.")
        await db.fin_entries.update_one({"_id": e["_id"]}, {"$set": novo_entry, "$inc": {"version": 1}}, session=s)
        await log_event(current, "recebivel_atualizado", module="receber", entity_type="lancamento", entity_id=e["id"],
                        entity_label=_entry_label(e), amount_cents=novo, origin="Execução",
                        changes=[{"field": "amount_cents", "label": "Valor", "before": e["amount_cents"], "after": novo}],
                        metadata={"request_id": r["id"], "recebido_cents": recebido}, session=s)
    await in_transaction(tx)
    return {"ok": True}


def _brl(cents: int) -> str:
    s = f"{cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


# ---------------- Sincronização com a timeline ----------------
class SyncInput(BaseModel):
    entry_id: str


@rec_router.post("/sincronizar-execucao")
async def sync_execution_paid(body: SyncInput, current=Depends(get_current_user)):
    """Depois de dar baixa no recebível (e o usuário confirmar), move a unidade da
    Execução para "Pagamento Recebido" — mesma gravação que o clique na timeline
    faz: todas as etapas concluídas, anexos antigos preservados."""
    owner = current["id"]
    e = await db.fin_entries.find_one({"owner_id": owner, "id": body.entry_id})
    if not e or not e.get("request_id") or not e.get("bid_id"):
        raise HTTPException(status_code=404, detail="Recebível sem execução vinculada")
    if e["status"] != RECEBIDO:
        # Recebimento parcial: a timeline fica em Aguardando Pagamento até a quitação.
        raise HTTPException(status_code=409, detail="O recebível ainda tem saldo em aberto. A Execução só vai para Pagamento Recebido após a quitação integral.")
    ex = await db.executions.find_one({"owner_id": owner, "bid_id": e["bid_id"]})
    if not ex:
        raise HTTPException(status_code=404, detail="A execução não existe mais (licitação encerrada?).")
    rid = e.get("remessa_id")
    unit = _unit(ex, rid)
    if not unit:
        raise HTTPException(status_code=404, detail="Remessa não encontrada")
    files = {}
    for n in unit.get("timeline") or []:
        name = "Entregue" if n.get("name") == LEGACY_ATESTADO_STEP else n.get("name")
        files.setdefault(name, []).extend(n.get("files") or [])
    nodes = [{"step": i, "name": name, "status": STEP_DONE, "files": files.get(name, [])}
             for i, name in enumerate(TIMELINE_STEPS)]
    patch = {"timeline": nodes, "current_step": len(TIMELINE_STEPS) - 1, "status_atual": TIMELINE_STEPS[-1],
             "pagamento_pendente": False}

    async def tx(s):
        if rid:
            await db.executions.update_one({"_id": ex["_id"], "remessas.id": rid},
                                           {"$set": {f"remessas.$[r].{k}": v for k, v in patch.items()}},
                                           array_filters=[{"r.id": rid}], session=s)
        else:
            await db.executions.update_one({"_id": ex["_id"]}, {"$set": patch}, session=s)
        await log_event(current, "execucao_atualizada", module="execucao", entity_type="execucao", entity_id=e["bid_id"],
                        entity_label=(unit.get("nome") + " · " if rid else "") + (ex.get("objeto") or "")[:60],
                        changes=[{"field": "status_atual", "label": "Etapa", "before": unit.get("status_atual"),
                                  "after": TIMELINE_STEPS[-1]}],
                        financial_date=e.get("settled_date"), metadata={"entry_id": e["id"]}, session=s)
    await in_transaction(tx)
    doc = await db.executions.find_one({"_id": ex["_id"]})
    return await _enrich_execution(ser(doc), owner)


# ---------------- ganchos usados por financeiro.py ----------------
async def release_requests(owner: str, entries: list, current: dict) -> None:
    """Recebível vindo da Execução foi cancelado/excluído: a solicitação deixa de
    estar ativa, então a Execução pode enviar de novo."""
    for e in entries:
        await db.fin_requests.update_one(
            {"owner_id": owner, "id": e["request_id"], "status": "aprovado"},
            {"$set": {"status": "cancelada", "updated_at": now_iso()}, "$unset": {"active_key": ""}})


async def reactivate_request(owner: str, entry: dict) -> None:
    r = await db.fin_requests.find_one({"owner_id": owner, "id": entry["request_id"]})
    if not r or r["status"] != "cancelada":
        return
    try:
        await db.fin_requests.update_one({"_id": r["_id"]}, {"$set": {
            "status": "aprovado", "active_key": _key(r["bid_id"], r.get("remessa_id")), "updated_at": now_iso()}})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="A Execução já enviou outra solicitação para esta unidade. Este recebível não pode ser reativado.")

