"""Core business routes: bids, lists/params, settings, budget (ERP), execution (post-sale).

Todos os registros são isolados por usuário via `owner_id` (multi-tenant no mesmo banco).
Cada consulta/edição filtra pelo usuário autenticado; acesso a registros de outro
usuário retorna 404 (não revela existência)."""
from datetime import datetime, timezone
from typing import Optional, List, Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from db import db, now_iso
from auth import get_current_user

api = APIRouter(prefix="/api", tags=["core"])

DEFAULT_COLOR = "#64748B"
DEFAULT_MODALIDADES = [
    {"nome": "Pregão Eletrônico", "cor": "#0C7B93"},
    {"nome": "Pregão Presencial", "cor": "#0EA5E9"},
    {"nome": "Concorrência", "cor": "#8B5CF6"},
    {"nome": "Tomada de Preços", "cor": "#F59E0B"},
    {"nome": "Dispensa", "cor": "#10B981"},
    {"nome": "Inexigibilidade", "cor": "#64748B"},
]
DEFAULT_PORTAIS = [
    {"nome": "Comprasnet", "cor": "#0C7B93"},
    {"nome": "BLL Compras", "cor": "#8B5CF6"},
    {"nome": "Licitações-e", "cor": "#10B981"},
    {"nome": "BNC", "cor": "#F59E0B"},
    {"nome": "Portal de Compras Públicas", "cor": "#EF4444"},
    {"nome": "ComprasBR", "cor": "#0EA5E9"},
]
DEFAULT_STATUSES = [
    {"nome": "Disputar", "cor": "#0C7B93"},
    {"nome": "Ganho", "cor": "#10B981"},
    {"nome": "Analisando proposta", "cor": "#F59E0B"},
    {"nome": "Adjudicado", "cor": "#8B5CF6"},
    {"nome": "Desclassificado", "cor": "#EF4444"},
    {"nome": "Perdido", "cor": "#94A3B8"},
    {"nome": "Adiado", "cor": "#F97316"},
    {"nome": "Encerrado", "cor": "#475569"},
]
_DEFAULT_STATUS_COLORS = {s["nome"]: s["cor"] for s in DEFAULT_STATUSES}


def _normalize_list(items, kind=None):
    """Migrate legacy string lists to [{nome, cor}] objects."""
    out = []
    for it in items or []:
        if isinstance(it, str):
            cor = _DEFAULT_STATUS_COLORS.get(it, DEFAULT_COLOR) if kind == "statuses" else DEFAULT_COLOR
            out.append({"nome": it, "cor": cor})
        elif isinstance(it, dict):
            out.append({"nome": it.get("nome", ""), "cor": it.get("cor", DEFAULT_COLOR)})
    return out
TIMELINE_STEPS = [
    "Aguardando Empenho", "Empenho Recebido", "Comprar Mercadoria",
    "Aguardando Mercadoria", "Mercadoria Recebida", "Preparar para Transporte",
    "Emitir NF", "Em Transporte", "Entregue", "Solicitar Atestado",
    "Pagamento Recebido",
]
STEP_PENDENTE = "Pendente"


