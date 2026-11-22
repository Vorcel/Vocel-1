"""Valor do EMPENHO — dado próprio e FIXO da execução (ou de cada remessa).

Antes desta regra o empenho era DERIVADO do orçamento (soma das linhas
selecionadas): marcar uma cotação a mais inflava o empenho, o lucro e o valor
mandado ao Financeiro. Agora:

- Empenho  = valor persistido em `empenho_cents` (centavos inteiros). Nunca é
  recalculado pelo orçamento — só muda por ação explícita (confirmação na
  adjudicação, confirmação em "Empenho Recebido" ou edição), sempre com histórico.
- Compra   = custo das linhas selecionadas do orçamento (dinâmico, como sempre).
- Lucro    = Empenho − Compra.
- Venda selecionada (valor_total do orçamento) só serve para CONFERÊNCIA:
  qualquer diferença em centavos marca `empenho_divergente` (célula vermelha).

Estados: `informado` (adjudicação / criação da remessa / migração) e
`confirmado` (conferido ao avançar para "Empenho Recebido").

O Financeiro NUNCA é alterado aqui: se já existe recebível aprovado, a Execução
pode enviar uma solicitação de atualização (fin_recebiveis.request_update)."""
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import audit, get_current_user
from db import db, now_iso
from fin_core import to_cents

empenho_router = APIRouter(prefix="/api", tags=["empenho"])

INFORMADO = "informado"
CONFIRMADO = "confirmado"
EMPENHO_STEP = "Empenho Recebido"

# Campos do empenho: só estas rotas gravam (o PUT genérico da execução os descarta).
EMPENHO_FIELDS = ("empenho_cents", "empenho_status", "empenho_informado_em", "empenho_informado_por",
                  "empenho_informado_por_nome", "empenho_confirmado_em", "empenho_confirmado_por",
                  "empenho_confirmado_por_nome", "empenho_historico")

ORIGENS = {
    "adjudicacao": "Envio para Adjudicado",
    "empenho_recebido": "Confirmação em Empenho Recebido",
    "edicao": "Edição do valor",
    "remessa_criada": "Criação da remessa",
    "migracao": "Valor congelado na atualização do sistema",
}


def money_cents(v: Any) -> int:
    """Float/texto do orçamento -> centavos (Decimal, arredondamento comercial).
    É a MESMA conversão para os dois lados da comparação Empenho x Venda, então
    R$ 100,00 nunca difere de R$ 100,00 por ponto flutuante."""
    try:
        d = Decimal(repr(v)) if isinstance(v, float) else Decimal(str(v or 0))
    except Exception:
        return 0
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_empenho(v: Any) -> int:
    return to_cents(v, "valor do empenho")


def _actor(current: dict) -> tuple:
    return current.get("actor_id") or current["id"], current.get("actor_name") or current.get("name") or ""


def apply_values(unit: dict, totals: dict) -> None:
    """Injeta Empenho (fixo), Compra/Lucro (dinâmicos) e a conferência na unidade
    (execução sem remessas ou uma remessa). `totals` = resumo do orçamento dela."""
    venda_cents = money_cents(totals.get("valor_total"))
    compra = float(totals.get("custo_global") or 0)
    cents = unit.get("empenho_cents")
    unit["valor_compra"] = compra
    unit["venda_orcamento"] = venda_cents / 100
    unit["venda_orcamento_cents"] = venda_cents
    if isinstance(cents, int) and not isinstance(cents, bool):
        unit["valor_empenho"] = cents / 100
        unit["lucro_previsto"] = round(cents / 100 - compra, 2)
        unit["empenho_informado"] = True
        unit["empenho_divergente"] = cents != venda_cents
    else:
        # Sem empenho gravado (só remessa/execução antiga ainda não migrada): nada
        # é inventado a partir do orçamento — a célula pede "Informar".
        unit["valor_empenho"] = None
        unit["lucro_previsto"] = None
        unit["empenho_informado"] = False
        unit["empenho_divergente"] = True
    unit.setdefault("empenho_status", None)
    unit.pop("empenho_historico", None)   # histórico fica no banco/auditoria, não na listagem


