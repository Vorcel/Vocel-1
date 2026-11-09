"""Módulo Financeiro: cadastros, lançamentos (a pagar / a receber), baixas,
projeção de caixa e histórico de auditoria.

Modelagem (todas as coleções filtradas por `owner_id`, como o resto do Vorcel):
- `fin_cadastros` — categorias, formas de pagamento, contas bancárias e cartões,
  um documento por item com `kind` = categoria | forma | conta | cartao. Uma única
  coleção porque o ciclo de vida é o mesmo (criar / editar / inativar / excluir
  se não estiver em uso). Excluir item em uso é bloqueado: o caminho é inativar.
- `fin_entries` — UM documento por ocorrência financeira. Parcelado e recorrente
  geram N documentos com o mesmo `sequence_id` (+ `sequence_index`/`sequence_total`);
  NÃO existe registro "pai" da série, então nenhuma soma pode contar a série duas
  vezes. Valores em centavos (`amount_cents`).
- `fin_settlements` — cada baixa (pagamento/recebimento, total ou PARCIAL) é um
  registro; estorno marca `reversed` (nunca apaga). O lançamento guarda a soma
  das baixas ativas em `settled_cents` (mesma transação).
- Tags: cadastros `kind="tag"`; o lançamento guarda `tag_ids` (+ nomes como snapshot).
- `fin_audit` — histórico imutável (só inserção; nenhuma rota edita ou apaga).
- `fin_settings` — marca por usuário de que os cadastros mínimos já foram criados.

Saldo bancário: o usuário informa o saldo da conta (ajuste manual). A partir desse
momento, cada baixa registrada naquela conta soma (recebimento) ou subtrai
(pagamento) — por isso pagar uma conta tira o valor da previsão E do saldo, sem
inflar o caixa projetado. Estornar a baixa desfaz o efeito automaticamente,
porque o saldo é sempre derivado das baixas ativas.

Previsões (cards, fluxo, vencidas) usam sempre o SALDO EM ABERTO
(amount_cents − settled_cents) de lançamentos pendentes ou parciais."""
import re
import unicodedata
from datetime import date, datetime, time, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth import get_current_user
from db import db, now_iso
from fin_contatos import resolve_contact
from fin_core import (
    ATRASADO, CANCELADO, MAX_OCCURRENCES, MODES, OPEN, OPEN_EXPR, PAGAR, PARCIAL, PENDENTE, RECEBER,
    RECEBIDO, SETTLED, SP_TZ, TYPES, brl, days_between, diff, effective_status, in_transaction, log_event,
    new_id, occurrence_dates, open_cents, parse_date, settled_status, shift_days, signed_cents,
    split_installments, to_cents, today_sp,
)

fin_router = APIRouter(prefix="/api/fin", tags=["financeiro"])


def _owner(current: dict) -> str:
    return current["id"]