def ser(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc


def uid(current: dict) -> str:
    """Id do usuário autenticado — chave de isolamento de todos os dados."""
    return current["id"]


# =================== PARAMS / LISTS ===================
class ListItemInput(BaseModel):
    nome: str
    cor: str = DEFAULT_COLOR


class ListItemUpdate(BaseModel):
    old_nome: str
    nome: str
    cor: str = DEFAULT_COLOR


async def _get_params(owner_id: str) -> dict:
    p = await db.params.find_one({"owner_id": owner_id})
    if not p:
        p = {
            "owner_id": owner_id,
            "modalidades": DEFAULT_MODALIDADES,
            "portais": DEFAULT_PORTAIS,
            "statuses": DEFAULT_STATUSES,
        }
        await db.params.insert_one(dict(p))
    return p


@api.get("/lists")
async def get_lists(current=Depends(get_current_user)):
    p = await _get_params(uid(current))
    return {
        "modalidades": _normalize_list(p.get("modalidades", DEFAULT_MODALIDADES), "modalidades"),
        "portais": _normalize_list(p.get("portais", DEFAULT_PORTAIS), "portais"),
        "statuses": _normalize_list(p.get("statuses", DEFAULT_STATUSES), "statuses"),
    }


_VALID_LISTS = {"modalidades", "portais", "statuses"}
_BID_FIELD = {"modalidades": "modalidade", "portais": "portal", "statuses": "status"}


@api.post("/lists/{list_type}")
async def add_list_item(list_type: str, body: ListItemInput, current=Depends(get_current_user)):
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    owner = uid(current)
    p = await _get_params(owner)
    items = _normalize_list(p.get(list_type, []), list_type)
    nome = body.nome.strip()
    if nome and not any(i["nome"].lower() == nome.lower() for i in items):
        items.append({"nome": nome, "cor": body.cor})
    await db.params.update_one({"owner_id": owner}, {"$set": {list_type: items}})
    return await get_lists(current)


@api.put("/lists/{list_type}")
async def update_list_item(list_type: str, body: ListItemUpdate, current=Depends(get_current_user)):
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    owner = uid(current)
    p = await _get_params(owner)
    items = _normalize_list(p.get(list_type, []), list_type)
    new_nome = body.nome.strip()
    for i in items:
        if i["nome"] == body.old_nome:
            i["nome"] = new_nome
            i["cor"] = body.cor
    await db.params.update_one({"owner_id": owner}, {"$set": {list_type: items}})
    # Retroactive rename propagation to this user's bids only
    if new_nome and new_nome != body.old_nome:
        field = _BID_FIELD[list_type]
        await db.bids.update_many({field: body.old_nome, "owner_id": owner}, {"$set": {field: new_nome}})
    return await get_lists(current)


class ListReorderInput(BaseModel):
    names: List[str]


@api.put("/lists/{list_type}/reorder")
async def reorder_list(list_type: str, body: ListReorderInput, current=Depends(get_current_user)):
    """Persiste a ordem manual (drag-and-drop) de uma lista de parâmetros.
    A ordem é a posição no próprio array do doc `params` — todos os menus,
    filtros e formulários já consomem o array em ordem. Itens não citados
    no payload são preservados no fim (retrocompatível, nada é recriado)."""
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    owner = uid(current)
    p = await _get_params(owner)
    by_name = {i["nome"]: i for i in _normalize_list(p.get(list_type, []), list_type)}
    ordered = [by_name.pop(n) for n in body.names if n in by_name]
    ordered.extend(by_name.values())
    await db.params.update_one({"owner_id": owner}, {"$set": {list_type: ordered}})
    return await get_lists(current)


@api.delete("/lists/{list_type}/{value}")
async def remove_list_item(list_type: str, value: str, current=Depends(get_current_user)):
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    owner = uid(current)
    p = await _get_params(owner)
    items = [i for i in _normalize_list(p.get(list_type, []), list_type) if i["nome"] != value]
    await db.params.update_one({"owner_id": owner}, {"$set": {list_type: items}})
    return await get_lists(current)


# =================== BIDS ===================
class BidInput(BaseModel):
    objeto: str
    modalidade: str
    itens: str = ""
    portal: str
    data_disputa: str            # ISO date YYYY-MM-DD
    hora: str = ""
    pregao: str = ""
    uasg: str = ""
    observacao: str = ""
    observacoes: List[dict] = []
    proposta_enviada: bool = False
    termo_referencia: Optional[dict] = None   # {id, filename, url}
    anexos: List[dict] = []                    # arquivos adicionais [{id, filename, url}]
    status: str = "Disputar"
    favorito: bool = False


def _itens_list(itens: str) -> List[str]:
    if not itens:
        return []
    return [i.strip() for i in itens.split(",") if i.strip()]


async def _owned_bid(bid_id: str, owner: str) -> Optional[dict]:
    """Busca um bid garantindo que pertence ao usuário. ObjectId inválido => None."""
    try:
        oid = ObjectId(bid_id)
    except Exception:
        return None
    return await db.bids.find_one({"_id": oid, "owner_id": owner})


@api.get("/bids")
async def list_bids(current=Depends(get_current_user)):
    bids = await db.bids.find({"owner_id": uid(current)}).sort("data_disputa", 1).to_list(2000)
    return [ser(b) for b in bids]


@api.post("/bids")
async def create_bid(body: BidInput, current=Depends(get_current_user)):
    doc = body.model_dump()
    doc["itens_list"] = _itens_list(body.itens)
    doc["owner_id"] = uid(current)
    doc["created_at"] = now_iso()
    res = await db.bids.insert_one(doc)
    created = await db.bids.find_one({"_id": res.inserted_id})
    await _sync_execution(created)
    return ser(created)


@api.get("/bids/{bid_id}")
async def get_bid(bid_id: str, current=Depends(get_current_user)):
    bid = await _owned_bid(bid_id, uid(current))
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    return ser(bid)


@api.put("/bids/{bid_id}")
async def update_bid(bid_id: str, body: BidInput, current=Depends(get_current_user)):
    owner = uid(current)
    existing = await _owned_bid(bid_id, owner)
    if not existing:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    doc = body.model_dump()
    doc["itens_list"] = _itens_list(body.itens)
    await db.bids.update_one({"_id": ObjectId(bid_id), "owner_id": owner}, {"$set": doc})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    await _sync_execution(bid)
    return ser(bid)


class StatusInput(BaseModel):
    status: str


@api.patch("/bids/{bid_id}/status")
async def change_status(bid_id: str, body: StatusInput, current=Depends(get_current_user)):
    owner = uid(current)
    bid = await _owned_bid(bid_id, owner)
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.update_one({"_id": ObjectId(bid_id), "owner_id": owner}, {"$set": {"status": body.status}})
    bid["status"] = body.status
    await _sync_execution(bid)
    return ser(bid)


class FavoriteInput(BaseModel):
    favorito: bool


@api.patch("/bids/{bid_id}/favorite")
async def toggle_favorite(bid_id: str, body: FavoriteInput, current=Depends(get_current_user)):
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.update_one({"_id": ObjectId(bid_id), "owner_id": owner}, {"$set": {"favorito": body.favorito}})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    return ser(bid)


class ObservacoesInput(BaseModel):
    observacoes: List[dict] = []


@api.patch("/bids/{bid_id}/observacoes")
async def update_observacoes(bid_id: str, body: ObservacoesInput, current=Depends(get_current_user)):
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.update_one({"_id": ObjectId(bid_id), "owner_id": owner}, {"$set": {"observacoes": body.observacoes}})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    return ser(bid)


class PropostaInput(BaseModel):
    proposta_enviada: bool


@api.patch("/bids/{bid_id}/proposta")
async def update_proposta(bid_id: str, body: PropostaInput, current=Depends(get_current_user)):
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.update_one({"_id": ObjectId(bid_id), "owner_id": owner}, {"$set": {"proposta_enviada": body.proposta_enviada}})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    return ser(bid)


@api.delete("/bids/{bid_id}")
async def delete_bid(bid_id: str, current=Depends(get_current_user)):
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.delete_one({"_id": ObjectId(bid_id), "owner_id": owner})
    await db.budgets.delete_one({"bid_id": bid_id, "owner_id": owner})
    await db.executions.delete_one({"bid_id": bid_id, "owner_id": owner})
    return {"message": "Licitação removida"}


@api.get("/dashboard/summary")
async def dashboard_summary(current=Depends(get_current_user)):
    bids = await db.bids.find({"owner_id": uid(current)}).to_list(5000)
    now = datetime.now(timezone.utc)
    month_count = 0
    adjudicadas = 0
    acompanhando = 0
    for b in bids:
        dd = b.get("data_disputa", "")
        if dd:
            try:
                d = datetime.fromisoformat(dd)
                if d.year == now.year and d.month == now.month:
                    month_count += 1
            except ValueError:
                pass
        if b.get("status") == "Adjudicado":
            adjudicadas += 1
        if b.get("favorito"):
            acompanhando += 1
    return {
        "licitacoes_mes": month_count,
        "adjudicadas": adjudicadas,
        "acompanhando": acompanhando,
    }


# =================== BUDGET / ERP (Tela 2) ===================
class BudgetRow(BaseModel):
    model_config = {"extra": "allow"}
    selecionado: bool = False
    item: str = ""
    produto: str = ""
    marca: str = ""
    fornecedor: str = ""
    site: str = ""
    valor_compra: float = 0
    qtd: float = 1
    valor_venda: Optional[float] = None
    margem: Optional[float] = None
    icms: float = 0
    pis_cofins: float = 0
    outros_sem_imp: float = 0
    outros_com_imp: float = 0
    frete_receber: float = 0
    frete_enviar: float = 0


class BudgetInput(BaseModel):
    rows: List[dict]
    summary: dict = Field(default_factory=dict)


@api.get("/bids/{bid_id}/budget")
async def get_budget(bid_id: str, current=Depends(get_current_user)):
    owner = uid(current)
    bid = await _owned_bid(bid_id, owner)
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    bud = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner})
    prefs = await db.preferences.find_one({"owner_id": owner}) or {}
    if not bud:
        return {
            "bid_id": bid_id,
            "bid": ser(bid),
            "rows": [],
            "summary": {},
            "defaults": {
                "icms": prefs.get("icms_padrao", 18),
                "pis_cofins": prefs.get("pis_cofins_padrao", 9.25),
                "margem": prefs.get("margem_padrao", 30),
            },
        }
    return {
        "bid_id": bid_id,
        "bid": ser(bid),
        "rows": bud.get("rows", []),
        "summary": bud.get("summary", {}),
        "defaults": {
            "icms": prefs.get("icms_padrao", 18),
            "pis_cofins": prefs.get("pis_cofins_padrao", 9.25),
            "margem": prefs.get("margem_padrao", 30),
        },
    }