def _history_entry(current: dict, before: Optional[int], after: int, origem: str, etapa: Optional[str], acao: str) -> dict:
    aid, aname = _actor(current)
    return {"ts": now_iso(), "actor_id": aid, "actor_name": aname, "before_cents": before, "after_cents": after,
            "origem": origem, "etapa": etapa, "acao": acao}


def empenho_set(current: dict, unit: dict, cents: int, origem: str, *, confirmar: bool, acao: str) -> dict:
    """Campos a gravar ($set) para definir/confirmar o empenho de uma unidade."""
    aid, aname = _actor(current)
    ts = now_iso()
    out = {"empenho_cents": cents}
    if confirmar:
        out.update({"empenho_status": CONFIRMADO, "empenho_confirmado_em": ts,
                    "empenho_confirmado_por": aid, "empenho_confirmado_por_nome": aname})
    else:
        out.update({"empenho_status": INFORMADO, "empenho_informado_em": ts,
                    "empenho_informado_por": aid, "empenho_informado_por_nome": aname})
    out["_hist"] = _history_entry(current, unit.get("empenho_cents"), cents, origem, unit.get("status_atual"), acao)
    return out


def _fmt(cents: Optional[int]) -> str:
    if cents is None:
        return "—"
    s = f"{cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


AUDIT_ACTIONS = {
    "informado": "empenho_informado",                 # Valor inicial do empenho informado
    "confirmado": "empenho_confirmado",               # Valor do empenho confirmado
    "alterado_confirmado": "empenho_alterado_confirmado",
    "alterado": "empenho_alterado",
}


async def audit_empenho(current: dict, kind: str, *, bid_id: str, label: str, before: Optional[int], after: int,
                        origem: str, etapa: Optional[str], remessa: Optional[dict] = None) -> None:
    meta = {"origem": ORIGENS.get(origem, origem), "etapa": etapa, "before_cents": before, "after_cents": after}
    if remessa:
        meta.update({"remessa_id": remessa.get("id"), "remessa": remessa.get("nome")})
        label = f"{label} · {remessa.get('nome') or 'Remessa'}"
    await audit(current, AUDIT_ACTIONS[kind], module="execucao", entity_type="execucao", entity_id=bid_id,
                entity_label=label,
                changes=[{"field": "empenho", "label": "Valor do empenho", "before": _fmt(before), "after": _fmt(after)}],
                metadata=meta)


async def write_unit(owner: str, bid_id: str, remessa_id: Optional[str], fields: dict) -> bool:
    """Grava os campos do empenho na execução ou numa remessa (posicional)."""
    fields = dict(fields)
    hist = fields.pop("_hist", None)
    if remessa_id:
        upd = {"$set": {f"remessas.$[r].{k}": v for k, v in fields.items()}}
        if hist:
            upd["$push"] = {"remessas.$[r].empenho_historico": hist}
        res = await db.executions.update_one({"bid_id": bid_id, "owner_id": owner, "remessas.id": remessa_id}, upd,
                                             array_filters=[{"r.id": remessa_id}])
    else:
        upd = {"$set": fields}
        if hist:
            upd["$push"] = {"empenho_historico": hist}
        res = await db.executions.update_one({"bid_id": bid_id, "owner_id": owner}, upd)
    return bool(res.matched_count)


async def set_initial(current: dict, bid: dict, cents: int) -> None:
    """Primeira confirmação (envio para Adjudicado): grava o empenho na execução
    recém-criada/restaurada. Chamado DEPOIS de _sync_execution."""
    bid_id = str(bid["_id"])
    owner = bid.get("owner_id")
    ex = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not ex:
        return
    fields = empenho_set(current, ex, cents, "adjudicacao", confirmar=False, acao="informado")
    await write_unit(owner, bid_id, None, fields)
    await audit_empenho(current, "informado", bid_id=bid_id, label=ex.get("objeto") or "Execução",
                        before=ex.get("empenho_cents"), after=cents, origem="adjudicacao", etapa=ex.get("status_atual"))


