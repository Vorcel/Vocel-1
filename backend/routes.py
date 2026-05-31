"""Core business routes: bids, lists/params, settings, budget (ERP), execution (post-sale)."""
from datetime import datetime, timezone
from typing import Optional, List, Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from db import db, now_iso
from auth import get_current_user

api = APIRouter(prefix="/api", tags=["core"])

DEFAULT_MODALIDADES = [
    "Pregão Eletrônico", "Pregão Presencial", "Concorrência",
    "Tomada de Preços", "Dispensa", "Inexigibilidade",
]
DEFAULT_PORTAIS = [
    "Comprasnet", "BLL Compras", "Licitações-e", "BNC", "Portal de Compras Públicas", "ComprasBR",
]
DEFAULT_STATUSES = [
    "Disputar", "Ganho", "Analisando proposta", "Adjudicado",
    "Desclassificado", "Perdido", "Adiado",
]
TIMELINE_STEPS = [
    "Aguardando Empenho", "Empenho Recebido", "Pedido de Compra",
    "Aguardando Mercadoria", "Mercadoria Recebida", "Faturamento / NF",
    "Expedição", "Em Transporte", "Entregue", "Concluído",
]


def ser(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc


# =================== PARAMS / LISTS ===================
class ListItemInput(BaseModel):
    value: str


async def _get_params() -> dict:
    p = await db.params.find_one({"_key": "global"})
    if not p:
        p = {
            "_key": "global",
            "modalidades": DEFAULT_MODALIDADES,
            "portais": DEFAULT_PORTAIS,
            "statuses": DEFAULT_STATUSES,
        }
        await db.params.insert_one(dict(p))
    return p


@api.get("/lists")
async def get_lists(current=Depends(get_current_user)):
    p = await _get_params()
    return {
        "modalidades": p.get("modalidades", DEFAULT_MODALIDADES),
        "portais": p.get("portais", DEFAULT_PORTAIS),
        "statuses": p.get("statuses", DEFAULT_STATUSES),
    }


_VALID_LISTS = {"modalidades", "portais", "statuses"}


@api.post("/lists/{list_type}")
async def add_list_item(list_type: str, body: ListItemInput, current=Depends(get_current_user)):
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    await _get_params()
    await db.params.update_one({"_key": "global"}, {"$addToSet": {list_type: body.value.strip()}})
    return await get_lists(current)


@api.delete("/lists/{list_type}/{value}")
async def remove_list_item(list_type: str, value: str, current=Depends(get_current_user)):
    if list_type not in _VALID_LISTS:
        raise HTTPException(status_code=400, detail="Tipo de lista inválido")
    await db.params.update_one({"_key": "global"}, {"$pull": {list_type: value}})
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
    termo_referencia: Optional[dict] = None   # {id, filename, url}
    status: str = "Disputar"
    favorito: bool = False


def _itens_list(itens: str) -> List[str]:
    if not itens:
        return []
    return [i.strip() for i in itens.split(",") if i.strip()]


@api.get("/bids")
async def list_bids(current=Depends(get_current_user)):
    bids = await db.bids.find().sort("data_disputa", 1).to_list(2000)
    return [ser(b) for b in bids]


@api.post("/bids")
async def create_bid(body: BidInput, current=Depends(get_current_user)):
    doc = body.model_dump()
    doc["itens_list"] = _itens_list(body.itens)
    doc["owner_id"] = current["id"]
    doc["created_at"] = now_iso()
    res = await db.bids.insert_one(doc)
    created = await db.bids.find_one({"_id": res.inserted_id})
    if body.status == "Adjudicado":
        await _ensure_execution(created)
    return ser(created)


@api.get("/bids/{bid_id}")
async def get_bid(bid_id: str, current=Depends(get_current_user)):
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    return ser(bid)


@api.put("/bids/{bid_id}")
async def update_bid(bid_id: str, body: BidInput, current=Depends(get_current_user)):
    doc = body.model_dump()
    doc["itens_list"] = _itens_list(body.itens)
    await db.bids.update_one({"_id": ObjectId(bid_id)}, {"$set": doc})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    if body.status == "Adjudicado":
        await _ensure_execution(bid)
    return ser(bid)


class StatusInput(BaseModel):
    status: str


@api.patch("/bids/{bid_id}/status")
async def change_status(bid_id: str, body: StatusInput, current=Depends(get_current_user)):
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    await db.bids.update_one({"_id": ObjectId(bid_id)}, {"$set": {"status": body.status}})
    bid["status"] = body.status
    if body.status == "Adjudicado":
        await _ensure_execution(bid)
    return ser(bid)


class FavoriteInput(BaseModel):
    favorito: bool


@api.patch("/bids/{bid_id}/favorite")
async def toggle_favorite(bid_id: str, body: FavoriteInput, current=Depends(get_current_user)):
    await db.bids.update_one({"_id": ObjectId(bid_id)}, {"$set": {"favorito": body.favorito}})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    return ser(bid)


@api.delete("/bids/{bid_id}")
async def delete_bid(bid_id: str, current=Depends(get_current_user)):
    await db.bids.delete_one({"_id": ObjectId(bid_id)})
    await db.budgets.delete_one({"bid_id": bid_id})
    await db.executions.delete_one({"bid_id": bid_id})
    return {"message": "Licitação removida"}


@api.get("/dashboard/summary")
async def dashboard_summary(current=Depends(get_current_user)):
    bids = await db.bids.find().to_list(5000)
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
    bud = await db.budgets.find_one({"bid_id": bid_id})
    bid = await db.bids.find_one({"_id": ObjectId(bid_id)})
    if not bid:
        raise HTTPException(status_code=404, detail="Licitação não encontrada")
    prefs = await db.preferences.find_one({"_key": "global"}) or {}
    if not bud:
        return {
            "bid_id": bid_id,
            "bid": ser(bid),
            "rows": [],
            "summary": {},
            "defaults": {
                "icms": prefs.get("icms_padrao", 18),
                "pis_cofins": prefs.get("pis_cofins_padrao", 9.25),
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
        },
    }


@api.put("/bids/{bid_id}/budget")
async def save_budget(bid_id: str, body: BudgetInput, current=Depends(get_current_user)):
    await db.budgets.update_one(
        {"bid_id": bid_id},
        {"$set": {"rows": body.rows, "summary": body.summary, "updated_at": now_iso()}},
        upsert=True,
    )
    # Propagate financials to execution if it exists
    exec_doc = await db.executions.find_one({"bid_id": bid_id})
    if exec_doc:
        s = body.summary or {}
        await db.executions.update_one(
            {"bid_id": bid_id},
            {"$set": {
                "valor_empenho": s.get("valor_total", 0),
                "valor_compra": s.get("custo_global", 0),
                "lucro_previsto": s.get("lucro_global", 0),
            }},
        )
    return {"message": "Orçamento salvo", "summary": body.summary}


# =================== EXECUTION / POST-SALE (Tela 4) ===================
async def _ensure_execution(bid: dict):
    """Create an execution record when a bid becomes Adjudicado (idempotent)."""
    bid_id = str(bid["_id"])
    existing = await db.executions.find_one({"bid_id": bid_id})
    if existing:
        return existing
    bud = await db.budgets.find_one({"bid_id": bid_id})
    s = (bud or {}).get("summary", {})
    doc = {
        "bid_id": bid_id,
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
        "timeline": [{"step": i, "name": name, "files": []} for i, name in enumerate(TIMELINE_STEPS)],
        "resumo_contrato": "",
        "pagamento_pendente": True,
        "created_at": now_iso(),
    }
    await db.executions.insert_one(doc)
    return doc


@api.get("/executions")
async def list_executions(current=Depends(get_current_user)):
    docs = await db.executions.find().sort("created_at", -1).to_list(2000)
    return [ser(d) for d in docs]


@api.get("/executions/kpis")
async def execution_kpis(current=Depends(get_current_user)):
    docs = await db.executions.find().to_list(2000)
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
    doc = await db.executions.find_one({"bid_id": bid_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    return ser(doc)


class ExecutionUpdate(BaseModel):
    model_config = {"extra": "allow"}
    status_atual: Optional[str] = None
    current_step: Optional[int] = None
    tempo_entrega_dias: Optional[int] = None
    data_entrega: Optional[str] = None
    resumo_contrato: Optional[str] = None
    pagamento_pendente: Optional[bool] = None
    valor_empenho: Optional[float] = None
    valor_compra: Optional[float] = None
    lucro_previsto: Optional[float] = None


@api.put("/executions/{bid_id}")
async def update_execution(bid_id: str, body: ExecutionUpdate, current=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # keep current_step and status_atual in sync
    if "current_step" in updates and "status_atual" not in updates:
        idx = max(0, min(updates["current_step"], len(TIMELINE_STEPS) - 1))
        updates["status_atual"] = TIMELINE_STEPS[idx]
    if "status_atual" in updates and "current_step" not in updates:
        if updates["status_atual"] in TIMELINE_STEPS:
            updates["current_step"] = TIMELINE_STEPS.index(updates["status_atual"])
    if updates:
        await db.executions.update_one({"bid_id": bid_id}, {"$set": updates})
    doc = await db.executions.find_one({"bid_id": bid_id})
    return ser(doc)


class TimelineFileInput(BaseModel):
    file: dict   # {id, filename, url}


@api.post("/executions/{bid_id}/timeline/{step}/file")
async def add_timeline_file(bid_id: str, step: int, body: TimelineFileInput, current=Depends(get_current_user)):
    doc = await db.executions.find_one({"bid_id": bid_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    timeline = doc.get("timeline", [])
    if 0 <= step < len(timeline):
        timeline[step].setdefault("files", []).append(body.file)
    await db.executions.update_one({"bid_id": bid_id}, {"$set": {"timeline": timeline}})
    doc = await db.executions.find_one({"bid_id": bid_id})
    return ser(doc)


@api.delete("/executions/{bid_id}/timeline/{step}/file/{file_id}")
async def remove_timeline_file(bid_id: str, step: int, file_id: str, current=Depends(get_current_user)):
    doc = await db.executions.find_one({"bid_id": bid_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    timeline = doc.get("timeline", [])
    if 0 <= step < len(timeline):
        timeline[step]["files"] = [f for f in timeline[step].get("files", []) if f.get("id") != file_id]
    await db.executions.update_one({"bid_id": bid_id}, {"$set": {"timeline": timeline}})
    doc = await db.executions.find_one({"bid_id": bid_id})
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


@api.get("/company")
async def get_company(current=Depends(get_current_user)):
    doc = await db.company.find_one({"_key": "global"})
    if not doc:
        return {}
    doc.pop("_id", None)
    doc.pop("_key", None)
    return doc


@api.put("/company")
async def update_company(body: CompanyInput, current=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.company.update_one({"_key": "global"}, {"$set": updates}, upsert=True)
    doc = await db.company.find_one({"_key": "global"})
    doc.pop("_id", None)
    doc.pop("_key", None)
    return doc


class PreferencesInput(BaseModel):
    model_config = {"extra": "allow"}
    theme: Optional[str] = None
    icms_padrao: Optional[float] = None
    pis_cofins_padrao: Optional[float] = None


@api.get("/preferences")
async def get_preferences(current=Depends(get_current_user)):
    doc = await db.preferences.find_one({"_key": "global"})
    if not doc:
        return {"theme": "light", "icms_padrao": 18, "pis_cofins_padrao": 9.25}
    doc.pop("_id", None)
    doc.pop("_key", None)
    return doc


@api.put("/preferences")
async def update_preferences(body: PreferencesInput, current=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.preferences.update_one({"_key": "global"}, {"$set": updates}, upsert=True)
    doc = await db.preferences.find_one({"_key": "global"})
    doc.pop("_id", None)
    doc.pop("_key", None)
    return doc