@api.put("/bids/{bid_id}/budget")
async def save_budget(bid_id: str, body: BudgetInput, current=Depends(get_current_user)):
    owner = uid(current)
    if not await _owned_bid(bid_id, owner):
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.budgets.update_one(
        {"bid_id": bid_id, "owner_id": owner},
        {"$set": {"rows": body.rows, "summary": body.summary, "owner_id": owner, "updated_at": now_iso()}},
        upsert=True,
    )
    # Propagate financials to execution if it exists
    exec_doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if exec_doc:
        s = body.summary or {}
        await db.executions.update_one(
            {"bid_id": bid_id, "owner_id": owner},
            {"$set": {
                "valor_empenho": s.get("valor_total", 0),
                "valor_compra": s.get("custo_global", 0),
                "lucro_previsto": s.get("lucro_global", 0),
            }},
        )
    return {"message": "Orçamento salvo", "summary": body.summary}


# =================== EXECUTION / POST-SALE (Tela 4) ===================
async def _ensure_execution(bid: dict):
    """Create an execution record when a bid becomes Adjudicado (idempotent).
    Herda o owner_id do bid, mantendo o isolamento por usuário."""
    bid_id = str(bid["_id"])
    owner = bid.get("owner_id")
    existing = await db.executions.find_one({"bid_id": bid_id})
    if existing:
        return existing
    bud = await db.budgets.find_one({"bid_id": bid_id})
    s = (bud or {}).get("summary", {})
    doc = {
        "bid_id": bid_id,
        "owner_id": owner,
        "objeto": bid.get("objeto", ""),
        "portal": bid.get("portal", ""),
        "modalidade": bid.get("modalidade", ""),
        "data_cadastro": bid.get("data_disputa", now_iso()[:10]),
        "termo_referencia": bid.get("termo_referencia"),
        "valor_empenho": s.get("valor_total", 0),
        "valor_compra": s.get("custo_global", 0),
        "lucro_previsto": s.get("lucro_global", 0),
        "tempo_entrega_dias": 30,
        "data_entrega": "",
        "status_atual": TIMELINE_STEPS[0],
        "current_step": 0,
        "timeline": [{"step": i, "name": name, "status": STEP_PENDENTE, "files": []} for i, name in enumerate(TIMELINE_STEPS)],
        "resumo_contrato": "",
        "pagamento_pendente": True,
        "created_at": now_iso(),
    }
    await db.executions.insert_one(doc)
    return doc