async def suggestion(owner: str, bid_id: str) -> dict:
    bud = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner}, {"summary": 1}) or {}
    return {"venda_orcamento_cents": money_cents((bud.get("summary") or {}).get("valor_total"))}


# ---------------- rotas ----------------
class EmpenhoInput(BaseModel):
    acao: str                      # "confirmar" (mantém o valor) | "editar" (novo valor)
    valor: Optional[Any] = None    # obrigatório em "editar"
    origem: str = "empenho_recebido"   # empenho_recebido | edicao


async def _financial_link(owner: str, bid_id: str, remessa_id: Optional[str]) -> Optional[dict]:
    """Recebível OFICIAL (solicitação aprovada com lançamento) desta unidade."""
    r = await db.fin_requests.find_one({"owner_id": owner, "bid_id": bid_id, "remessa_id": remessa_id or None,
                                        "status": "aprovado"})
    if not r or not r.get("entry_id"):
        return None
    e = await db.fin_entries.find_one({"owner_id": owner, "id": r["entry_id"]})
    if not e or e.get("status") == "cancelado":
        return None
    pend = (r.get("update_request") or {})
    return {"request_id": r["id"], "entry_id": e["id"], "entry_amount_cents": e["amount_cents"],
            "received_cents": int(e.get("settled_cents") or 0),
            "update_pending": pend.get("status") == "pendente", "update_amount_cents": pend.get("amount_cents")}


async def _sync_pending_request(current: dict, owner: str, bid_id: str, remessa_id: Optional[str], novo: int) -> Optional[dict]:
    """Solicitação ainda PENDENTE de aprovação no Financeiro (fin_requests,
    status "pendente", mesma unidade bid_id + remessa_id — o índice único em
    active_key garante que só existe uma): passa AUTOMATICAMENTE para o novo
    empenho. É a MESMA solicitação (nada é criado); o valor enviado
    originalmente e cada alteração ficam no histórico (amount_history + fin_audit)."""
    from fin_core import in_transaction, log_event
    r = await db.fin_requests.find_one({"owner_id": owner, "bid_id": bid_id, "remessa_id": remessa_id or None,
                                        "status": "pendente"})
    if not r or r.get("amount_cents") == novo:
        return None
    aid, aname = _actor(current)
    ts = now_iso()
    antes = r["amount_cents"]
    original = r.get("original_amount_cents", antes)
    passo = {"ts": ts, "before_cents": antes, "after_cents": novo, "actor_id": aid, "actor_name": aname,
             "origin": "Execução & Pós-Venda"}

    async def tx(s):
        # Condicional: se o Financeiro aprovou/rejeitou neste meio-tempo, nada muda.
        res = await db.fin_requests.update_one(
            {"_id": r["_id"], "status": "pendente", "amount_cents": antes},
            {"$set": {"amount_cents": novo, "source_amount_cents": novo, "original_amount_cents": original,
                      "updated_after_send": True, "updated_at": ts},
             "$push": {"amount_history": passo}}, session=s)
        if not res.modified_count:
            return
        sn = r.get("snapshot") or {}
        label = " · ".join(p for p in (f"Pregão {sn['pregao']}" if sn.get("pregao") else "", sn.get("remessa_nome") or "",
                                       sn.get("orgao") or (sn.get("objeto") or "")[:50]) if p) or "Solicitação de recebível"
        await log_event(current, "solicitacao_valor_atualizado", module="receber", entity_type="solicitacao",
                        entity_id=r["id"], entity_label=label, amount_cents=novo, origin="Execução",
                        changes=[{"field": "amount_cents", "label": "Valor", "before": antes, "after": novo}],
                        metadata={"valor_original_enviado_cents": original, "bid_id": bid_id, "remessa_id": remessa_id},
                        session=s)
    await in_transaction(tx)
    return {"request_id": r["id"], "before_cents": antes, "after_cents": novo, "original_cents": original}


