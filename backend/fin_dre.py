"""DRE gerencial do Financeiro (Demonstração do Resultado do Exercício).

NÃO é fluxo de caixa: olha o RESULTADO econômico por COMPETÊNCIA, nunca saldo
bancário, data de pagamento ou saldo em aberto.

Regras:
- Base = `fin_entries` do usuário (owner_id), exceto cancelados. Solicitações da
  Execução ainda pendentes de aprovação não são lançamentos (`fin_requests`),
  então não entram.
- Valor = valor ECONÔMICO integral (`amount_cents`). Baixa parcial não muda a DRE.
- Data = `competence_date`; lançamento antigo sem ela usa o vencimento.
- Classificação = `dre_group_id` gravado no lançamento (derivado da categoria /
  subcategoria quando foi salvo). Sem grupo => "Não classificado na DRE",
  mostrado à parte e fora das linhas calculadas (nunca some em silêncio).
- Sinal: cada nó soma (A Receber) − (A Pagar). Grupo de despesa fica negativo,
  receita positiva; as linhas calculadas são só somas desses valores.
Agregação 100% no MongoDB; o frontend só recebe a árvore pronta."""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import get_current_user
from db import db
from fin_core import CANCELADO, RECEBER, in_transaction, log_event, parse_date, today_sp
from financeiro import _group_names, ensure_dre_defaults

dre_router = APIRouter(prefix="/api/fin/dre", tags=["financeiro-dre"])

# Estrutura FIXA (protegida): blocos de grupos por tipo e linhas calculadas.
# O usuário renomeia as linhas calculadas e organiza os grupos de cada bloco,
# mas não consegue lançar em linha calculada nem quebrar as fórmulas.
CALC_TITLES = {
    "receita_liquida": "Receita Líquida",
    "lucro_bruto": "Lucro Bruto",
    "resultado_operacional": "Resultado Operacional",
    "resultado_antes": "Resultado antes dos Tributos",
    "resultado_liquido": "Resultado Líquido",
}
LAYOUT = [
    ("tipo", "receita"), ("tipo", "deducao"), ("calc", "receita_liquida"),
    ("tipo", "custo"), ("calc", "lucro_bruto"),
    ("tipo", "despesa"), ("calc", "resultado_operacional"),
    ("tipo", "outra_receita"), ("tipo", "outra_despesa"), ("calc", "resultado_antes"),
    ("tipo", "tributo"), ("calc", "resultado_liquido"),
]
# Prefixo de leitura de cada bloco: (+) soma, (-) subtrai, (+/-) misto.
SINAL = {"receita": "+", "deducao": "-", "custo": "-", "despesa": "-", "outra_receita": "+/-",
         "outra_despesa": "+/-", "tributo": "-"}
NONE_KEY = "none"


def _owner(current: dict) -> str:
    return current["id"]


