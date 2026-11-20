"""Tarefas da equipe (Página inicial › Tarefas do Dia + página /tarefas).

ISOLAMENTO
- Toda tarefa e todo responsável têm `owner_id` = dono da conta (current["id"]);
  toda leitura e escrita filtra por ele. Registro de outra conta => 404/400.

RESPONSÁVEL x USUÁRIO DO SISTEMA (desde 2026-11-19, rodada 2)
- Responsável de tarefa é um CADASTRO PRÓPRIO (coleção `task_responsibles`:
  nome + ativo), gerenciado em Configurações › Responsáveis. Não tem login,
  senha, e-mail nem permissões e NÃO tem relação com `users`.
- A tarefa guarda `responsible_id` + `responsible_name` (snapshot): inativar o
  responsável não apaga o nome do histórico; renomear atualiza as tarefas.
- Tarefas antigas (assignee_id/assignee_name = usuário interno) são migradas no
  boot por `migrate_task_responsibles` (idempotente): o nome vira um responsável.

DATA / FUSO
- Mesma estratégia das licitações (data_disputa + hora): a data final é gravada
  como horário LOCAL de America/Sao_Paulo em `due_date` ("YYYY-MM-DD") +
  `due_time` ("HH:MM"), e `due_key` = "YYYY-MM-DDTHH:MM" (ordenável como texto).
  Nada de conversão para UTC → nenhum deslocamento visual de dia/hora.
- Hoje / Amanhã / Próximos / Esta semana (segunda a domingo) são calculados no
  servidor, no fuso de São Paulo, a cada requisição — nunca datas fixas salvas.

PERMISSÕES (permissions.py)
- tasks.view / tasks.create / tasks.edit / tasks.complete / tasks.delete.
- Mudar status = tasks.complete; os demais campos = tasks.edit (por campo).
- Responsáveis: task_responsibles.view / create / edit / deactivate — independentes
  da gestão de usuários do sistema."""
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import audit, get_current_user
from db import db, now_iso
from fin_core import SP_TZ
from permissions import has

tasks_router = APIRouter(prefix="/api/tasks", tags=["tasks"])

STATUSES = {"pendente": "Pendente", "em_andamento": "Em andamento", "concluida": "Concluída"}
PRIORITIES = {"baixa": "Baixa", "media": "Média", "alta": "Alta"}
PRIORITY_RANK = {"alta": 0, "media": 1, "baixa": 2}
DONE = "concluida"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

HOME_MAX = 10           # a home nunca mostra mais que 10
PAGE_SIZES = (5, 10, 25, 50)
HOME_SCOPES = ("todos", "hoje", "amanha", "proximos2", "semana")
PAGE_SCOPES = ("todas", "hoje", "amanha", "proximos", "semana")

# Campos de edição comum (tasks.edit). Status é tasks.complete.
EDIT_FIELDS = {"title", "responsible_id", "priority", "due_date", "due_time", "bid_id", "notes"}

FORBIDDEN = lambda msg: HTTPException(status_code=403, detail={"code": "forbidden", "msg": msg})  # noqa: E731


# ------------------------------------------------------------ helpers
def sp_today() -> datetime:
    return datetime.now(SP_TZ)


def day_str(d: datetime, plus: int = 0) -> str:
    return (d + timedelta(days=plus)).strftime("%Y-%m-%d")


def week_bounds(today: datetime) -> tuple:
    """Segunda-feira e domingo da semana corrente (datas de São Paulo)."""
    monday = today - timedelta(days=today.weekday())   # weekday(): segunda=0 ... domingo=6
    return day_str(monday), day_str(monday, 6)


def _clean_text(v: Optional[str], limit: int) -> str:
    return (v or "").strip()[:limit]