async def _save(bid_id: str, remessa_id: Optional[str], body: EmpenhoInput, current: dict) -> dict:
    from routes import _enrich_execution, _owned_bid, ser, uid
    owner = uid(current)
    if body.acao not in ("confirmar", "editar"):
        raise HTTPException(status_code=400, detail="Ação inválida. Use: confirmar, editar")
    if body.origem not in ("empenho_recebido", "edicao"):
        raise HTTPException(status_code=400, detail="Origem inválida")
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    ex = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not ex:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    unit = ex
    if remessa_id:
        unit = next((r for r in ex.get("remessas") or [] if r.get("id") == remessa_id), None)
        if not unit:
            raise HTTPException(status_code=404, detail="Remessa não encontrada")
    elif ex.get("remessas"):
        raise HTTPException(status_code=400, detail="Esta licitação tem remessas: o empenho é informado em cada remessa.")
    before = unit.get("empenho_cents")
    if body.acao == "confirmar":
        if before is None:
            raise HTTPException(status_code=400, detail="Informe o valor do empenho.")
        cents = before
    else:
        cents = parse_empenho(body.valor)
    confirmar = body.origem == "empenho_recebido" or unit.get("empenho_status") == CONFIRMADO
    mudou = cents != before
    kind = ("alterado_confirmado" if mudou else "confirmado") if body.origem == "empenho_recebido" else "alterado"
    if not mudou and body.origem == "edicao":
        doc = await db.executions.find_one({"_id": ex["_id"]})
        return {"execution": await _enrich_execution(ser(doc), owner), "changed": False,
                "financeiro": await _financial_link(owner, bid_id, remessa_id)}
    fields = empenho_set(current, unit, cents, body.origem, confirmar=confirmar, acao=kind)
    if not confirmar:
        # Edição antes do "Empenho Recebido" mantém o estado "informado" sem
        # sobrescrever quem informou primeiro.
        for k in ("empenho_informado_em", "empenho_informado_por", "empenho_informado_por_nome"):
            if unit.get(k):
                fields.pop(k, None)
    await write_unit(owner, bid_id, remessa_id, fields)
    await audit_empenho(current, kind, bid_id=bid_id, label=ex.get("objeto") or "Execução", before=before, after=cents,
                        origem=body.origem, etapa=unit.get("status_atual"), remessa=unit if remessa_id else None)
    # Financeiro: NÃO ENVIADO -> nada; PENDENTE -> sincroniza a mesma solicitação
    # (sem pop-up); APROVADO/VINCULADO -> devolve o vínculo e a tela pergunta.
    pendente = await _sync_pending_request(current, owner, bid_id, remessa_id, cents) if mudou else None
    doc = await db.executions.find_one({"_id": ex["_id"]})
    return {"execution": await _enrich_execution(ser(doc), owner), "changed": mudou, "before_cents": before,
            "after_cents": cents, "pendente_sincronizada": pendente,
            "financeiro": await _financial_link(owner, bid_id, remessa_id)}


@empenho_router.put("/executions/{bid_id}/empenho")
async def save_execution_empenho(bid_id: str, body: EmpenhoInput, current=Depends(get_current_user)):
    return await _save(bid_id, None, body, current)


@empenho_router.put("/executions/{bid_id}/remessas/{remessa_id}/empenho")
async def save_remessa_empenho(bid_id: str, remessa_id: str, body: EmpenhoInput, current=Depends(get_current_user)):
    return await _save(bid_id, remessa_id, body, current)


@empenho_router.get("/bids/{bid_id}/empenho-sugestao")
async def empenho_suggestion(bid_id: str, current=Depends(get_current_user)):
    """Valor total de venda das linhas selecionadas do orçamento — só SUGESTÃO
    para o pop-up de adjudicação (o usuário confirma ou altera)."""
    from routes import _owned_bid, uid
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    return await suggestion(owner, bid_id)