def _month_end(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def previous_period(start: str, end: str) -> tuple:
    """Período anterior equivalente: meses cheios voltam N meses; senão volta o mesmo nº de dias."""
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a.day == 1 and b == _month_end(b):
        n = (b.year - a.year) * 12 + b.month - a.month + 1
        y, m = a.year, a.month - n
        while m <= 0:
            m += 12
            y -= 1
        pa = date(y, m, 1)
        y2, m2 = b.year, b.month - n
        while m2 <= 0:
            m2 += 12
            y2 -= 1
        return pa.isoformat(), _month_end(date(y2, m2, 1)).isoformat()
    days = (b - a).days + 1
    return (a - timedelta(days=days)).isoformat(), (a - timedelta(days=1)).isoformat()


def _base_match(owner: str, start: str, end: str) -> list:
    return [
        {"$match": {"owner_id": owner, "status": {"$ne": CANCELADO}}},
        {"$addFields": {"_comp": {"$ifNull": ["$competence_date", "$due_date"]}}},
        {"$match": {"_comp": {"$gte": start, "$lte": end}}},
    ]


NET = {"$cond": [{"$eq": ["$type", RECEBER]}, "$amount_cents", {"$multiply": ["$amount_cents", -1]}]}


async def _aggregate(owner: str, start: str, end: str) -> dict:
    """{(grupo, categoria, subcategoria): {net, n, cat_name, sub_name}} — uma ida ao banco."""
    pipe = _base_match(owner, start, end) + [
        {"$group": {"_id": {"g": "$dre_group_id", "c": "$category_id", "s": "$subcategory_id"},
                    "net": {"$sum": NET}, "n": {"$sum": 1},
                    "cat_name": {"$last": "$category_name"}, "sub_name": {"$last": "$subcategory_name"}}},
    ]
    out = {}
    async for r in db.fin_entries.aggregate(pipe):
        k = (r["_id"].get("g"), r["_id"].get("c"), r["_id"].get("s"))
        out[k] = {"net": int(r["net"]), "n": r["n"], "cat_name": r.get("cat_name"), "sub_name": r.get("sub_name")}
    return out


def _tree(rows: dict, prev: Optional[dict], names: dict) -> dict:
    """grupo -> categoria -> subcategoria, com valor atual e anterior."""
    groups: dict = {}

    def bucket(src, key, field):
        g, c, s = key
        gk, ck, sk = g or NONE_KEY, c or NONE_KEY, s or NONE_KEY
        gn = groups.setdefault(gk, {"value": 0, "prev": 0, "count": 0, "cats": {}})
        cn = gn["cats"].setdefault(ck, {"value": 0, "prev": 0, "count": 0, "subs": {},
                                        "label": names.get(c) or src[key]["cat_name"] or "Sem categoria"})
        sn = cn["subs"].setdefault(sk, {"value": 0, "prev": 0, "count": 0,
                                        "label": names.get(s) or src[key]["sub_name"] or "Sem subcategoria"})
        v = src[key]["net"]
        for node in (gn, cn, sn):
            node[field] += v
            if field == "value":
                node["count"] += src[key]["n"]

    for k in rows:
        bucket(rows, k, "value")
    for k in (prev or {}):
        bucket(prev, k, "prev")
    return groups


def _children(cats: dict, with_prev: bool) -> list:
    out = []
    for ck, c in sorted(cats.items(), key=lambda kv: -abs(kv[1]["value"] or kv[1]["prev"])):
        subs = [{"key": sk, "label": s["label"], "value": s["value"], "count": s["count"],
                 **({"prev": s["prev"]} if with_prev else {})}
                for sk, s in sorted(c["subs"].items(), key=lambda kv: (kv[0] == NONE_KEY, -abs(kv[1]["value"] or kv[1]["prev"])))]
        # Categoria só com "sem subcategoria": expande direto nos lançamentos.
        if len(subs) == 1 and subs[0]["key"] == NONE_KEY:
            subs = []
        out.append({"key": ck, "label": c["label"], "value": c["value"], "count": c["count"], "children": subs,
                    **({"prev": c["prev"]} if with_prev else {})})
    return out


@dre_router.get("")
async def dre(date_from: str, date_to: str, compare: bool = False, current=Depends(get_current_user)):
    owner = _owner(current)
    await ensure_dre_defaults(owner)
    start, end = parse_date(date_from), parse_date(date_to)
    if start > end:
        raise HTTPException(status_code=400, detail="Período inválido.")
    pstart = pend = None
    if compare:
        pstart, pend = previous_period(start, end)
    grupos = await db.fin_cadastros.find({"owner_id": owner, "kind": "dre_grupo"}).sort([("ordem", 1), ("created_at", 1)]).to_list(500)
    cad_names = {c["id"]: c["nome"] async for c in db.fin_cadastros.find(
        {"owner_id": owner, "kind": {"$in": ["categoria", "subcategoria"]}}, {"id": 1, "nome": 1})}
    rows = await _aggregate(owner, start, end)
    prev = await _aggregate(owner, pstart, pend) if compare else None
    tree = _tree(rows, prev, cad_names)
    cfg = await db.fin_settings.find_one({"owner_id": owner}, {"dre_titles": 1}) or {}
    titles = {**CALC_TITLES, **(cfg.get("dre_titles") or {})}
    known = {g["id"] for g in grupos}

    lines, acc, acc_prev = [], 0, 0
    totals, totals_prev = {}, {}
    for kind, key in LAYOUT:
        if kind == "calc":
            totals[key], totals_prev[key] = acc, acc_prev
            lines.append({"kind": "calc", "key": key, "label": titles[key], "value": acc,
                          **({"prev": acc_prev} if compare else {})})
            continue
        for g in (x for x in grupos if x.get("tipo") == key):
            node = tree.get(g["id"], {"value": 0, "prev": 0, "count": 0, "cats": {}})
            # Grupo inativo só aparece se ainda tiver valor no período (histórico).
            if g.get("ativo") is False and not node["value"] and not node["prev"]:
                continue
            acc += node["value"]
            acc_prev += node["prev"]
            lines.append({"kind": "group", "key": g["id"], "label": g["nome"], "tipo": key, "sinal": SINAL[key],
                          "ativo": g.get("ativo", True), "value": node["value"], "count": node["count"],
                          "children": _children(node["cats"], compare), **({"prev": node["prev"]} if compare else {})})

    # Não classificados: sem grupo (ou grupo apagado). Fora das linhas calculadas.
    unc = {"value": 0, "prev": 0, "count": 0, "cats": {}}
    for gk, node in tree.items():
        if gk == NONE_KEY or gk not in known:
            unc["value"] += node["value"]
            unc["prev"] += node["prev"]
            unc["count"] += node["count"]
            for ck, c in node["cats"].items():
                dst = unc["cats"].setdefault(ck, {"value": 0, "prev": 0, "count": 0, "subs": {}, "label": c["label"]})
                for f in ("value", "prev", "count"):
                    dst[f] += c[f]
                for sk, sv in c["subs"].items():
                    ds = dst["subs"].setdefault(sk, {"value": 0, "prev": 0, "count": 0, "label": sv["label"]})
                    for f in ("value", "prev", "count"):
                        ds[f] += sv[f]
    classificaveis = await _count_classifiable(owner)
    return {
        "period": {"from": start, "to": end},
        "compare_period": {"from": pstart, "to": pend} if compare else None,
        "lines": lines,
        "totals": totals, "totals_prev": totals_prev if compare else None,
        "unclassified": {"value": unc["value"], "count": unc["count"], "children": _children(unc["cats"], compare),
                         "classificaveis": classificaveis, **({"prev": unc["prev"]} if compare else {})},
        "titles": titles,
    }


@dre_router.get("/lancamentos")
async def dre_entries(date_from: str, date_to: str, group: str, category: Optional[str] = None,
                      subcategory: Optional[str] = None, limit: int = Query(300, ge=1, le=1000),
                      current=Depends(get_current_user)):
    """Último nível da DRE: os lançamentos de um grupo/categoria/subcategoria
    ("none" = sem grupo / sem categoria / sem subcategoria)."""
    owner = _owner(current)
    start, end = parse_date(date_from), parse_date(date_to)
    match: dict = {}
    if group == NONE_KEY:
        known = [g["id"] async for g in db.fin_cadastros.find({"owner_id": owner, "kind": "dre_grupo"}, {"id": 1})]
        match["$or"] = [{"dre_group_id": None}, {"dre_group_id": {"$nin": known}}]
    else:
        match["dre_group_id"] = group
    if category is not None:
        match["category_id"] = None if category == NONE_KEY else category
    if subcategory is not None:
        match["subcategory_id"] = None if subcategory == NONE_KEY else subcategory
    pipe = _base_match(owner, start, end) + [{"$match": match}, {"$sort": {"_comp": 1, "created_at": 1}}, {"$limit": limit},
                                              {"$project": {"_id": 0, "id": 1, "description": 1, "type": 1, "amount_cents": 1,
                                                            "_comp": 1, "due_date": 1, "status": 1, "client_supplier": 1,
                                                            "sequence_index": 1, "sequence_total": 1}}]
    items = []
    async for e in db.fin_entries.aggregate(pipe):
        e["competence_date"] = e.pop("_comp")
        e["net_cents"] = e["amount_cents"] if e["type"] == RECEBER else -e["amount_cents"]
        items.append(e)
    return {"items": items, "limit": limit}


async def _classifiable_targets(owner: str) -> list:
    """(filtro, grupo) para lançamentos SEM grupo cuja categoria/subcategoria já tem grupo DRE."""
    names = await _group_names(owner)
    cats = {c["id"]: c async for c in db.fin_cadastros.find({"owner_id": owner, "kind": "categoria"})}
    subs = [s async for s in db.fin_cadastros.find({"owner_id": owner, "kind": "subcategoria"})]
    sem_grupo = {"$or": [{"dre_group_id": None}, {"dre_group_id": {"$nin": list(names)}}]}
    out = []
    overrides_by_cat: dict = {}
    for sub in subs:
        if sub.get("herda_grupo") is False:
            overrides_by_cat.setdefault(sub.get("categoria_id"), []).append(sub["id"])
            gid = sub.get("dre_grupo_id")
            if gid in names:
                out.append(({"owner_id": owner, "subcategory_id": sub["id"], **sem_grupo}, gid, names[gid]))
    for cid, c in cats.items():
        gid = c.get("dre_grupo_id")
        if gid in names:
            out.append(({"owner_id": owner, "category_id": cid, "subcategory_id": {"$nin": overrides_by_cat.get(cid, [])},
                         **sem_grupo}, gid, names[gid]))
    return out


async def _count_classifiable(owner: str) -> int:
    n = 0
    for flt, _, _ in await _classifiable_targets(owner):
        n += await db.fin_entries.count_documents({**flt, "status": {"$ne": CANCELADO}})
    return n


@dre_router.post("/classificar-pendentes")
async def classify_pending(current=Depends(get_current_user)):
    """Aplica a estrutura ATUAL aos lançamentos ainda sem grupo DRE (ação
    explícita do usuário, registrada no histórico). Lançamentos já
    classificados nunca são tocados aqui."""
    owner = _owner(current)
    targets = await _classifiable_targets(owner)
    done = {"n": 0}

    async def tx(s):
        for flt, gid, gname in targets:
            r = await db.fin_entries.update_many(flt, {"$set": {"dre_group_id": gid, "dre_group_name": gname}}, session=s)
            done["n"] += r.modified_count
        if done["n"]:
            await log_event(current, "dre_reclassificado", module="dre", entity_type="dre", entity_id="pendentes",
                            entity_label="Lançamentos sem classificação", metadata={"lancamentos": done["n"], "origem": "pendentes"},
                            session=s)
    await in_transaction(tx)
    return {"classificados": done["n"]}


class TitlesInput(BaseModel):
    titles: dict


@dre_router.put("/titulos")
async def update_titles(body: TitlesInput, current=Depends(get_current_user)):
    """Renomeia as linhas calculadas (a fórmula não muda)."""
    owner = _owner(current)
    cfg = await db.fin_settings.find_one({"owner_id": owner}, {"dre_titles": 1}) or {}
    before = {**CALC_TITLES, **(cfg.get("dre_titles") or {})}
    novos = {}
    for k, v in (body.titles or {}).items():
        if k not in CALC_TITLES:
            raise HTTPException(status_code=400, detail="Linha calculada inválida.")
        v = (v or "").strip()[:60]
        novos[k] = v or CALC_TITLES[k]
    after = {**before, **novos}
    changes = [{"field": k, "label": CALC_TITLES[k], "before": before[k], "after": after[k]} for k in novos if before[k] != after[k]]
    if not changes:
        return {"titles": after}

    async def tx(s):
        await db.fin_settings.update_one({"owner_id": owner}, {"$set": {"dre_titles": after}}, upsert=True, session=s)
        await log_event(current, "dre_estrutura_editada", module="dre", entity_type="dre", entity_id="titulos",
                        entity_label="Linhas calculadas da DRE", changes=changes, session=s)
    await in_transaction(tx)
    return {"titles": after}


@dre_router.get("/titulos")
async def get_titles(current=Depends(get_current_user)):
    cfg = await db.fin_settings.find_one({"owner_id": _owner(current)}, {"dre_titles": 1}) or {}
    return {"titles": {**CALC_TITLES, **(cfg.get("dre_titles") or {})}, "defaults": CALC_TITLES, "layout": LAYOUT}