async def _sync_execution(bid: dict):
    """Mantém a página de Execução/Pós-vendas em sincronia com o status da licitação.
    - Status "Adjudicado": garante a execução correspondente (idempotente).
    - Qualquer outro status: remove a execução da Execução/Pós-vendas. A licitação,
      o orçamento e os arquivos vinculados permanecem intactos — só o registro de
      execução é descartado.
    Respeita o owner_id (recebido no próprio bid já verificado) para nunca tocar
    dados de outro usuário."""
    bid_id = str(bid["_id"])
    owner = bid.get("owner_id")
    if bid.get("status") == "Adjudicado":
        await _ensure_execution(bid)
    else:
        await db.executions.delete_one({"bid_id": bid_id, "owner_id": owner})


async def _budget_totals(bid_id: str, owner: str) -> dict:
    """Agrega os valores financeiros do orçamento (soma de todos os lotes).
    O orçamento salva `summary = computeTotals(rows)` = soma das linhas selecionadas
    de todos os lotes, com as chaves valor_total / custo_global / lucro_global."""
    bud = await db.budgets.find_one({"bid_id": bid_id, "owner_id": owner})
    s = (bud or {}).get("summary") or {}
    return {
        "valor_total": float(s.get("valor_total", 0) or 0),
        "custo_global": float(s.get("custo_global", 0) or 0),
        "lucro_global": float(s.get("lucro_global", 0) or 0),
    }