def _clean(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("owner_id", None)
    return doc


# =================== CADASTROS ===================
KINDS = {
    "categoria": "Categoria",
    "forma": "Forma de pagamento",
    "conta": "Conta bancária",
    "cartao": "Cartão",
    "tag": "Tag",
}
CATEGORY_TYPES = ("receita", "despesa")
ACCOUNT_TYPES = ("corrente", "poupanca", "pagamento", "investimento", "caixa")
# Campos editáveis por tipo de cadastro (o resto é ignorado).
KIND_FIELDS = {
    "categoria": ("nome", "tipo", "icone", "cor", "ativo"),
    "forma": ("nome", "icone", "ativo"),
    "conta": ("nome", "instituicao", "titular", "tipo_conta", "agencia", "numero", "logo_preset",
              "logo_file_id", "ativo", "observacao"),
    "cartao": ("nome", "instituicao", "bandeira", "final", "fechamento_dia", "vencimento_dia", "limite",
               "conta_id", "logo_preset", "imagem_file_id", "ativo", "observacao"),
    "tag": ("nome", "cor", "ativo"),
}
FIELD_LABELS = {
    "nome": "Nome", "tipo": "Tipo", "icone": "Ícone", "cor": "Cor", "ativo": "Ativo",
    "instituicao": "Instituição", "titular": "Titular", "tipo_conta": "Tipo de conta", "agencia": "Agência",
    "numero": "Conta", "logo_preset": "Logo", "logo_file_id": "Logo (imagem)", "observacao": "Observação",
    "bandeira": "Bandeira", "final": "Final", "fechamento_dia": "Fechamento", "vencimento_dia": "Vencimento",
    "limite_cents": "Limite", "conta_id": "Conta associada", "imagem_file_id": "Imagem do cartão",
}

# Cadastros mínimos criados UMA vez por usuário (formas de pagamento comuns e
# poucas categorias básicas). O usuário edita, inativa ou exclui à vontade.
DEFAULT_FORMAS = [("Pix", "QrCode"), ("Boleto", "Barcode"), ("Cartão", "CreditCard"),
                  ("Transferência", "ArrowLeftRight"), ("Dinheiro", "Banknote"), ("Outro", "CircleEllipsis")]
DEFAULT_CATEGORIAS = [
    ("Recebimento de Licitações", "receita", "Landmark", "#059669"),
    ("Fornecedores / Mercadorias", "despesa", "Package", "#D97706"),
    ("Impostos", "despesa", "Receipt", "#DC2626"),
    ("Frete e Transporte", "despesa", "Truck", "#2563EB"),
    ("Despesas Administrativas", "despesa", "Briefcase", "#64748B"),
]


async def _ensure_defaults(owner: str) -> None:
    prev = await db.fin_settings.find_one_and_update(
        {"owner_id": owner}, {"$setOnInsert": {"owner_id": owner, "seeded_at": now_iso()}},
        upsert=True, return_document=ReturnDocument.BEFORE)
    if prev is not None:
        return
    ts = now_iso()
    docs = [{"id": new_id(), "owner_id": owner, "kind": "forma", "nome": n, "icone": i, "ativo": True,
             "ordem": k, "created_at": ts, "updated_at": ts} for k, (n, i) in enumerate(DEFAULT_FORMAS)]
    docs += [{"id": new_id(), "owner_id": owner, "kind": "categoria", "nome": n, "tipo": t, "icone": i, "cor": c,
              "ativo": True, "ordem": k, "created_at": ts, "updated_at": ts}
             for k, (n, t, i, c) in enumerate(DEFAULT_CATEGORIAS)]
    await db.fin_cadastros.insert_many(docs)


async def _account_balances(owner: str, ids: Optional[list] = None) -> dict:
    """Saldo atual de cada conta = saldo informado + baixas (fin_settlements ativas)
    registradas DEPOIS do ajuste."""
    q = {"owner_id": owner, "kind": "conta"}
    if ids is not None:
        q["id"] = {"$in": ids}
    contas = await db.fin_cadastros.find(q).to_list(500)
    out = {}
    for c in contas:
        saldo = int(c.get("saldo_inicial_cents") or 0)
        since = c.get("saldo_at") or ""
        pipeline = [
            {"$match": {"owner_id": owner, "bank_account_id": c["id"], "reversed": {"$ne": True},
                        "created_at": {"$gt": since}}},
            {"$group": {"_id": "$type", "total": {"$sum": "$amount_cents"}}},
        ]
        async for g in db.fin_settlements.aggregate(pipeline):
            saldo += g["total"] if g["_id"] == RECEBER else -g["total"]
        out[c["id"]] = saldo
    return out


async def _usage(owner: str, item_id: str) -> int:
    n = await db.fin_entries.count_documents({"owner_id": owner, "$or": [
        {"category_id": item_id}, {"payment_method_id": item_id}, {"bank_account_id": item_id},
        {"card_id": item_id}, {"tag_ids": item_id}]})
    n += await db.fin_settlements.count_documents({"owner_id": owner, "$or": [
        {"bank_account_id": item_id}, {"payment_method_id": item_id}]})
    n += await db.fin_cadastros.count_documents({"owner_id": owner, "kind": "cartao", "conta_id": item_id})
    return n


@fin_router.get("/cadastros")
async def list_cadastros(current=Depends(get_current_user)):
    owner = _owner(current)
    await _ensure_defaults(owner)
    docs = await db.fin_cadastros.find({"owner_id": owner}).sort([("ordem", 1), ("created_at", 1)]).to_list(2000)
    saldos = await _account_balances(owner)
    out = {"categoria": [], "forma": [], "conta": [], "cartao": [], "tag": []}
    for d in docs:
        item = _clean(d)
        if d["kind"] == "conta":
            item["saldo_atual_cents"] = saldos.get(d["id"], 0)
        out.setdefault(d["kind"], []).append(item)
    return out


class CadastroInput(BaseModel):
    model_config = {"extra": "ignore"}
    nome: Optional[str] = None
    tipo: Optional[str] = None
    icone: Optional[str] = None
    cor: Optional[str] = None
    ativo: Optional[bool] = None
    instituicao: Optional[str] = None
    titular: Optional[str] = None
    tipo_conta: Optional[str] = None
    agencia: Optional[str] = None
    numero: Optional[str] = None
    logo_preset: Optional[str] = None
    logo_file_id: Optional[str] = None
    observacao: Optional[str] = None
    bandeira: Optional[str] = None
    final: Optional[str] = None
    fechamento_dia: Optional[int] = None
    vencimento_dia: Optional[int] = None
    limite: Optional[Any] = None
    conta_id: Optional[str] = None
    imagem_file_id: Optional[str] = None
    # Só na criação da conta: saldo inicial e a data a que ele se refere.
    saldo: Optional[Any] = None
    saldo_data: Optional[str] = None


def _check_kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Cadastro inválido")
    return kind


async def _validated_fields(owner: str, kind: str, body: CadastroInput, creating: bool) -> dict:
    sent = body.model_fields_set
    data = {}
    for f in KIND_FIELDS[kind]:
        if f in sent:
            v = getattr(body, f)
            data[f] = v.strip() if isinstance(v, str) else v
    if creating or "nome" in data:
        if not (data.get("nome") or "").strip():
            raise HTTPException(status_code=400, detail="Informe o nome.")
    if kind == "categoria" and (creating or "tipo" in data):
        if data.get("tipo") not in CATEGORY_TYPES:
            raise HTTPException(status_code=400, detail="Tipo da categoria deve ser Receita ou Despesa.")
    if kind == "conta" and data.get("tipo_conta") and data["tipo_conta"] not in ACCOUNT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de conta inválido.")
    if kind == "cartao":
        if data.get("final") and not re.fullmatch(r"\d{4}", data["final"]):
            raise HTTPException(status_code=400, detail="Informe apenas os 4 últimos dígitos do cartão.")
        for f in ("fechamento_dia", "vencimento_dia"):
            if data.get(f) is not None and not 1 <= int(data[f]) <= 31:
                raise HTTPException(status_code=400, detail="Dia de fechamento/vencimento deve ser entre 1 e 31.")
        if "limite" in data:
            lim = data.pop("limite")
            data["limite_cents"] = to_cents(lim, "limite", allow_zero=True) if lim not in (None, "") else None
        if data.get("conta_id"):
            if not await db.fin_cadastros.find_one({"owner_id": owner, "kind": "conta", "id": data["conta_id"]}):
                raise HTTPException(status_code=400, detail="Conta associada não encontrada.")
    for f in ("logo_file_id", "imagem_file_id"):
        if data.get(f) and not await db.files.find_one({"id": data[f], "owner_id": owner, "is_deleted": False}):
            raise HTTPException(status_code=400, detail="Imagem não encontrada.")
    return data


@fin_router.post("/cadastros/{kind}")
async def create_cadastro(kind: str, body: CadastroInput, current=Depends(get_current_user)):
    owner = _owner(current)
    _check_kind(kind)
    data = await _validated_fields(owner, kind, body, creating=True)
    ts = now_iso()
    doc = {"id": new_id(), "owner_id": owner, "kind": kind, "ativo": True, **data,
           "ordem": await db.fin_cadastros.count_documents({"owner_id": owner, "kind": kind}),
           "created_by": current["id"], "created_at": ts, "updated_at": ts}
    if kind == "conta":
        doc["saldo_inicial_cents"] = signed_cents(body.saldo)
        doc["saldo_data"] = parse_date(body.saldo_data, "data do saldo") if body.saldo_data else today_sp()
        doc["saldo_at"] = ts

    async def tx(s):
        await db.fin_cadastros.insert_one(doc, session=s)
        await log_event(current, f"{kind}_criado", module="bancos" if kind in ("conta", "cartao") else "config",
                        entity_type=kind, entity_id=doc["id"], entity_label=doc["nome"],
                        amount_cents=doc.get("saldo_inicial_cents"), session=s)
    await in_transaction(tx)
    item = _clean(doc)
    if kind == "conta":
        item["saldo_atual_cents"] = doc["saldo_inicial_cents"]
    return item


@fin_router.put("/cadastros/{kind}/{item_id}")
async def update_cadastro(kind: str, item_id: str, body: CadastroInput, current=Depends(get_current_user)):
    owner = _owner(current)
    _check_kind(kind)
    before = await db.fin_cadastros.find_one({"owner_id": owner, "kind": kind, "id": item_id})
    if not before:
        raise HTTPException(status_code=404, detail=f"{KINDS[kind]} não encontrada")
    data = await _validated_fields(owner, kind, body, creating=False)
    if kind == "cartao" and data.get("conta_id") == item_id:
        data.pop("conta_id")
    changes = diff(before, data, FIELD_LABELS)
    if not changes:
        return _clean(before)
    action = f"{kind}_inativado" if data.get("ativo") is False and before.get("ativo", True) else (
        f"{kind}_reativado" if data.get("ativo") is True and before.get("ativo") is False else f"{kind}_editado")

    async def tx(s):
        await db.fin_cadastros.update_one({"_id": before["_id"]}, {"$set": {**data, "updated_at": now_iso()}}, session=s)
        await log_event(current, action, module="bancos" if kind in ("conta", "cartao") else "config",
                        entity_type=kind, entity_id=item_id, entity_label=data.get("nome") or before.get("nome", ""),
                        changes=changes, session=s)
    await in_transaction(tx)
    doc = await db.fin_cadastros.find_one({"_id": before["_id"]})
    item = _clean(doc)
    if kind == "conta":
        item["saldo_atual_cents"] = (await _account_balances(owner, [item_id])).get(item_id, 0)
    return item


@fin_router.delete("/cadastros/{kind}/{item_id}")
async def delete_cadastro(kind: str, item_id: str, current=Depends(get_current_user)):
    owner = _owner(current)
    _check_kind(kind)
    doc = await db.fin_cadastros.find_one({"owner_id": owner, "kind": kind, "id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{KINDS[kind]} não encontrada")
    em_uso = await _usage(owner, item_id)
    if em_uso:
        # Integridade histórica: lançamentos antigos continuam apontando para o item.
        raise HTTPException(status_code=409, detail={
            "code": "in_use", "count": em_uso,
            "msg": f"Este cadastro está em uso por {em_uso} registro(s). Inative-o para tirá-lo das novas seleções."})

    async def tx(s):
        await db.fin_cadastros.delete_one({"_id": doc["_id"]}, session=s)
        await log_event(current, f"{kind}_excluido", module="bancos" if kind in ("conta", "cartao") else "config",
                        entity_type=kind, entity_id=item_id, entity_label=doc.get("nome", ""), session=s)
    await in_transaction(tx)
    return {"ok": True}


class SaldoInput(BaseModel):
    saldo: Any
    saldo_data: Optional[str] = None


@fin_router.post("/contas/{conta_id}/saldo")
async def ajustar_saldo(conta_id: str, body: SaldoInput, current=Depends(get_current_user)):
    """Ajuste manual: o saldo informado passa a ser a base; só baixas registradas
    depois deste momento alteram o saldo da conta."""
    owner = _owner(current)
    conta = await db.fin_cadastros.find_one({"owner_id": owner, "kind": "conta", "id": conta_id})
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    anterior = (await _account_balances(owner, [conta_id])).get(conta_id, 0)
    novo = signed_cents(body.saldo)
    data_ref = parse_date(body.saldo_data, "data do saldo") if body.saldo_data else today_sp()
    ts = now_iso()

    async def tx(s):
        await db.fin_cadastros.update_one({"_id": conta["_id"]}, {"$set": {
            "saldo_inicial_cents": novo, "saldo_data": data_ref, "saldo_at": ts, "updated_at": ts}}, session=s)
        await log_event(current, "saldo_ajustado", module="bancos", entity_type="conta", entity_id=conta_id,
                        entity_label=conta.get("nome", ""), amount_cents=novo, financial_date=data_ref,
                        changes=[{"field": "saldo_cents", "label": "Saldo", "before": anterior, "after": novo}], session=s)
    await in_transaction(tx)
    return {"ok": True, "saldo_atual_cents": novo}


# =================== LANÇAMENTOS ===================
ENTRY_REF_FIELDS = {
    "category_id": ("categoria", "Categoria"),
    "payment_method_id": ("forma", "Forma de pagamento"),
    "bank_account_id": ("conta", "Banco/conta"),
    "card_id": ("cartao", "Cartão"),
}
ENTRY_LABELS = {
    "description": "Descrição", "client_supplier": "Cliente/Fornecedor", "amount_cents": "Valor",
    "due_date": "Vencimento", "notes": "Observação", "bid_label": "Licitação",
    "category_name": "Categoria", "payment_method_name": "Forma de pagamento",
    "account_name": "Banco/conta", "card_name": "Cartão", "tag_names": "Tags",
}
# Mudança em um único campo ganha uma ação específica no histórico.
SINGLE_FIELD_ACTION = {
    "client_supplier": "contato_alterado", "amount_cents": "valor_alterado", "due_date": "vencimento_alterado", "category_name": "categoria_alterada",
    "payment_method_name": "forma_alterada", "account_name": "banco_alterado", "card_name": "cartao_alterado",
}
NAME_FIELD = {"category_id": "category_name", "payment_method_id": "payment_method_name",
              "bank_account_id": "account_name", "card_id": "card_name"}

# Formas que NÃO pedem banco/conta no lançamento (o resto — Pix, Boleto,
# Transferência e formas novas do usuário — pede). Cartão de crédito não é forma:
# o lançamento aponta direto para o cartão cadastrado (`card_id`).
FORMAS_SEM_CONTA = {"dinheiro", "especie", "outro", "outros", "cartao", "cartao de credito", "credito"}
RECENT_DESCRIPTIONS = 15


def _norm(txt: str) -> str:
    t = unicodedata.normalize("NFKD", txt or "")
    return " ".join("".join(c for c in t if not unicodedata.combining(c)).lower().split())


def forma_exige_conta(forma: Optional[dict]) -> bool:
    return bool(forma) and _norm(forma.get("nome", "")) not in FORMAS_SEM_CONTA


async def _payment_fields(owner: str, tipo: str, pm_id: Optional[str], bank_id: Optional[str],
                          card_id: Optional[str]) -> dict:
    """Forma de pagamento coerente — nunca guarda vínculo escondido incompatível:
    cartão => sem forma e sem banco; forma sem conta (Dinheiro/Outro) ou nenhuma
    forma => sem banco; Pix/Boleto/Transferência => banco obrigatório."""
    pm_id, bank_id, card_id = pm_id or None, bank_id or None, card_id or None
    if card_id:
        if tipo != PAGAR:
            raise HTTPException(status_code=400, detail="Cartão de crédito só pode ser usado em A Pagar.")
        return {"payment_method": "credit_card", "payment_method_id": None, "bank_account_id": None, "card_id": card_id}
    if not pm_id:
        return {"payment_method": None, "payment_method_id": None, "bank_account_id": None, "card_id": None}
    forma = await db.fin_cadastros.find_one({"owner_id": owner, "kind": "forma", "id": pm_id})
    if not forma:
        raise HTTPException(status_code=400, detail="Forma de pagamento não encontrada.")
    if forma_exige_conta(forma):
        if not bank_id:
            raise HTTPException(status_code=400, detail=f"Selecione o banco/conta ({forma['nome']}).")
    else:
        bank_id = None
    return {"payment_method": "forma", "payment_method_id": pm_id, "bank_account_id": bank_id, "card_id": None}


async def _remember_description(owner: str, desc: str, session=None) -> None:
    """Memória das últimas descrições do usuário (sem duplicata; a repetida sobe
    para o topo). Só sugestão: o campo continua texto livre."""
    desc = (desc or "").strip()
    if not desc:
        return
    cfg = await db.fin_settings.find_one({"owner_id": owner}, {"recent_descriptions": 1}, session=session) or {}
    key = _norm(desc)
    items = [desc] + [d for d in (cfg.get("recent_descriptions") or []) if _norm(d) != key]
    await db.fin_settings.update_one({"owner_id": owner}, {"$set": {"recent_descriptions": items[:RECENT_DESCRIPTIONS]}},
                                     upsert=True, session=session)


@fin_router.get("/descricoes-recentes")
async def recent_descriptions(current=Depends(get_current_user)):
    cfg = await db.fin_settings.find_one({"owner_id": _owner(current)}, {"recent_descriptions": 1}) or {}
    return {"items": (cfg.get("recent_descriptions") or [])[:RECENT_DESCRIPTIONS]}


def _module(tipo: str) -> str:
    return "pagar" if tipo == PAGAR else "receber"


def _entry_labels(tipo: str) -> dict:
    # No histórico o vínculo aparece como "Fornecedor" (A Pagar) ou "Cliente" (A Receber).
    return {**ENTRY_LABELS, "client_supplier": "Fornecedor" if tipo == PAGAR else "Cliente"}


def _free_text_contact_error(tipo: str) -> HTTPException:
    papel = "fornecedor" if tipo == PAGAR else "cliente"
    return HTTPException(status_code=400, detail=f"Selecione um {papel} cadastrado (texto livre não é aceito).")


def _entry_label(e: dict) -> str:
    seq = f" ({e['sequence_index']}/{e['sequence_total']})" if e.get("sequence_id") else ""
    return f"{e.get('description', '')}{seq}"


async def _resolve_refs(owner: str, tipo: str, data: dict, current_entry: Optional[dict] = None) -> dict:
    """Valida os IDs (pertencem ao usuário, tipo certo) e grava o nome atual como
    snapshot de apresentação — o vínculo real continua sendo o ID."""
    out = {}
    for field, (kind, label) in ENTRY_REF_FIELDS.items():
        if field not in data:
            continue
        val = data[field] or None
        out[field] = val
        out[NAME_FIELD[field]] = None
        if not val:
            continue
        item = await db.fin_cadastros.find_one({"owner_id": owner, "kind": kind, "id": val})
        if not item:
            raise HTTPException(status_code=400, detail=f"{label} não encontrado(a).")
        unchanged = current_entry is not None and current_entry.get(field) == val
        if not item.get("ativo", True) and not unchanged:
            raise HTTPException(status_code=400, detail=f"{label} \"{item['nome']}\" está inativo(a).")
        if kind == "categoria":
            esperado = "receita" if tipo == RECEBER else "despesa"
            if item.get("tipo") != esperado:
                raise HTTPException(status_code=400, detail=f"A categoria \"{item['nome']}\" é de {item.get('tipo')}.")
        out[NAME_FIELD[field]] = item["nome"]
    return out


async def _resolve_tags(owner: str, tag_ids: Optional[list], current_ids: Optional[list] = None) -> dict:
    """Tags do lançamento: IDs do cadastro central (nome é só snapshot). Tag
    inativa não pode ser adicionada, mas a que já estava no lançamento fica."""
    ids = list(dict.fromkeys([t for t in (tag_ids or []) if t]))
    if not ids:
        return {"tag_ids": [], "tag_names": []}
    found = {t["id"]: t async for t in db.fin_cadastros.find({"owner_id": owner, "kind": "tag", "id": {"$in": ids}})}
    for t in ids:
        if t not in found:
            raise HTTPException(status_code=400, detail="Tag não encontrada.")
        if not found[t].get("ativo", True) and t not in (current_ids or []):
            raise HTTPException(status_code=400, detail=f"A tag \"{found[t]['nome']}\" está inativa.")
    return {"tag_ids": ids, "tag_names": [found[t]["nome"] for t in ids]}


async def _bid_label(owner: str, bid_id: Optional[str]) -> Optional[str]:
    if not bid_id:
        return None
    from bson import ObjectId
    try:
        bid = await db.bids.find_one({"_id": ObjectId(bid_id), "owner_id": owner})
    except Exception:
        bid = None
    if not bid:
        raise HTTPException(status_code=400, detail="Licitação não encontrada.")
    partes = [p for p in (f"Pregão {bid['pregao']}" if bid.get("pregao") else "", bid.get("orgao") or "",
                          (bid.get("objeto") or "")[:60]) if p]
    return " · ".join(partes) or "Licitação"


class EntryInput(BaseModel):
    type: str
    description: str
    client_supplier: Optional[str] = None   # legado: novos lançamentos usam contact_id
    contact_id: Optional[str] = None
    category_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    bank_account_id: Optional[str] = None
    card_id: Optional[str] = None
    notes: Optional[str] = None
    bid_id: Optional[str] = None
    mode: str = "avista"
    amount: Any                     # à vista: valor; parcelado: TOTAL; recorrente: valor POR ocorrência
    installments: Optional[int] = None
    frequency: Optional[str] = None
    due_date: str                   # vencimento (1ª data na série)
    client_token: Optional[str] = None   # idempotência contra clique duplo
    duplicated_from: Optional[str] = None
    tag_ids: Optional[list] = None


def _entry_out(e: dict, today: str) -> dict:
    out = _clean(e)
    out["settled_cents"] = int(e.get("settled_cents") or 0)
    out["open_cents"] = open_cents(e) if e.get("status") != CANCELADO else 0
    out["status_efetivo"] = effective_status(e, today)
    out.setdefault("tag_ids", [])
    return out


@fin_router.post("/lancamentos")
async def create_entries(body: EntryInput, current=Depends(get_current_user)):
    owner = _owner(current)
    if body.type not in TYPES:
        raise HTTPException(status_code=400, detail="Tipo deve ser A Pagar ou A Receber.")
    if body.mode not in MODES:
        raise HTTPException(status_code=400, detail="Modo de lançamento inválido.")
    desc = (body.description or "").strip()
    if not desc:
        raise HTTPException(status_code=400, detail="Informe a descrição.")
    first = parse_date(body.due_date, "data de vencimento")
    amount = to_cents(body.amount)

    if body.client_token:
        existing = await db.fin_entries.find({"owner_id": owner, "create_token": body.client_token}).to_list(MAX_OCCURRENCES)
        if existing:
            today = today_sp()
            return {"created": len(existing), "items": [_entry_out(e, today) for e in existing], "idempotent": True}

    if body.mode == "avista":
        values, dates = [amount], [first]
    else:
        n = int(body.installments or 0)
        if n < 1:
            raise HTTPException(status_code=400, detail="A quantidade deve ser maior ou igual a 1.")
        if n > MAX_OCCURRENCES:
            raise HTTPException(status_code=400, detail=f"Máximo de {MAX_OCCURRENCES} ocorrências.")
        if body.mode == "parcelado":
            # Parcelado: o valor informado é o TOTAL, dividido sem perder centavos.
            values = split_installments(amount, n)
            dates = occurrence_dates(first, n, "mensal")
        else:
            # Recorrente: o valor informado é POR OCORRÊNCIA — nunca é dividido.
            values = [amount] * n
            dates = occurrence_dates(first, n, body.frequency or "mensal")

    if not body.category_id:
        raise HTTPException(status_code=400, detail="Selecione uma categoria.")
    pay = await _payment_fields(owner, body.type, body.payment_method_id, body.bank_account_id, body.card_id)
    refs = await _resolve_refs(owner, body.type, {"category_id": body.category_id,
                                                  **{k: pay[k] for k in ("payment_method_id", "bank_account_id", "card_id")}})
    refs["payment_method"] = pay["payment_method"]
    if (body.client_supplier or "").strip() and not body.contact_id:
        raise _free_text_contact_error(body.type)
    contact = await resolve_contact(owner, body.type, body.contact_id)
    bid_label = await _bid_label(owner, body.bid_id)
    tags = await _resolve_tags(owner, body.tag_ids)
    if not tags["tag_ids"]:
        raise HTTPException(status_code=400, detail="Selecione pelo menos uma tag.")
    duplicated = None
    if body.duplicated_from:
        duplicated = await db.fin_entries.find_one({"owner_id": owner, "id": body.duplicated_from})
    ts = now_iso()
    seq_id = new_id() if body.mode != "avista" else None
    freq = (body.frequency or "mensal") if body.mode == "recorrente" else ("mensal" if body.mode == "parcelado" else None)
    docs = []
    for i, (v, d) in enumerate(zip(values, dates)):
        docs.append({
            "id": new_id(), "owner_id": owner, "type": body.type, "description": desc,
            **contact, **refs, **tags,
            "notes": (body.notes or "").strip() or None,
            "bid_id": body.bid_id or None, "bid_label": bid_label,
            "amount_cents": v, "settled_cents": 0, "due_date": d, "status": PENDENTE,
            "mode": body.mode, "sequence_id": seq_id,
            "sequence_index": i + 1 if seq_id else None, "sequence_total": len(values) if seq_id else None,
            "frequency": freq, "duplicated_from": duplicated["id"] if duplicated else None,
            "create_token": body.client_token or None,
            "created_by": current["id"], "created_by_name": current.get("name"),
            "created_at": ts, "updated_at": ts, "version": 1,
        })
    module = _module(body.type)

    async def tx(s):
        await db.fin_entries.insert_many(docs, session=s)
        await _remember_description(owner, desc, session=s)
        total = sum(values)
        meta = {"mode": body.mode, "count": len(docs), "ids": [d["id"] for d in docs][:50]}
        if duplicated:
            await log_event(current, "lancamento_duplicado", module=module, entity_type="lancamento",
                            entity_id=docs[0]["id"], entity_label=desc, amount_cents=total, financial_date=first,
                            metadata={**meta, "origem_id": duplicated["id"], "origem_label": _entry_label(duplicated)},
                            session=s)
        elif seq_id:
            await log_event(current, "sequencia_criada", module=module, entity_type="sequencia", entity_id=seq_id,
                            entity_label=desc, amount_cents=total, financial_date=first,
                            metadata={**meta, "frequency": freq, "valor_ocorrencia": values[0]}, session=s)
        else:
            await log_event(current, "lancamento_criado", module=module, entity_type="lancamento",
                            entity_id=docs[0]["id"], entity_label=desc, amount_cents=total, financial_date=first,
                            metadata=meta, session=s)
    try:
        await in_transaction(tx)
    except DuplicateKeyError:
        existing = await db.fin_entries.find({"owner_id": owner, "create_token": body.client_token}).to_list(MAX_OCCURRENCES)
        today = today_sp()
        return {"created": len(existing), "items": [_entry_out(e, today) for e in existing], "idempotent": True}
    today = today_sp()
    return {"created": len(docs), "items": [_entry_out(d, today) for d in docs]}


SORTS = {"due_date": "due_date", "amount": "amount_cents", "status": "status", "description": "description",
         "created_at": "created_at", "settled_date": "settled_date"}


def _entries_query(owner: str, *, type: Optional[str], status: Optional[str], category_id: Optional[str],
                   payment_method_id: Optional[str], account_id: Optional[str], q: Optional[str],
                   date_from: Optional[str], date_to: Optional[str], mode: Optional[str],
                   date_field: str, today: str, card_ids: Optional[list] = None, tag_ids: Optional[str] = None) -> dict:
    query: dict = {"owner_id": owner}
    if type in TYPES:
        query["type"] = type
    if status == ATRASADO:
        query.update({"status": {"$in": list(OPEN)}, "due_date": {"$lt": today}})
    elif status == "aberto":
        query["status"] = {"$in": list(OPEN)}
    elif status == "a_vencer":
        query.update({"status": {"$in": list(OPEN)}, "due_date": {"$gte": today}})
    elif status == "realizado":
        query["status"] = {"$in": list(SETTLED)}
    elif status in (PENDENTE, PARCIAL, "pago", RECEBIDO, CANCELADO):
        query["status"] = status
    else:
        query["status"] = {"$ne": CANCELADO}
    if category_id:
        query["category_id"] = category_id
    if payment_method_id:
        query["payment_method_id"] = payment_method_id
    if account_id:
        conds = [{"bank_account_id": account_id}, {"card_id": account_id}]
        if card_ids:
            conds.append({"card_id": {"$in": card_ids}})
        query["$or"] = conds
    if mode in MODES:
        query["mode"] = mode
    if tag_ids:
        query["tag_ids"] = {"$in": [t for t in tag_ids.split(",") if t]}
    rng = {}
    if date_from:
        rng["$gte"] = parse_date(date_from)
    if date_to:
        rng["$lte"] = parse_date(date_to)
    if rng:
        if date_field in query and isinstance(query[date_field], dict):
            query[date_field].update(rng)
        else:
            query[date_field] = rng
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query.setdefault("$and", []).append({"$or": [
            {"description": rx}, {"client_supplier": rx}, {"notes": rx}, {"bid_label": rx},
            {"category_name": rx}, {"tag_names": rx}, {"id": {"$regex": f"^{re.escape(q.strip().lower())}"}}]})
    return query


@fin_router.get("/lancamentos")
async def list_entries(
    type: Optional[str] = None, status: Optional[str] = None, category_id: Optional[str] = None,
    payment_method_id: Optional[str] = None, account_id: Optional[str] = None, q: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None, mode: Optional[str] = None,
    date_field: str = "due_date", sequence_id: Optional[str] = None, tag_ids: Optional[str] = None,
    page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=200),
    sort: str = "due_date", dir: str = "asc", current=Depends(get_current_user),
):
    owner = _owner(current)
    today = today_sp()
    card_ids = None
    if account_id:
        card_ids = [c["id"] async for c in db.fin_cadastros.find({"owner_id": owner, "kind": "cartao", "conta_id": account_id})]
    query = _entries_query(owner, type=type, status=status, category_id=category_id,
                           payment_method_id=payment_method_id, account_id=account_id, q=q,
                           date_from=date_from, date_to=date_to, mode=mode,
                           date_field="settled_date" if date_field == "settled_date" else "due_date",
                           today=today, card_ids=card_ids, tag_ids=tag_ids)
    if sequence_id:
        query["sequence_id"] = sequence_id
    key = SORTS.get(sort, "due_date")
    direction = -1 if dir == "desc" else 1
    total = await db.fin_entries.count_documents(query)
    cursor = db.fin_entries.find(query).sort([(key, direction), ("due_date", 1), ("sequence_index", 1), ("created_at", 1)])
    items = await cursor.skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    soma = 0
    async for g in db.fin_entries.aggregate([{"$match": query}, {"$group": {"_id": "$type", "t": {"$sum": OPEN_EXPR}}}]):
        soma += g["t"] if g["_id"] == RECEBER else -g["t"]
    return {"items": [_entry_out(e, today) for e in items], "total": total, "page": page, "page_size": page_size,
            "net_cents": soma, "today": today}


@fin_router.get("/lancamentos/{entry_id}")
async def get_entry(entry_id: str, current=Depends(get_current_user)):
    owner = _owner(current)
    e = await db.fin_entries.find_one({"owner_id": owner, "id": entry_id})
    if not e:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    out = _entry_out(e, today_sp())
    if e.get("sequence_id"):
        seq = await db.fin_entries.find({"owner_id": owner, "sequence_id": e["sequence_id"]},
                                        {"settled_cents": 1, "sequence_index": 1}).to_list(MAX_OCCURRENCES)
        out["sequence_settled_after"] = sum(1 for x in seq if x.get("settled_cents") and x["sequence_index"] >= e["sequence_index"])
        out["sequence_settled_all"] = sum(1 for x in seq if x.get("settled_cents"))
    return out


async def _require_entry(owner: str, entry_id: str) -> dict:
    e = await db.fin_entries.find_one({"owner_id": owner, "id": entry_id})
    if not e:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return e


async def _scope_entries(owner: str, e: dict, scope: str) -> list:
    if scope not in ("one", "next", "all"):
        raise HTTPException(status_code=400, detail="Escopo inválido.")
    if scope == "one" or not e.get("sequence_id"):
        return [e]
    q = {"owner_id": owner, "sequence_id": e["sequence_id"]}
    if scope == "next":
        q["sequence_index"] = {"$gte": e["sequence_index"]}
    return await db.fin_entries.find(q).sort("sequence_index", 1).to_list(MAX_OCCURRENCES)


class EntryUpdate(BaseModel):
    description: Optional[str] = None
    client_supplier: Optional[str] = None   # só aceito vazio (remove texto legado)
    contact_id: Optional[str] = None
    category_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    bank_account_id: Optional[str] = None
    card_id: Optional[str] = None
    notes: Optional[str] = None
    bid_id: Optional[str] = None
    amount: Optional[Any] = None
    due_date: Optional[str] = None
    tag_ids: Optional[list] = None
    scope: str = "one"                  # one | next | all
    include_settled: bool = False       # incluir pagos/recebidos na alteração (confirmado pelo usuário)
    version: Optional[int] = None       # concorrência otimista do lançamento editado


@fin_router.put("/lancamentos/{entry_id}")
async def update_entry(entry_id: str, body: EntryUpdate, current=Depends(get_current_user)):
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    if body.version is not None and body.version != e.get("version", 1):
        raise HTTPException(status_code=409, detail="Este lançamento foi alterado por outra pessoa. Recarregue e tente de novo.")
    if e["status"] == CANCELADO:
        raise HTTPException(status_code=400, detail="Lançamento cancelado não pode ser editado. Reative-o primeiro.")
    sent = body.model_fields_set
    patch: dict = {}
    if "description" in sent:
        if not (body.description or "").strip():
            raise HTTPException(status_code=400, detail="Informe a descrição.")
        patch["description"] = body.description.strip()
    if "notes" in sent:
        patch["notes"] = (body.notes or "").strip() or None
    if "contact_id" in sent:
        patch.update(await resolve_contact(owner, e["type"], body.contact_id, e.get("contact_id")))
    elif "client_supplier" in sent:
        if (body.client_supplier or "").strip():
            raise _free_text_contact_error(e["type"])
        patch.update({"contact_id": None, "client_supplier": None})
    ref_data = {f: getattr(body, f) for f in ENTRY_REF_FIELDS if f in sent}
    if {"payment_method_id", "bank_account_id", "card_id"} & sent:
        # Forma/banco/cartão mexidos: o conjunto FINAL tem que ser coerente (sem banco escondido).
        merged = {f: (getattr(body, f) if f in sent else e.get(f)) for f in ("payment_method_id", "bank_account_id", "card_id")}
        pay = await _payment_fields(owner, e["type"], merged["payment_method_id"], merged["bank_account_id"], merged["card_id"])
        ref_data.update({k: pay[k] for k in ("payment_method_id", "bank_account_id", "card_id")})
        patch["payment_method"] = pay["payment_method"]
    patch.update(await _resolve_refs(owner, e["type"], ref_data, e))
    if "bid_id" in sent and (body.bid_id or None) != e.get("bid_id"):
        patch["bid_id"] = body.bid_id or None
        patch["bid_label"] = await _bid_label(owner, body.bid_id) if body.bid_id else None
    if "amount" in sent:
        patch["amount_cents"] = to_cents(body.amount)
    if "tag_ids" in sent:
        patch.update(await _resolve_tags(owner, body.tag_ids, e.get("tag_ids")))
    # Categoria e tag obrigatórias também na edição: registro antigo sem elas
    # precisa recebê-las antes de salvar qualquer alteração (sem migração).
    if not patch.get("category_id", e.get("category_id")):
        raise HTTPException(status_code=400, detail="Selecione uma categoria.")
    if not patch.get("tag_ids", e.get("tag_ids")):
        raise HTTPException(status_code=400, detail="Selecione pelo menos uma tag.")
    delta_days = 0
    if "due_date" in sent:
        new_due = parse_date(body.due_date, "data de vencimento")
        delta_days = days_between(e["due_date"], new_due)

    alvo = await _scope_entries(owner, e, body.scope)
    alvo = [x for x in alvo if x["status"] != CANCELADO]
    # "Realizado" = já tem baixa (total OU parcial). Nunca muda sem confirmação.
    realizados = [x for x in alvo if x.get("settled_cents")]
    if realizados and not body.include_settled:
        if e.get("settled_cents"):
            raise HTTPException(status_code=409, detail={
                "code": "settled", "count": len(realizados),
                "msg": "Este lançamento já tem baixa registrada. Confirme para alterar um registro realizado."})
        alvo = [x for x in alvo if not x.get("settled_cents")]
    if "amount_cents" in patch and any(patch["amount_cents"] < int(x.get("settled_cents") or 0) for x in alvo):
        raise HTTPException(status_code=400, detail="O valor não pode ser menor que o total já pago/recebido.")
    before_view = {**e}
    after_view = {**e, **patch}
    if delta_days:
        after_view["due_date"] = shift_days(e["due_date"], delta_days)
    changes = diff(before_view, after_view, _entry_labels(e["type"]))
    if not changes:
        return {"updated": 0, "skipped_settled": 0}
    ts = now_iso()
    ids = [x["id"] for x in alvo]
    module = _module(e["type"])
    seq = e.get("sequence_id") and body.scope != "one"
    action = "sequencia_editada" if seq else (
        SINGLE_FIELD_ACTION.get(changes[0]["field"], "lancamento_editado") if len(changes) == 1 else "lancamento_editado")

    async def tx(s):
        for x in alvo:
            upd = dict(patch)
            if "amount_cents" in upd and x.get("settled_cents"):
                # Valor ajustado num lançamento com baixas: o status acompanha o novo saldo.
                upd["status"] = settled_status(x["type"]) if upd["amount_cents"] == x["settled_cents"] else PARCIAL
            if delta_days:
                upd["due_date"] = shift_days(x["due_date"], delta_days)
            await db.fin_entries.update_one({"_id": x["_id"]}, {"$set": {**upd, "updated_at": ts, "updated_by": current["id"]},
                                                                "$inc": {"version": 1}}, session=s)
        if "description" in patch and patch["description"] != e.get("description"):
            await _remember_description(owner, patch["description"], session=s)
        contato = {}
        if "contact_id" in patch and patch["contact_id"] != e.get("contact_id"):
            # Troca de cliente/fornecedor: IDs + nomes (antes -> depois) para auditoria.
            contato = {"contato_antes": {"id": e.get("contact_id"), "nome": e.get("client_supplier")},
                       "contato_depois": {"id": patch["contact_id"], "nome": patch["client_supplier"]}}
        await log_event(current, action, module=module, entity_type="sequencia" if seq else "lancamento",
                        entity_id=e["sequence_id"] if seq else e["id"], entity_label=_entry_label(e),
                        changes=changes, amount_cents=after_view.get("amount_cents"),
                        metadata={**contato, "scope": body.scope, "count": len(ids), "ids": ids[:50],
                                  "preservados": len(realizados) if not body.include_settled else 0,
                                  "inclui_realizados": bool(body.include_settled and realizados)}, session=s)
    await in_transaction(tx)
    return {"updated": len(ids), "skipped_settled": len(realizados) if not body.include_settled else 0}


class SettleInput(BaseModel):
    date: str
    amount: Optional[Any] = None        # vazio = quita o saldo em aberto inteiro
    bank_account_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    notes: Optional[str] = None


def _settle_action(tipo: str, parcial: bool) -> str:
    if tipo == PAGAR:
        return "pagamento_parcial" if parcial else "pagamento_baixado"
    return "recebimento_parcial" if parcial else "recebimento_baixado"


@fin_router.post("/lancamentos/{entry_id}/baixar")
async def settle_entry(entry_id: str, body: SettleInput, current=Depends(get_current_user)):
    """Registra UMA baixa (pagamento ou recebimento), total ou parcial.
    A baixa vira um registro em `fin_settlements`; o lançamento original continua
    o mesmo (valor original preservado) e só acumula `settled_cents`. Enquanto
    restar saldo, o status é "parcial" e o saldo segue nas previsões e no fluxo."""
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    if e["status"] not in OPEN:
        raise HTTPException(status_code=409, detail="Este lançamento já foi quitado ou está cancelado.")
    aberto = open_cents(e)
    valor = to_cents(body.amount, "valor da baixa") if body.amount not in (None, "") else aberto
    if valor > aberto:
        raise HTTPException(status_code=400, detail=f"O valor ({brl(valor)}) é maior que o saldo em aberto ({brl(aberto)}).")
    data_fin = parse_date(body.date, "data do pagamento" if e["type"] == PAGAR else "data do recebimento")
    # A baixa é a movimentação REAL do dinheiro: a conta é obrigatória para
    # QUALQUER forma original (inclusive cartão e dinheiro). A forma NÃO é
    # escolhida de novo — é a do lançamento (`body.payment_method_id` é ignorado).
    if not body.bank_account_id:
        raise HTTPException(status_code=400, detail="Selecione a conta utilizada no pagamento." if e["type"] == PAGAR
                            else "Selecione a conta em que o recebimento entrou.")
    refs = await _resolve_refs(owner, e["type"], {"bank_account_id": body.bank_account_id})
    forma_original = e.get("card_name") if e.get("card_id") else e.get("payment_method_name")
    if e.get("card_id") and forma_original:
        cartao = await db.fin_cadastros.find_one({"owner_id": owner, "kind": "cartao", "id": e["card_id"]}, {"final": 1})
        if cartao and cartao.get("final"):
            forma_original = f"{forma_original} •••• {cartao['final']}"
    restante = aberto - valor
    quitado = restante == 0
    novo_status = settled_status(e["type"]) if quitado else PARCIAL
    ts = now_iso()
    settlement = {
        "id": new_id(), "owner_id": owner, "entry_id": e["id"], "type": e["type"], "amount_cents": valor,
        "financial_date": data_fin, "bank_account_id": refs.get("bank_account_id"), "account_name": refs.get("account_name"),
        # Forma ORIGINAL do lançamento (snapshot informativo; a baixa não a altera).
        "payment_method_id": e.get("payment_method_id"), "payment_method_name": forma_original,
        "card_id": e.get("card_id"),
        "notes": (body.notes or "").strip() or None, "description": e.get("description"),
        "created_by": current["id"], "created_by_name": current.get("name"), "created_at": ts, "reversed": False,
    }
    upd = {"status": novo_status, "updated_at": ts, "last_settled_date": data_fin}
    if quitado:
        upd.update({"settled_date": data_fin, "settled_at": ts})
    pago_antes = int(e.get("settled_cents") or 0)

    async def tx(s):
        # Concorrência: só grava se ninguém baixou/estornou no meio do caminho
        # (a versão muda a cada baixa) — duas baixas simultâneas nunca somam errado.
        res = await db.fin_entries.update_one(
            {"_id": e["_id"], "status": {"$in": list(OPEN)}, "version": e.get("version", 1)},
            {"$set": upd, "$inc": {"settled_cents": valor, "version": 1}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="O saldo deste lançamento mudou. Recarregue e tente de novo.")
        await db.fin_settlements.insert_one(settlement, session=s)
        await log_event(current, _settle_action(e["type"], not quitado), module=_module(e["type"]),
                        entity_type="lancamento", entity_id=e["id"], entity_label=_entry_label(e), amount_cents=valor,
                        financial_date=data_fin,
                        changes=[{"field": "open_cents", "label": "Saldo em aberto", "before": aberto, "after": restante}],
                        metadata={"conta": refs.get("account_name"), "bank_account_id": refs.get("bank_account_id"),
                                  "forma": forma_original,
                                  "observacao": settlement["notes"], "settlement_id": settlement["id"],
                                  "valor_original": e["amount_cents"]}, session=s)
    await in_transaction(tx)
    out = _entry_out({**e, **upd, "settled_cents": pago_antes + valor, "version": e.get("version", 1) + 1}, today_sp())
    out["quitado"] = quitado
    out["baixa_cents"] = valor
    return out


@fin_router.get("/lancamentos/{entry_id}/baixas")
async def list_settlements(entry_id: str, current=Depends(get_current_user)):
    owner = _owner(current)
    await _require_entry(owner, entry_id)
    items = await db.fin_settlements.find({"owner_id": owner, "entry_id": entry_id}).sort("created_at", 1).to_list(500)
    return [_clean(i) for i in items]


class ReasonInput(BaseModel):
    reason: Optional[str] = None
    scope: str = "one"


@fin_router.post("/lancamentos/{entry_id}/baixas/{settlement_id}/estornar")
async def reverse_settlement(entry_id: str, settlement_id: str, body: ReasonInput, current=Depends(get_current_user)):
    """Estorna UMA baixa. A baixa não é apagada (fica marcada como estornada) e o
    histórico ganha um NOVO evento; saldo em aberto e status são recalculados."""
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    st = await db.fin_settlements.find_one({"owner_id": owner, "id": settlement_id, "entry_id": entry_id})
    if not st:
        raise HTTPException(status_code=404, detail="Baixa não encontrada")
    if st.get("reversed"):
        raise HTTPException(status_code=409, detail="Esta baixa já foi estornada.")
    if e["status"] == CANCELADO:
        raise HTTPException(status_code=409, detail="Lançamento cancelado. Reative-o antes.")
    era_quitado = e["status"] in SETTLED
    pago_antes = int(e.get("settled_cents") or 0)
    pago_depois = pago_antes - st["amount_cents"]
    novo_status = PARCIAL if pago_depois > 0 else PENDENTE
    if era_quitado:
        action = "pagamento_estornado" if e["type"] == PAGAR else "recebimento_reaberto"
    else:
        action = "pagamento_parcial_estornado" if e["type"] == PAGAR else "recebimento_parcial_estornado"
    ts = now_iso()

    async def tx(s):
        res = await db.fin_settlements.update_one({"_id": st["_id"], "reversed": False}, {"$set": {
            "reversed": True, "reversed_at": ts, "reversed_by": current["id"], "reversed_by_name": current.get("name"),
            "reversal_reason": (body.reason or "").strip() or None}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="Esta baixa já foi estornada.")
        await db.fin_entries.update_one({"_id": e["_id"]}, {
            "$set": {"status": novo_status, "updated_at": ts}, "$inc": {"settled_cents": -st["amount_cents"], "version": 1},
            "$unset": {"settled_date": "", "settled_at": ""}}, session=s)
        await log_event(current, action, module=_module(e["type"]), entity_type="lancamento", entity_id=e["id"],
                        entity_label=_entry_label(e), amount_cents=st["amount_cents"], financial_date=st["financial_date"],
                        changes=[{"field": "open_cents", "label": "Saldo em aberto",
                                  "before": e["amount_cents"] - pago_antes, "after": e["amount_cents"] - pago_depois}],
                        metadata={"motivo": (body.reason or "").strip() or None, "settlement_id": st["id"]}, session=s)
    await in_transaction(tx)
    return {"ok": True, "status": novo_status}


@fin_router.post("/lancamentos/{entry_id}/reabrir")
async def reopen_entry(entry_id: str, body: ReasonInput, current=Depends(get_current_user)):
    """Reativa um lançamento cancelado. (Baixas são desfeitas uma a uma pelo
    estorno da baixa, que preserva o registro original.)"""
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    if e["status"] != CANCELADO:
        raise HTTPException(status_code=409, detail="Só lançamentos cancelados podem ser reativados. Para desfazer uma baixa, estorne-a.")
    if e.get("request_id"):
        from fin_recebiveis import reactivate_request
        await reactivate_request(owner, e)
    ts = now_iso()

    async def tx(s):
        res = await db.fin_entries.update_one({"_id": e["_id"], "status": CANCELADO}, {
            "$set": {"status": PENDENTE, "updated_at": ts}, "$unset": {"cancel_reason": ""},
            "$inc": {"version": 1}}, session=s)
        if not res.modified_count:
            raise HTTPException(status_code=409, detail="O lançamento mudou. Recarregue e tente de novo.")
        await log_event(current, "lancamento_reativado", module=_module(e["type"]), entity_type="lancamento", entity_id=e["id"],
                        entity_label=_entry_label(e), amount_cents=e["amount_cents"],
                        changes=[{"field": "status", "label": "Status", "before": CANCELADO, "after": PENDENTE}],
                        metadata={"motivo": (body.reason or "").strip() or None}, session=s)
    await in_transaction(tx)
    return {"ok": True}


@fin_router.get("/movimentos")
async def bank_movements(account_id: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                         page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100),
                         current=Depends(get_current_user)):
    """Extrato do sistema: cada baixa (total ou parcial) é uma movimentação."""
    owner = _owner(current)
    q: dict = {"owner_id": owner, "reversed": {"$ne": True}}
    if account_id:
        q["bank_account_id"] = account_id
    rng = {}
    if date_from:
        rng["$gte"] = parse_date(date_from)
    if date_to:
        rng["$lte"] = parse_date(date_to)
    if rng:
        q["financial_date"] = rng
    total = await db.fin_settlements.count_documents(q)
    items = await db.fin_settlements.find(q).sort([("financial_date", -1), ("created_at", -1)]) \
        .skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    net = 0
    async for g in db.fin_settlements.aggregate([{"$match": q}, {"$group": {"_id": "$type", "t": {"$sum": "$amount_cents"}}}]):
        net += g["t"] if g["_id"] == RECEBER else -g["t"]
    return {"items": [_clean(i) for i in items], "total": total, "net_cents": net}


@fin_router.post("/lancamentos/{entry_id}/cancelar")
async def cancel_entry(entry_id: str, body: ReasonInput, current=Depends(get_current_user)):
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    todos = await _scope_entries(owner, e, body.scope)
    alvo = [x for x in todos if x["status"] == PENDENTE and not x.get("settled_cents")]
    preservados = sum(1 for x in todos if x.get("settled_cents"))
    if not alvo:
        raise HTTPException(status_code=409, detail="Não há lançamentos sem baixa para cancelar. Com pagamento/recebimento (total ou parcial) eles são preservados — estorne as baixas antes.")
    ts = now_iso()
    motivo = (body.reason or "").strip() or None

    async def tx(s):
        for x in alvo:
            await db.fin_entries.update_one({"_id": x["_id"], "status": PENDENTE}, {
                "$set": {"status": CANCELADO, "cancel_reason": motivo, "cancelled_at": ts, "updated_at": ts},
                "$inc": {"version": 1}}, session=s)
        await log_event(current, "lancamento_cancelado", module=_module(e["type"]),
                        entity_type="sequencia" if len(alvo) > 1 else "lancamento",
                        entity_id=e["sequence_id"] if len(alvo) > 1 else e["id"], entity_label=_entry_label(e),
                        amount_cents=sum(x["amount_cents"] for x in alvo),
                        metadata={"scope": body.scope, "count": len(alvo), "preservados": preservados, "motivo": motivo,
                                  "ids": [x["id"] for x in alvo][:50]}, session=s)
    await in_transaction(tx)
    from fin_recebiveis import release_requests
    await release_requests(owner, [x for x in alvo if x.get("request_id")], current)
    return {"cancelled": len(alvo), "preserved": preservados}


@fin_router.delete("/lancamentos/{entry_id}")
async def delete_entry(entry_id: str, scope: str = "one", current=Depends(get_current_user)):
    """Exclui SÓ lançamentos em aberto ou cancelados. Pagos/recebidos nunca são
    apagados: é preciso estornar antes. O histórico guarda o que foi excluído."""
    owner = _owner(current)
    e = await _require_entry(owner, entry_id)
    todos = await _scope_entries(owner, e, scope)
    alvo = [x for x in todos if not x.get("settled_cents") and x["status"] not in SETTLED]
    preservados = len(todos) - len(alvo)
    if not alvo:
        raise HTTPException(status_code=409, detail="Lançamentos com pagamento/recebimento (total ou parcial) não podem ser excluídos. Estorne as baixas antes.")

    async def tx(s):
        await db.fin_entries.delete_many({"owner_id": owner, "id": {"$in": [x["id"] for x in alvo]},
                                          "status": {"$nin": list(SETTLED) + [PARCIAL]}}, session=s)
        await log_event(current, "lancamento_excluido", module=_module(e["type"]),
                        entity_type="sequencia" if len(alvo) > 1 else "lancamento",
                        entity_id=e["sequence_id"] if len(alvo) > 1 else e["id"], entity_label=_entry_label(e),
                        amount_cents=sum(x["amount_cents"] for x in alvo),
                        metadata={"scope": scope, "count": len(alvo), "preservados": preservados,
                                  "excluidos": [{"id": x["id"], "descricao": _entry_label(x), "valor": x["amount_cents"],
                                                 "vencimento": x["due_date"]} for x in alvo][:50]}, session=s)
    await in_transaction(tx)
    from fin_recebiveis import release_requests
    await release_requests(owner, [x for x in alvo if x.get("request_id") and x["status"] != CANCELADO], current)
    return {"deleted": len(alvo), "preserved": preservados}


# =================== VISÃO GERAL / RESUMOS ===================
async def _sum_by_type(match: dict) -> dict:
    out = {PAGAR: {"count": 0, "cents": 0}, RECEBER: {"count": 0, "cents": 0}}
    async for g in db.fin_entries.aggregate([{"$match": match},
                                             {"$group": {"_id": "$type", "n": {"$sum": 1}, "t": {"$sum": OPEN_EXPR}}}]):
        out[g["_id"]] = {"count": g["n"], "cents": g["t"]}
    return out


def _period(date_from: Optional[str], date_to: Optional[str]) -> tuple:
    today = date.fromisoformat(today_sp())
    start = parse_date(date_from) if date_from else today.replace(day=1).isoformat()
    if date_to:
        end = parse_date(date_to)
    else:
        nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = (nxt - timedelta(days=1)).isoformat()
    return start, end


@fin_router.get("/visao-geral")
async def overview(date_from: Optional[str] = None, date_to: Optional[str] = None, current=Depends(get_current_user)):
    owner = _owner(current)
    today = today_sp()
    start, end = _period(date_from, date_to)
    # Saldo EM ABERTO (pendentes + parciais): o que já foi pago/recebido não conta de novo.
    periodo = await _sum_by_type({"owner_id": owner, "status": {"$in": list(OPEN)}, "due_date": {"$gte": start, "$lte": end}})
    vencidas = await _sum_by_type({"owner_id": owner, "status": {"$in": list(OPEN)}, "due_date": {"$lt": today}})
    pend = await db.fin_requests.aggregate([{"$match": {"owner_id": owner, "status": "pendente"}},
                                            {"$group": {"_id": None, "n": {"$sum": 1}, "t": {"$sum": "$amount_cents"}}}]).to_list(1)
    return {
        "periodo": {"inicio": start, "fim": end},
        "a_receber_cents": periodo[RECEBER]["cents"], "a_receber_count": periodo[RECEBER]["count"],
        "a_pagar_cents": periodo[PAGAR]["cents"], "a_pagar_count": periodo[PAGAR]["count"],
        "saldo_previsto_cents": periodo[RECEBER]["cents"] - periodo[PAGAR]["cents"],
        "vencidas": {"receber_cents": vencidas[RECEBER]["cents"], "receber_count": vencidas[RECEBER]["count"],
                     "pagar_cents": vencidas[PAGAR]["cents"], "pagar_count": vencidas[PAGAR]["count"]},
        "solicitacoes_pendentes": {"count": pend[0]["n"] if pend else 0, "cents": pend[0]["t"] if pend else 0},
        "today": today,
    }


@fin_router.get("/resumo")
async def type_summary(type: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                       current=Depends(get_current_user)):
    """Indicadores das páginas A Pagar / A Receber (sempre do tipo pedido)."""
    owner = _owner(current)
    if type not in TYPES:
        raise HTTPException(status_code=400, detail="Tipo inválido")
    today = today_sp()
    start, end = _period(date_from, date_to)
    base = {"owner_id": owner, "type": type}

    async def agg(extra: dict) -> dict:
        # Sempre o saldo em aberto: parcial conta só o que falta.
        r = await db.fin_entries.aggregate([{"$match": {**base, **extra}},
                                            {"$group": {"_id": None, "n": {"$sum": 1}, "t": {"$sum": OPEN_EXPR}}}]).to_list(1)
        return {"count": r[0]["n"] if r else 0, "cents": r[0]["t"] if r else 0}

    # Realizado no período = baixas (totais e parciais) com data financeira no período.
    real = await db.fin_settlements.aggregate([
        {"$match": {"owner_id": owner, "type": type, "reversed": {"$ne": True}, "financial_date": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": None, "n": {"$sum": 1}, "t": {"$sum": "$amount_cents"}}}]).to_list(1)

    semana = (date.fromisoformat(today) + timedelta(days=7)).isoformat()
    por_categoria = []
    async for g in db.fin_entries.aggregate([
        {"$match": {**base, "status": {"$ne": CANCELADO}, "due_date": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": "$category_id", "nome": {"$last": "$category_name"}, "t": {"$sum": "$amount_cents"}, "n": {"$sum": 1}}},
        {"$sort": {"t": -1}}]):
        por_categoria.append({"category_id": g["_id"], "nome": g["nome"] or "Sem categoria", "cents": g["t"], "count": g["n"]})
    return {
        "periodo": {"inicio": start, "fim": end},
        "aberto_periodo": await agg({"status": {"$in": list(OPEN)}, "due_date": {"$gte": start, "$lte": end}}),
        "vencidas": await agg({"status": {"$in": list(OPEN)}, "due_date": {"$lt": today}}),
        "proximos_7": await agg({"status": {"$in": list(OPEN)}, "due_date": {"$gte": today, "$lte": semana}}),
        "parciais": await agg({"status": PARCIAL}),
        "realizado_periodo": {"count": real[0]["n"] if real else 0, "cents": real[0]["t"] if real else 0},
        "parceladas_abertas": await agg({"status": {"$in": list(OPEN)}, "mode": "parcelado"}),
        "recorrentes_abertas": await agg({"status": {"$in": list(OPEN)}, "mode": "recorrente"}),
        "por_categoria": por_categoria,
        "today": today,
    }


# =================== FLUXO DE CAIXA ===================
GRANULARITIES = {"mes": 12, "semana": 26, "dia": 62}
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def _buckets(granularity: str, n: int, today: str) -> list:
    t = date.fromisoformat(today)
    out = []
    if granularity == "mes":
        cur = t.replace(day=1)
        for _ in range(n):
            nxt = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
            out.append((cur.isoformat(), (nxt - timedelta(days=1)).isoformat(), f"{MESES[cur.month - 1]}/{cur.year % 100:02d}"))
            cur = nxt
    elif granularity == "semana":
        cur = t - timedelta(days=t.weekday())
        for _ in range(n):
            fim = cur + timedelta(days=6)
            out.append((cur.isoformat(), fim.isoformat(), f"{cur.day:02d}/{MESES[cur.month - 1]}"))
            cur = fim + timedelta(days=1)
    else:
        for i in range(n):
            d = t + timedelta(days=i)
            out.append((d.isoformat(), d.isoformat(), f"{d.day:02d}/{MESES[d.month - 1]}"))
    return out


@fin_router.get("/fluxo")
async def cash_flow(granularity: str = "mes", periods: int = 6, account_id: Optional[str] = None,
                    current=Depends(get_current_user)):
    """Caixa projetado, período a período:
        saldo inicial (1º período) = saldo atual das contas
        saldo final = saldo inicial + entradas previstas − saídas previstas
        saldo inicial do período seguinte = saldo final do anterior
    Entra SOMENTE o SALDO EM ABERTO de lançamentos pendentes/parciais — o que já
    foi pago/recebido (inclusive baixas parciais) está no saldo das contas; cancelados e solicitações ainda não aprovadas pela
    Execução nunca entram. Em aberto já vencidos caem no 1º período (ainda são
    esperados) e aparecem destacados em `vencidas_*`."""
    owner = _owner(current)
    if granularity not in GRANULARITIES:
        raise HTTPException(status_code=400, detail="Granularidade inválida")
    n = max(1, min(int(periods), GRANULARITIES[granularity]))
    today = today_sp()
    buckets = _buckets(granularity, n, today)
    contas_docs = await db.fin_cadastros.find({"owner_id": owner, "kind": "conta"}).to_list(500)
    saldos = await _account_balances(owner)
    contas = [{"id": c["id"], "nome": c.get("nome"), "instituicao": c.get("instituicao"), "logo_preset": c.get("logo_preset"),
               "logo_file_id": c.get("logo_file_id"), "ativo": c.get("ativo", True), "saldo_cents": saldos.get(c["id"], 0)}
              for c in contas_docs]
    if account_id:
        contas_sel = [c for c in contas if c["id"] == account_id]
        if not contas_sel:
            raise HTTPException(status_code=404, detail="Conta não encontrada")
    else:
        contas_sel = [c for c in contas if c["ativo"]]
    saldo_atual = sum(c["saldo_cents"] for c in contas_sel)

    match = {"owner_id": owner, "status": {"$in": list(OPEN)}, "due_date": {"$lte": buckets[-1][1]}}
    if account_id:
        card_ids = [c["id"] async for c in db.fin_cadastros.find({"owner_id": owner, "kind": "cartao", "conta_id": account_id})]
        match["$or"] = [{"bank_account_id": account_id}, {"card_id": {"$in": card_ids}}]
    rows = await db.fin_entries.find(match, {"type": 1, "amount_cents": 1, "settled_cents": 1, "due_date": 1}).to_list(20000)
    for r in rows:
        r["amount_cents"] = open_cents(r)
    prefs = await db.preferences.find_one({"owner_id": owner}) or {}
    minimo = int(((prefs.get("financeiro") or {}).get("caixa_minimo_cents")) or 0)

    out = []
    saldo = saldo_atual
    for i, (ini, fim, label) in enumerate(buckets):
        ent = sai = v_ent = v_sai = 0
        for r in rows:
            d = r["due_date"]
            if (ini <= d <= fim) or (i == 0 and d < ini):
                if r["type"] == RECEBER:
                    ent += r["amount_cents"]
                    v_ent += r["amount_cents"] if d < today else 0
                else:
                    sai += r["amount_cents"]
                    v_sai += r["amount_cents"] if d < today else 0
        final = saldo + ent - sai
        alerta = "negativo" if final < 0 else ("abaixo_minimo" if minimo and final < minimo else None)
        out.append({"inicio": ini, "fim": fim, "label": label, "saldo_inicial_cents": saldo, "entradas_cents": ent,
                    "saidas_cents": sai, "saldo_final_cents": final, "vencidas_entradas_cents": v_ent,
                    "vencidas_saidas_cents": v_sai, "alerta": alerta})
        saldo = final
    return {"saldo_atual_cents": saldo_atual, "contas": contas, "periodos": out, "caixa_minimo_cents": minimo,
            "today": today, "granularity": granularity}


# =================== HISTÓRICO (AUDITORIA) ===================
def _sp_day_bounds(day: str, end: bool = False) -> str:
    d = date.fromisoformat(parse_date(day))
    t = time(23, 59, 59, 999999) if end else time(0, 0)
    from datetime import timezone as _tz
    return datetime.combine(d, t, SP_TZ).astimezone(_tz.utc).isoformat()


@fin_router.get("/historico")
async def audit_log(q: Optional[str] = None, user_id: Optional[str] = None, action: Optional[str] = None,
                    module: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                    entity_id: Optional[str] = None,
                    page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100), dir: str = "desc",
                    current=Depends(get_current_user)):
    """Somente leitura. Ordem padrão: mais recente primeiro, pelo horário REAL da ação."""
    owner = _owner(current)
    query: dict = {"owner_id": owner}
    if user_id:
        query["user_id"] = user_id
    if action:
        query["action"] = {"$in": action.split(",")}
    if module:
        query["module"] = module
    if entity_id:
        query["$or"] = [{"entity_id": entity_id}, {"metadata.ids": entity_id}]
    rng = {}
    if date_from:
        rng["$gte"] = _sp_day_bounds(date_from)
    if date_to:
        rng["$lte"] = _sp_day_bounds(date_to, end=True)
    if rng:
        query["ts"] = rng
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query.setdefault("$and", []).append({"$or": [{"entity_label": rx}, {"entity_id": rx}, {"user_name": rx},
                                                     {"metadata.motivo": rx}, {"metadata.origem_label": rx},
                                                     {"metadata.cliente": rx}]})
    total = await db.fin_audit.count_documents(query)
    items = await db.fin_audit.find(query).sort("ts", 1 if dir == "asc" else -1) \
        .skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    users = await db.fin_audit.aggregate([{"$match": {"owner_id": owner}},
                                          {"$group": {"_id": "$user_id", "nome": {"$last": "$user_name"}}}]).to_list(200)
    hoje = today_sp()
    inicio_mes = hoje[:8] + "01"
    kpis = {
        "hoje": await db.fin_audit.count_documents({"owner_id": owner, "ts": {"$gte": _sp_day_bounds(hoje)}}),
        "alteracoes_mes": await db.fin_audit.count_documents({"owner_id": owner, "ts": {"$gte": _sp_day_bounds(inicio_mes)},
                                                              "action": {"$regex": "editad|alterad|atualizad|ajustad"}}),
        "baixas_mes": await db.fin_audit.count_documents({"owner_id": owner, "ts": {"$gte": _sp_day_bounds(inicio_mes)},
                                                          "action": {"$in": ["pagamento_baixado", "recebimento_baixado", "pagamento_parcial", "recebimento_parcial"]}}),
        "aprovacoes_mes": await db.fin_audit.count_documents({"owner_id": owner, "ts": {"$gte": _sp_day_bounds(inicio_mes)},
                                                              "action": "recebivel_aprovado"}),
    }
    return {"items": [_clean(i) for i in items], "total": total, "page": page, "page_size": page_size,
            "usuarios": [{"id": u["_id"], "nome": u["nome"]} for u in users], "kpis": kpis}


async def create_indexes() -> None:
    await db.fin_cadastros.create_index([("owner_id", 1), ("kind", 1), ("id", 1)])
    await db.fin_settings.create_index("owner_id", unique=True)
    await db.fin_entries.create_index([("owner_id", 1), ("id", 1)], unique=True)
    await db.fin_entries.create_index([("owner_id", 1), ("status", 1), ("due_date", 1)])
    await db.fin_entries.create_index([("owner_id", 1), ("type", 1), ("due_date", 1)])
    await db.fin_entries.create_index([("owner_id", 1), ("sequence_id", 1), ("sequence_index", 1)])
    await db.fin_entries.create_index([("owner_id", 1), ("create_token", 1), ("sequence_index", 1)], unique=True,
                                      partialFilterExpression={"create_token": {"$type": "string"}})
    await db.fin_entries.create_index([("owner_id", 1), ("request_id", 1)], unique=True,
                                      partialFilterExpression={"request_id": {"$type": "string"}})
    await db.fin_entries.create_index([("owner_id", 1), ("tag_ids", 1)])
    await db.fin_settlements.create_index([("owner_id", 1), ("entry_id", 1)])
    await db.fin_settlements.create_index([("owner_id", 1), ("bank_account_id", 1), ("created_at", 1)])
    await db.fin_settlements.create_index([("owner_id", 1), ("financial_date", -1)])
    await db.fin_audit.create_index([("owner_id", 1), ("ts", -1)])
    await db.fin_audit.create_index([("owner_id", 1), ("entity_id", 1)])
    await db.fin_requests.create_index([("owner_id", 1), ("status", 1), ("sent_at", -1)])
    await db.fin_requests.create_index([("owner_id", 1), ("bid_id", 1)])
    await db.fin_requests.create_index([("owner_id", 1), ("active_key", 1)], unique=True,
                                       partialFilterExpression={"active_key": {"$type": "string"}})