def _valid_date(v: str) -> str:
    v = (v or "").strip()
    if not DATE_RE.match(v):
        raise HTTPException(status_code=400, detail="Informe a data final.")
    try:
        datetime.strptime(v, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Data final inválida.")
    return v


def _valid_time(v: str) -> str:
    v = (v or "").strip()
    if not TIME_RE.match(v):
        raise HTTPException(status_code=400, detail="Informe o horário final.")
    return v


def _out(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("owner_id", None)
    return doc


async def _enrich(owner_id: str, items: list) -> list:
    """Dados ATUAIS da licitação vinculada (pregão + modalidade) para a tag da
    coluna Tarefa. Uma consulta só; licitação excluída fica sem tag."""
    oids = []
    for t in items:
        try:
            if t.get("bid_id"):
                oids.append(ObjectId(t["bid_id"]))
        except Exception:
            pass
    bids = {}
    if oids:
        async for b in db.bids.find({"_id": {"$in": oids}, "owner_id": owner_id}, {"pregao": 1, "modalidade": 1}):
            bids[str(b["_id"])] = b
    for t in items:
        b = bids.get(t.get("bid_id") or "")
        t["bid_pregao"] = (b.get("pregao") or "") if b else ""
        t["bid_modalidade"] = (b.get("modalidade") or "") if b else ""
    return items


async def _resolve_responsible(owner_id: str, rid: Optional[str]) -> tuple:
    """(id, nome) — precisa ser um responsável ATIVO desta conta."""
    if not rid:
        return None, ""
    r = await db.task_responsibles.find_one({"id": rid, "owner_id": owner_id, "active": True})
    if not r:
        raise HTTPException(status_code=400, detail="Responsável inválido ou inativo.")
    return r["id"], r["name"]


async def _resolve_bid(owner_id: str, bid_id: Optional[str]) -> tuple:
    """(id, rótulo) da licitação vinculada — precisa ser desta conta."""
    if not bid_id:
        return None, ""
    try:
        bid = await db.bids.find_one({"_id": ObjectId(bid_id), "owner_id": owner_id},
                                     {"pregao": 1, "objeto": 1, "modalidade": 1})
    except Exception:
        bid = None
    if not bid:
        raise HTTPException(status_code=400, detail="Licitação não encontrada nesta conta.")
    pregao = (bid.get("pregao") or "").strip()
    objeto = (bid.get("objeto") or "").strip()
    label = " — ".join(p for p in [f"PE {pregao}" if pregao else "", objeto[:80]] if p) or "Licitação"
    return str(bid["_id"]), label


async def _get(owner_id: str, task_id: str) -> dict:
    doc = await db.tasks.find_one({"id": task_id, "owner_id": owner_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    return doc


def _scope_query(scope: str, today: datetime, home: bool = False) -> dict:
    """Janela de datas de cada filtro (fuso de São Paulo).
    - hoje: data final = hoje; + atrasadas abertas de dias anteriores; + concluídas
      HOJE (ficam visíveis, riscadas, até o fim do dia).
    - amanha: data final = amanhã.
    - proximos2: os DOIS dias depois de amanhã (home).
    - proximos: de depois de amanhã em diante (página completa).
    - todos (home): todas as abertas + concluídas hoje.
    - semana: segunda a domingo da semana corrente. Na home, concluídas seguem a
      regra de sempre (só aparecem até o fim do dia em que foram concluídas);
      na página completa aparecem todas (histórico)."""
    t0, t1, t2, t3 = (day_str(today, i) for i in range(4))
    if scope == "todos":
        # Home: todas as abertas (qualquer data) + concluídas HOJE (riscadas até o fim do dia).
        return {"$or": [{"status": {"$ne": DONE}}, {"completed_date": t0}]}
    if scope == "hoje":
        return {"$or": [
            {"due_date": t0},
            {"due_date": {"$lt": t0}, "status": {"$ne": DONE}},
            {"due_date": {"$lt": t0}, "status": DONE, "completed_date": t0},
        ]}
    if scope == "amanha":
        return {"due_date": t1}
    if scope == "proximos2":
        return {"due_date": {"$in": [t2, t3]}}
    if scope == "proximos":
        return {"due_date": {"$gte": t2}}
    if scope == "semana":
        mon, sun = week_bounds(today)
        q = {"due_date": {"$gte": mon, "$lte": sun}}
        if home:
            q["$or"] = [{"status": {"$ne": DONE}}, {"completed_date": t0}]
        return q
    return {}


# Urgência: abertas antes das concluídas; depois vencimento mais próximo (atrasadas
# primeiro, pois são as mais antigas); empate de data/hora: Alta → Média → Baixa.
SORT = [("done", 1), ("due_key", 1), ("priority_rank", 1), ("created_at", 1)]


# ------------------------------------------------------------ modelos
class TaskInput(BaseModel):
    model_config = {"extra": "forbid"}
    title: str = Field(max_length=300)
    responsible_id: Optional[str] = None
    status: str = "pendente"
    priority: str = "media"
    due_date: str
    due_time: str
    bid_id: Optional[str] = None
    notes: Optional[str] = Field(default="", max_length=4000)


class TaskUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    title: Optional[str] = Field(default=None, max_length=300)
    responsible_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    bid_id: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=4000)


class ResponsibleInput(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(max_length=120)
    active: bool = True


class ResponsibleUpdate(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(default=None, max_length=120)
    active: Optional[bool] = None


def _check_status(v: str) -> str:
    if v not in STATUSES:
        raise HTTPException(status_code=400, detail="Status inválido.")
    return v


def _check_priority(v: str) -> str:
    if v not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Prioridade inválida.")
    return v


def _actor(current: dict) -> tuple:
    return current.get("actor_id") or current["id"], current.get("actor_name") or current.get("name") or ""


# ------------------------------------------------------------ responsáveis
def _resp_out(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "active": bool(r.get("active", True))}


async def _name_taken(owner: str, name: str, exclude_id: Optional[str] = None) -> bool:
    q = {"owner_id": owner, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return await db.task_responsibles.find_one(q, {"_id": 1}) is not None


@tasks_router.get("/responsibles")
async def list_responsibles(all: bool = Query(False), current=Depends(get_current_user)):
    """Ativos (para o modal/filtros) ou todos (`all=1`, tela de Configurações)."""
    q = {"owner_id": current["id"]}
    if not all:
        q["active"] = True
    return [_resp_out(r) async for r in db.task_responsibles.find(q).collation({"locale": "pt"}).sort("name", 1)]


@tasks_router.post("/responsibles")
async def create_responsible(body: ResponsibleInput, current=Depends(get_current_user)):
    owner = current["id"]
    name = _clean_text(body.name, 120)
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do responsável.")
    if await _name_taken(owner, name):
        raise HTTPException(status_code=400, detail="Já existe um responsável com esse nome.")
    actor_id, actor_name = _actor(current)
    doc = {"id": str(uuid.uuid4()), "owner_id": owner, "name": name, "active": bool(body.active),
           "created_by": actor_id, "created_by_name": actor_name, "created_at": now_iso(), "updated_at": now_iso()}
    await db.task_responsibles.insert_one(dict(doc))
    await audit(current, "responsavel_criado", module="tarefas", entity_type="responsavel", entity_id=doc["id"],
                entity_label=name)
    return _resp_out(doc)


@tasks_router.put("/responsibles/{rid}")
async def update_responsible(rid: str, body: ResponsibleUpdate, current=Depends(get_current_user)):
    owner = current["id"]
    before = await db.task_responsibles.find_one({"id": rid, "owner_id": owner})
    if not before:
        raise HTTPException(status_code=404, detail="Responsável não encontrado")
    sent = body.model_dump(exclude_unset=True)
    upd = {}
    if "name" in sent and sent["name"] is not None:
        if not has(current, "task_responsibles.edit"):
            raise FORBIDDEN("Você não tem permissão para editar responsáveis.")
        name = _clean_text(sent["name"], 120)
        if not name:
            raise HTTPException(status_code=400, detail="Informe o nome do responsável.")
        if name != before["name"]:
            if await _name_taken(owner, name, exclude_id=rid):
                raise HTTPException(status_code=400, detail="Já existe um responsável com esse nome.")
            upd["name"] = name
    if "active" in sent and sent["active"] is not None and bool(sent["active"]) != bool(before.get("active", True)):
        if not has(current, "task_responsibles.deactivate"):
            raise FORBIDDEN("Você não tem permissão para ativar/inativar responsáveis.")
        upd["active"] = bool(sent["active"])
    if not upd:
        return _resp_out(before)
    upd["updated_at"] = now_iso()
    await db.task_responsibles.update_one({"id": rid, "owner_id": owner}, {"$set": upd})
    if "name" in upd:
        # Renomear corrige o nome exibido nas tarefas (é o mesmo responsável).
        await db.tasks.update_many({"owner_id": owner, "responsible_id": rid}, {"$set": {"responsible_name": upd["name"]}})
        await audit(current, "responsavel_editado", module="tarefas", entity_type="responsavel", entity_id=rid,
                    entity_label=upd["name"], changes=[{"field": "name", "label": "Nome", "before": before["name"], "after": upd["name"]}])
    if "active" in upd:
        await audit(current, "responsavel_ativado" if upd["active"] else "responsavel_inativado", module="tarefas",
                    entity_type="responsavel", entity_id=rid, entity_label=upd.get("name", before["name"]))
    return _resp_out({**before, **upd})


# ------------------------------------------------------------ tarefas
@tasks_router.get("/summary")
async def tasks_summary(scope: str = Query("todos"), limit: int = Query(HOME_MAX, ge=1, le=HOME_MAX),
                        current=Depends(get_current_user)):
    """Resumo da home: contadores dos filtros + até `limit` (máx. 10) tarefas do
    filtro escolhido, já ordenadas por urgência. Nada é filtrado no navegador."""
    if scope not in HOME_SCOPES:
        raise HTTPException(status_code=400, detail="Filtro inválido.")
    owner = current["id"]
    today = sp_today()
    counts = {}
    for s in HOME_SCOPES:
        counts[s] = await db.tasks.count_documents({"owner_id": owner, **_scope_query(s, today, home=True)})
    cur = db.tasks.find({"owner_id": owner, **_scope_query(scope, today, home=True)}).sort(SORT).limit(limit)
    items = await _enrich(owner, [_out(d) async for d in cur])
    mon, sun = week_bounds(today)
    return {"today": day_str(today), "week": {"from": mon, "to": sun}, "counts": counts,
            "items": items, "total": counts[scope]}


@tasks_router.get("")
async def list_tasks(
    scope: str = Query("todas"),
    q: Optional[str] = None,
    responsible: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10),
    current=Depends(get_current_user),
):
    """Página completa: filtros e paginação no servidor."""
    if scope not in PAGE_SCOPES:
        raise HTTPException(status_code=400, detail="Filtro inválido.")
    if page_size not in PAGE_SIZES:
        page_size = 10
    owner = current["id"]
    today = sp_today()
    conds = [{"owner_id": owner}]
    sq = _scope_query(scope, today)
    if sq:
        conds.append(sq)
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()[:100]), "$options": "i"}
        conds.append({"$or": [{"title": rx}, {"notes": rx}, {"bid_label": rx}, {"responsible_name": rx}]})
    if responsible:
        conds.append({"responsible_id": None if responsible == "none" else responsible})
    if status:
        conds.append({"status": _check_status(status)})
    if priority:
        conds.append({"priority": _check_priority(priority)})
    if date_from:
        conds.append({"due_date": {"$gte": _valid_date(date_from)}})
    if date_to:
        conds.append({"due_date": {"$lte": _valid_date(date_to)}})
    query = {"$and": conds}
    total = await db.tasks.count_documents(query)
    cur = db.tasks.find(query).sort(SORT).skip((page - 1) * page_size).limit(page_size)
    items = await _enrich(owner, [_out(d) async for d in cur])
    return {"items": items, "total": total, "page": page, "page_size": page_size, "today": day_str(today)}


@tasks_router.post("")
async def create_task(body: TaskInput, current=Depends(get_current_user)):
    owner = current["id"]
    title = _clean_text(body.title, 300)
    if not title:
        raise HTTPException(status_code=400, detail="Informe a descrição da tarefa.")
    status = _check_status(body.status)
    if status != "pendente" and not has(current, "tasks.complete"):
        raise FORBIDDEN("Você não tem permissão para alterar o status.")
    priority = _check_priority(body.priority)
    due_date, due_time = _valid_date(body.due_date), _valid_time(body.due_time)
    responsible_id, responsible_name = await _resolve_responsible(owner, body.responsible_id)
    bid_id, bid_label = await _resolve_bid(owner, body.bid_id)
    actor_id, actor_name = _actor(current)
    ts = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": owner,
        "title": title,
        "responsible_id": responsible_id,
        "responsible_name": responsible_name,
        "status": status,
        "done": 1 if status == DONE else 0,
        "priority": priority,
        "priority_rank": PRIORITY_RANK[priority],
        "due_date": due_date,
        "due_time": due_time,
        "due_key": f"{due_date}T{due_time}",
        "bid_id": bid_id,
        "bid_label": bid_label,
        "notes": _clean_text(body.notes, 4000),
        "completed_at": ts if status == DONE else None,
        "completed_date": day_str(sp_today()) if status == DONE else None,
        "created_by": actor_id, "created_by_name": actor_name, "created_at": ts,
        "updated_by": actor_id, "updated_by_name": actor_name, "updated_at": ts,
    }
    await db.tasks.insert_one(dict(doc))
    await audit(current, "tarefa_criada", module="tarefas", entity_type="tarefa", entity_id=doc["id"],
                entity_label=title[:80])
    return (await _enrich(owner, [_out(doc)]))[0]


_AUDIT_LABELS = {"title": "Descrição", "responsible_name": "Responsável", "status": "Status", "priority": "Prioridade",
                 "due_key": "Data final", "bid_label": "Licitação", "notes": "Observação"}


def _human(field: str, v):
    if v in (None, ""):
        return None
    if field == "status":
        return STATUSES.get(v, v)
    if field == "priority":
        return PRIORITIES.get(v, v)
    if field == "due_key":
        try:
            return datetime.strptime(v, "%Y-%m-%dT%H:%M").strftime("%d/%m/%Y %H:%M")
        except ValueError:
            return v
    return v


@tasks_router.put("/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, current=Depends(get_current_user)):
    owner = current["id"]
    before = await _get(owner, task_id)
    sent = body.model_dump(exclude_unset=True)
    # Segunda barreira (a primeira é a regra do PUT em permissions.py).
    if set(sent) & EDIT_FIELDS and not has(current, "tasks.edit"):
        raise FORBIDDEN("Você não tem permissão para editar tarefas.")
    if "status" in sent and sent["status"] != before.get("status") and not has(current, "tasks.complete"):
        raise FORBIDDEN("Você não tem permissão para alterar o status.")

    upd = {}
    if "title" in sent:
        title = _clean_text(sent["title"], 300)
        if not title:
            raise HTTPException(status_code=400, detail="Informe a descrição da tarefa.")
        upd["title"] = title
    # Responsável inativo já gravado continua valendo; só a TROCA exige um ativo.
    if "responsible_id" in sent and (sent["responsible_id"] or None) != before.get("responsible_id"):
        upd["responsible_id"], upd["responsible_name"] = await _resolve_responsible(owner, sent["responsible_id"])
    if "priority" in sent and sent["priority"] is not None:
        upd["priority"] = _check_priority(sent["priority"])
        upd["priority_rank"] = PRIORITY_RANK[upd["priority"]]
    if "due_date" in sent or "due_time" in sent:
        d = _valid_date(sent.get("due_date") or before.get("due_date"))
        t = _valid_time(sent.get("due_time") or before.get("due_time"))
        upd.update({"due_date": d, "due_time": t, "due_key": f"{d}T{t}"})
    if "bid_id" in sent and (sent["bid_id"] or None) != before.get("bid_id"):
        upd["bid_id"], upd["bid_label"] = await _resolve_bid(owner, sent["bid_id"])
    if "notes" in sent:
        upd["notes"] = _clean_text(sent["notes"], 4000)
    status_change = None
    if "status" in sent and sent["status"] is not None:
        st = _check_status(sent["status"])
        if st != before.get("status"):
            upd["status"] = st
            upd["done"] = 1 if st == DONE else 0
            if st == DONE:
                upd["completed_at"] = now_iso()
                upd["completed_date"] = day_str(sp_today())
                status_change = "tarefa_concluida"
            else:
                upd["completed_at"] = None
                upd["completed_date"] = None
                status_change = "tarefa_reaberta" if before.get("status") == DONE else "tarefa_status_alterado"

    if not upd:
        return (await _enrich(owner, [_out(before)]))[0]
    actor_id, actor_name = _actor(current)
    upd.update({"updated_by": actor_id, "updated_by_name": actor_name, "updated_at": now_iso()})
    await db.tasks.update_one({"id": task_id, "owner_id": owner}, {"$set": upd})
    after = {**before, **upd}

    changes = []
    for f, label in _AUDIT_LABELS.items():
        if f in upd and (before.get(f) or None) != (after.get(f) or None):
            changes.append({"field": f, "label": label, "before": _human(f, before.get(f)), "after": _human(f, after.get(f))})
    label = (after.get("title") or "")[:80]
    if status_change:
        await audit(current, status_change, module="tarefas", entity_type="tarefa", entity_id=task_id,
                    entity_label=label, changes=[c for c in changes if c["field"] == "status"])
    other = [c for c in changes if c["field"] != "status"]
    if other:
        fields = {c["field"] for c in other}
        action = ("tarefa_responsavel_alterado" if fields == {"responsible_name"} else
                  "tarefa_prazo_alterado" if fields == {"due_key"} else "tarefa_editada")
        await audit(current, action, module="tarefas", entity_type="tarefa", entity_id=task_id,
                    entity_label=label, changes=other)
    return (await _enrich(owner, [_out(after)]))[0]


@tasks_router.delete("/{task_id}")
async def delete_task(task_id: str, current=Depends(get_current_user)):
    owner = current["id"]
    doc = await _get(owner, task_id)
    await db.tasks.delete_one({"id": task_id, "owner_id": owner})
    await audit(current, "tarefa_excluida", module="tarefas", entity_type="tarefa", entity_id=task_id,
                entity_label=(doc.get("title") or "")[:80])
    return {"ok": True}


# ------------------------------------------------------------ boot
async def create_task_indexes():
    await db.tasks.create_index([("owner_id", 1), ("id", 1)], unique=True)
    await db.tasks.create_index([("owner_id", 1), ("due_date", 1), ("status", 1)])
    await db.tasks.create_index([("owner_id", 1), ("done", 1), ("due_key", 1), ("priority_rank", 1)])
    await db.task_responsibles.create_index([("owner_id", 1), ("id", 1)], unique=True)
    await db.task_responsibles.create_index([("owner_id", 1), ("active", 1), ("name", 1)])


async def migrate_task_responsibles() -> int:
    """Rodada 1 gravava o responsável como usuário interno (assignee_id/assignee_name).
    Converte para o cadastro próprio, SEM perder nomes: cada nome distinto vira um
    responsável ativo da mesma conta (reaproveita se já existir com o mesmo nome).
    Tarefa sem nome fica sem responsável. Idempotente (só toca quem tem assignee_*)."""
    n = 0
    cache = {}
    async for t in db.tasks.find({"$or": [{"assignee_id": {"$exists": True}}, {"assignee_name": {"$exists": True}}]}):
        owner = t["owner_id"]
        name = (t.get("assignee_name") or "").strip()
        rid = None
        if name and not t.get("responsible_id"):
            key = (owner, name.lower())
            rid = cache.get(key)
            if not rid:
                r = await db.task_responsibles.find_one(
                    {"owner_id": owner, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
                if r:
                    rid, name = r["id"], r["name"]
                else:
                    rid = str(uuid.uuid4())
                    await db.task_responsibles.insert_one({
                        "id": rid, "owner_id": owner, "name": name, "active": True,
                        "created_by": "migracao", "created_by_name": "Migração automática",
                        "created_at": now_iso(), "updated_at": now_iso()})
                cache[key] = rid
        sets = {"responsible_id": t.get("responsible_id") or rid,
                "responsible_name": t.get("responsible_name") or (name if rid else "")}
        await db.tasks.update_one({"_id": t["_id"]}, {"$set": sets, "$unset": {"assignee_id": "", "assignee_name": ""}})
        n += 1
    return n