async def _enrich_execution(doc: dict, owner: str) -> dict:
    """Injeta os valores reais agregados do orçamento na execução (tempo real).
    - valor_compra  = soma do custo de todos os lotes
    - lucro_previsto = soma do lucro de todos os lotes
    - valor_empenho  = override manual (edição inline), se houver; senão o valor total agregado"""
    t = await _budget_totals(doc.get("bid_id", ""), owner)
    # Empenho, Compra e Lucro Previsto seguem a MESMA base: o orçamento vinculado
    # (soma de todos os lotes). Empenho = "Valor Total" do orçamento (card azul).
    doc["valor_empenho"] = t["valor_total"]
    doc["valor_compra"] = t["custo_global"]
    doc["lucro_previsto"] = t["lucro_global"]
    return doc


@api.get("/executions")
async def list_executions(current=Depends(get_current_user)):
    owner = uid(current)
    docs = await db.executions.find({"owner_id": owner}).sort("created_at", -1).to_list(2000)
    return [await _enrich_execution(ser(d), owner) for d in docs]


@api.get("/executions/kpis")
async def execution_kpis(current=Depends(get_current_user)):
    docs = await db.executions.find({"owner_id": uid(current)}).to_list(2000)
    lucro_total = sum(float(d.get("lucro_previsto", 0) or 0) for d in docs)
    em_andamento = sum(1 for d in docs if d.get("status_atual") != "Concluído")
    pagamentos_pendentes = sum(1 for d in docs if d.get("pagamento_pendente"))
    return {
        "lucro_total": lucro_total,
        "em_andamento": em_andamento,
        "pagamentos_pendentes": pagamentos_pendentes,
    }


@api.get("/executions/{bid_id}")
async def get_execution(bid_id: str, current=Depends(get_current_user)):
    owner = uid(current)
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    return await _enrich_execution(ser(doc), owner)


class ExecutionUpdate(BaseModel):
    model_config = {"extra": "allow"}
    status_atual: Optional[str] = None
    current_step: Optional[int] = None
    tempo_entrega_dias: Optional[int] = None
    data_entrega: Optional[str] = None
    data_referencia_entrega: Optional[str] = None   # base do cálculo do prazo (ISO YYYY-MM-DD)
    resumo_contrato: Optional[str] = None
    pagamento_pendente: Optional[bool] = None
    valor_empenho: Optional[float] = None
    valor_compra: Optional[float] = None
    lucro_previsto: Optional[float] = None


@api.put("/executions/{bid_id}")
async def update_execution(bid_id: str, body: ExecutionUpdate, current=Depends(get_current_user)):
    owner = uid(current)
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # keep current_step and status_atual in sync
    if "current_step" in updates and "status_atual" not in updates:
        idx = max(0, min(updates["current_step"], len(TIMELINE_STEPS) - 1))
        updates["status_atual"] = TIMELINE_STEPS[idx]
    if "status_atual" in updates and "current_step" not in updates:
        if updates["status_atual"] in TIMELINE_STEPS:
            updates["current_step"] = TIMELINE_STEPS.index(updates["status_atual"])
    if updates:
        await db.executions.update_one({"bid_id": bid_id, "owner_id": owner}, {"$set": updates})
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    return await _enrich_execution(ser(doc), owner)


class TimelineFileInput(BaseModel):
    file: dict   # {id, filename, url}


@api.post("/executions/{bid_id}/timeline/{step}/file")
async def add_timeline_file(bid_id: str, step: int, body: TimelineFileInput, current=Depends(get_current_user)):
    owner = uid(current)
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    timeline = doc.get("timeline", [])
    if 0 <= step < len(timeline):
        timeline[step].setdefault("files", []).append(body.file)
    await db.executions.update_one({"bid_id": bid_id, "owner_id": owner}, {"$set": {"timeline": timeline}})
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    return ser(doc)


@api.delete("/executions/{bid_id}/timeline/{step}/file/{file_id}")
async def remove_timeline_file(bid_id: str, step: int, file_id: str, current=Depends(get_current_user)):
    owner = uid(current)
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    timeline = doc.get("timeline", [])
    if 0 <= step < len(timeline):
        timeline[step]["files"] = [f for f in timeline[step].get("files", []) if f.get("id") != file_id]
    await db.executions.update_one({"bid_id": bid_id, "owner_id": owner}, {"$set": {"timeline": timeline}})
    doc = await db.executions.find_one({"bid_id": bid_id, "owner_id": owner})
    return ser(doc)


# =================== COMPANY & PREFERENCES (Tela 3) ===================
class CompanyInput(BaseModel):
    model_config = {"extra": "allow"}
    razao_social: Optional[str] = None
    nome_fantasia: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    logo_url: Optional[str] = None


def _strip_meta(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("_key", None)
    doc.pop("owner_id", None)
    return doc


@api.get("/company")
async def get_company(current=Depends(get_current_user)):
    doc = await db.company.find_one({"owner_id": uid(current)})
    if not doc:
        return {}
    return _strip_meta(doc)


@api.put("/company")
async def update_company(body: CompanyInput, current=Depends(get_current_user)):
    owner = uid(current)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.company.update_one({"owner_id": owner}, {"$set": {**updates, "owner_id": owner}}, upsert=True)
    doc = await db.company.find_one({"owner_id": owner})
    return _strip_meta(doc)


class PreferencesInput(BaseModel):
    model_config = {"extra": "allow"}
    theme: Optional[str] = None
    icms_padrao: Optional[float] = None
    pis_cofins_padrao: Optional[float] = None
    margem_padrao: Optional[float] = None


@api.get("/preferences")
async def get_preferences(current=Depends(get_current_user)):
    doc = await db.preferences.find_one({"owner_id": uid(current)})
    if not doc:
        return {"theme": "light", "icms_padrao": 18, "pis_cofins_padrao": 9.25, "margem_padrao": 30}
    return _strip_meta(doc)


@api.put("/preferences")
async def update_preferences(body: PreferencesInput, current=Depends(get_current_user)):
    owner = uid(current)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.preferences.update_one({"owner_id": owner}, {"$set": {**updates, "owner_id": owner}}, upsert=True)
    doc = await db.preferences.find_one({"owner_id": owner})
    return _strip_meta(doc)
