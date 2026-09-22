"""Camada analítica da página "Análises de Licitações" (fonte única das métricas).

Regras de negócio consolidadas AQUI — o frontend só renderiza o que este módulo
devolve. Nada é recalculado no navegador e nenhuma fórmula financeira do
Orçamento é reproduzida: os valores monetários vêm prontos do orçamento salvo
(`budgets.summary`), exatamente a mesma fonte que alimenta as colunas Empenho e
Lucro Previsto da Execução & Pós-Venda (ver `routes._enrich_execution`).

Isolamento: toda consulta filtra `owner_id` do usuário autenticado (nunca do
body/query) — ver multi-tenant em `routes.py`.

Sem banco analítico duplicado: tudo é derivado das coleções reais
(`bids`, `executions`, `budgets`, `params`) a cada requisição.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from auth import get_current_user
from routes import (
    ADJUDICATED_STATUS,
    ANALYTIC_CATEGORIES,
    DEFAULT_ANALYTIC_CATEGORY,
    LEGACY_ATESTADO_STEP,
    NON_PARTICIPATION_STATUSES,
    TIMELINE_STEPS,
    seed_category_for,
    uid,
)

analytics_router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Brasil não usa horário de verão desde 2019: offset fixo evita depender do
# pacote tzdata (ausente em algumas instalações Windows). As datas do sistema
# são strings YYYY-MM-DD (calendário puro), comparadas lexicograficamente —
# sem conversão de fuso em nenhum ponto.
BRT = timezone(timedelta(hours=-3))

# "Empenho Recebido" ou QUALQUER etapa posterior reconhece o Valor Empenhado.
EMPENHO_STEP_INDEX = TIMELINE_STEPS.index("Empenho Recebido")

# Nomes da timeline original (10 etapas) -> etapas atuais.
# Espelho de LEGACY_MAP em frontend/src/lib/execution.js (manter em sincronia).
LEGACY_STEP_MAP = {
    "Pedido de Compra": "Comprar Mercadoria",
    "Faturamento / NF": "Emitir NF",
    "Expedição": "Preparar para Transporte",
    "Concluído": "Pagamento Recebido",
}

MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
         "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
               "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

SEM_PORTAL = "Sem portal"
SEM_ORGAO = "Órgão não informado"


# =================== DATAS / PERÍODO ===================
def today_brt() -> date:
    return datetime.now(BRT).date()


def _parse(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Data inválida (use YYYY-MM-DD)")


def _last_day(year: int, month: int) -> int:
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return (nxt - timedelta(days=1)).day


def _add_months(d: date, months: int, clamp_to_end: bool = False) -> date:
    total = (d.year * 12 + (d.month - 1)) + months
    year, month = divmod(total, 12)
    month += 1
    day = _last_day(year, month) if clamp_to_end else min(d.day, _last_day(year, month))
    return date(year, month, day)


def _is_month_start(d: date) -> bool:
    return d.day == 1


def _is_month_end(d: date) -> bool:
    return d.day == _last_day(d.year, d.month)


def _month_span(start: date, end: date) -> int:
    """Quantidade de meses cobertos por um intervalo alinhado a meses."""
    return (end.year * 12 + end.month) - (start.year * 12 + start.month) + 1


def period_label(start: date, end: date) -> tuple:
    """Rótulo legível + tipo do período, derivados apenas das datas.
    Usado no título dos blocos e no texto "vs. <período anterior>"."""
    aligned = _is_month_start(start) and _is_month_end(end)
    if aligned:
        span = _month_span(start, end)
        if span == 12 and start.month == 1:
            return f"{start.year}", "year"
        if span == 3 and start.month in (1, 4, 7, 10) and start.year == end.year:
            return f"{(start.month - 1) // 3 + 1}º trimestre/{start.year}", "quarter"
        if span == 1:
            return f"{MESES[start.month - 1]}/{start.year}", "month"
        if start.year == end.year:
            return f"{MESES_ABREV[start.month - 1]}–{MESES_ABREV[end.month - 1]}/{start.year}", "range"
        return (f"{MESES_ABREV[start.month - 1]}/{start.year}–"
                f"{MESES_ABREV[end.month - 1]}/{end.year}"), "range"
    if start.month == 1 and start.day == 1 and start.year == end.year:
        return f"{start.year} (até {end.strftime('%d/%m')})", "ytd"
    return f"{start.strftime('%d/%m/%Y')} a {end.strftime('%d/%m/%Y')}", "custom"


def previous_period(start: date, end: date) -> tuple:
    """Período imediatamente anterior de MESMA duração.
    - alinhado a meses (ano/trimestre/mês/intervalo): recua a mesma quantidade de meses
      (2026 -> 2025; 3º tri/2026 -> 2º tri/2026; Jul–Set -> Abr–Jun);
    - ano corrente até hoje (YTD): mesmo intervalo do ano anterior (01/01–21/09);
    - qualquer outro intervalo: mesma quantidade de dias terminando na véspera."""
    if _is_month_start(start) and _is_month_end(end):
        span = _month_span(start, end)
        return _add_months(start, -span), _add_months(end, -span, clamp_to_end=True)
    if start.month == 1 and start.day == 1:
        prev_start = date(start.year - 1, 1, 1)
        day = min(end.day, _last_day(end.year - 1, end.month))
        return prev_start, date(end.year - 1, end.month, day)
    days = (end - start).days
    prev_end = start - timedelta(days=1)
    return prev_end - timedelta(days=days), prev_end


def months_of(start: date, end: date) -> list:
    """Meses (ano, mês) cobertos pelo período — base do dataset `monthly`.
    Nunca inclui meses futuros além do fim do período (YTD para no mês corrente)."""
    out = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


# =================== HELPERS DE NEGÓCIO ===================
def is_participation(status: Optional[str]) -> bool:
    """Regra por EXCEÇÃO: toda licitação participa, menos Adiado/Cancelado/Perdido.
    Status novos passam a contar automaticamente (sem lista fixa de válidos)."""
    return (status or "").strip().lower() not in NON_PARTICIPATION_STATUSES


def is_adjudicated(status: Optional[str]) -> bool:
    return (status or "").strip() == ADJUDICATED_STATUS


def success_rate(adjudicated: int, participated: int) -> float:
    """Taxa de Sucesso oficial — usada por card, gráfico, resumo, portal e insight."""
    if not participated:
        return 0.0
    return round((adjudicated / participated) * 100, 1)


def pct_change(current: float, previous: float):
    """Variação percentual. `None` quando não há base de comparação (anterior = 0),
    para o frontend exibir "Sem base de comparação" em vez de Infinity/NaN."""
    if not previous:
        return None
    return round(((current - previous) / previous) * 100, 1)


def step_index(execution: dict) -> int:
    """Índice da etapa mais avançada da timeline (mesma normalização do frontend:
    `normalizeTimeline` em lib/execution.js). Nomes legados são mapeados e a etapa
    removida "Solicitar Atestado" é lida como "Entregue"."""
    current = int(execution.get("current_step") or 0)
    idx = -1
    for i, node in enumerate(execution.get("timeline") or []):
        if not isinstance(node, dict):
            continue
        name = node.get("name")
        if name == LEGACY_ATESTADO_STEP:
            name = "Entregue"
        if name not in TIMELINE_STEPS:
            name = LEGACY_STEP_MAP.get(name)
        if not name:
            continue
        status = node.get("status") or ("Concluído" if i < current else "Em Andamento" if i == current else "Pendente")
        if status != "Pendente":
            idx = max(idx, TIMELINE_STEPS.index(name))
    return idx if idx >= 0 else min(max(current, 0), len(TIMELINE_STEPS) - 1)


def stage_name(execution: dict) -> str:
    return TIMELINE_STEPS[min(max(step_index(execution), 0), len(TIMELINE_STEPS) - 1)]


def _money(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _r(value: float) -> float:
    """Arredonda só na fronteira da API (apresentação), nunca durante as somas."""
    return round(float(value or 0), 2)


# =================== ENDPOINT ===================
@analytics_router.get("")
async def get_analytics(
    start: Optional[str] = Query(None, description="Início do período (YYYY-MM-DD)"),
    end: Optional[str] = Query(None, description="Fim do período, inclusivo (YYYY-MM-DD)"),
    current=Depends(get_current_user),
):
    """Dashboard analítico consolidado do período (e do período anterior equivalente).

    Padrão sem parâmetros: 1º de janeiro do ano corrente até hoje (YTD) — a
    seleção do usuário NÃO é persistida em lugar nenhum, então toda carga da
    página volta para cá."""
    owner = uid(current)
    hoje = today_brt()
    p_start = _parse(start) or date(hoje.year, 1, 1)
    p_end = _parse(end) or hoje
    if p_end < p_start:
        p_start, p_end = p_end, p_start
    c_start, c_end = previous_period(p_start, p_end)

    lo, hi = c_start.isoformat(), p_end.isoformat()
    label, ptype = period_label(p_start, p_end)
    c_label, _ = period_label(c_start, c_end)

    # --- Consultas (4 no total, sem N+1): período atual + anterior de uma vez ---
    bids = await db.bids.find(
        {"owner_id": owner, "data_disputa": {"$gte": lo, "$lte": hi}}
    ).to_list(20000)
    # Valor Empenhado é posicionado pela Data de referência do prazo de entrega;
    # o filtro de range já exclui execuções sem essa data (condição 2 da regra).
    execs = await db.executions.find(
        {"owner_id": owner, "data_referencia_entrega": {"$gte": lo, "$lte": hi}}
    ).to_list(20000)

    bid_ids = {str(b["_id"]) for b in bids} | {e.get("bid_id", "") for e in execs}
    bid_ids.discard("")
    summaries = {}
    if bid_ids:
        async for doc in db.budgets.find(
            {"owner_id": owner, "bid_id": {"$in": list(bid_ids)}}, {"bid_id": 1, "summary": 1}
        ):
            summaries[doc.get("bid_id")] = doc.get("summary") or {}

    # Configuração dos status (Configurações → Status) é a FONTE da classificação
    # do donut: categoria + o toggle "Exibir no gráfico de indicadores".
    params = await db.params.find_one({"owner_id": owner}) or {}
    categoria_de = {}
    oculto_no_grafico = set()
    for item in params.get("statuses", []) or []:
        if isinstance(item, dict) and item.get("nome"):
            cat = item.get("categoria")
            if cat not in ANALYTIC_CATEGORIES:
                cat = seed_category_for(item["nome"])
            categoria_de[item["nome"]] = cat
            if item.get("grafico") is False:
                oculto_no_grafico.add(item["nome"])

    def valores(bid_id: str) -> tuple:
        """Empenho e Lucro Previsto da licitação — MESMA fonte da Execução &
        Pós-Venda (soma dos lotes já salva em budgets.summary). Nada é recalculado."""
        s = summaries.get(bid_id) or {}
        return _money(s.get("valor_total")), _money(s.get("lucro_global"))

    # --- Registros normalizados ---
    lic = []
    for b in bids:
        bid_id = str(b["_id"])
        empenho, lucro = valores(bid_id)
        lic.append({
            "id": bid_id,
            "data": (b.get("data_disputa") or "")[:10],
            "status": b.get("status") or "",
            "portal": (b.get("portal") or "").strip() or SEM_PORTAL,
            "orgao": (b.get("orgao") or "").strip(),
            "objeto": b.get("objeto") or "",
            "pregao": b.get("pregao") or "",
            "uasg": b.get("uasg") or "",
            "empenho": empenho,
            "lucro": lucro,
            "participou": is_participation(b.get("status")),
            "adjudicada": is_adjudicated(b.get("status")),
        })

    # Valor Empenhado reconhecido: timeline >= "Empenho Recebido" E Data de
    # referência preenchida (garantida pela query). Uma execução = uma licitação.
    empenhos = []
    for e in execs:
        if step_index(e) < EMPENHO_STEP_INDEX:
            continue
        bid_id = e.get("bid_id", "")
        valor, _lucro = valores(bid_id)
        empenhos.append({
            "bid_id": bid_id,
            "data": (e.get("data_referencia_entrega") or "")[:10],
            "valor": valor,
            "orgao": (e.get("orgao") or "").strip(),
            "objeto": e.get("objeto") or "",
            "portal": (e.get("portal") or "").strip() or SEM_PORTAL,
            "etapa": stage_name(e),
        })

    def in_range(iso: str, s: date, t: date) -> bool:
        return bool(iso) and s.isoformat() <= iso <= t.isoformat()

    def summarize(s: date, t: date) -> dict:
        janela = [r for r in lic if in_range(r["data"], s, t)]
        participadas = [r for r in janela if r["participou"]]
        adjudicadas = [r for r in janela if r["adjudicada"]]
        empenhado = sum(r["valor"] for r in empenhos if in_range(r["data"], s, t))
        return {
            "participated": len(participadas),
            "adjudicated": len(adjudicadas),
            "total_adjudicated": _r(sum(r["empenho"] for r in adjudicadas)),
            "committed_value": _r(empenhado),
            "estimated_profit": _r(sum(r["lucro"] for r in adjudicadas)),
            "success_rate": success_rate(len(adjudicadas), len(participadas)),
        }

    summary = summarize(p_start, p_end)
    comparison_summary = summarize(c_start, c_end)
    comparison = {
        k: pct_change(summary[k], comparison_summary[k])
        for k in ("participated", "adjudicated", "total_adjudicated", "committed_value", "estimated_profit")
    }

    # --- Série mensal (base do gráfico de barras, da linha e do Resumo) ---
    monthly = []
    for y, m in months_of(p_start, p_end):
        ini = max(date(y, m, 1), p_start)
        fim = min(date(y, m, _last_day(y, m)), p_end)
        dados = summarize(ini, fim)
        monthly.append({
            "year": y,
            "month": m,
            "label": MESES_ABREV[m - 1],
            "full_label": f"{MESES[m - 1]}/{y}",
            **dados,
        })

    # --- Distribuição por Categoria Analítica (donut) ---
    periodo = [r for r in lic if in_range(r["data"], p_start, p_end)]
    por_categoria = {c: {"count": 0, "statuses": {}} for c in ANALYTIC_CATEGORIES}
    # O toggle "Exibir no gráfico de indicadores" vale SÓ para esta distribuição.
    # Nenhum KPI (participadas, adjudicadas, valores, taxa) é afetado por ele.
    periodo_grafico = [r for r in periodo if (r["status"] or "").strip() not in oculto_no_grafico]
    for r in periodo_grafico:
        nome = (r["status"] or "").strip()
        cat = categoria_de.get(nome) or (seed_category_for(nome) if nome else DEFAULT_ANALYTIC_CATEGORY)
        if cat not in por_categoria:
            cat = DEFAULT_ANALYTIC_CATEGORY
        por_categoria[cat]["count"] += 1
        chave = nome or "Sem status"
        por_categoria[cat]["statuses"][chave] = por_categoria[cat]["statuses"].get(chave, 0) + 1
    total_dist = len(periodo_grafico)
    configurados = {c: [] for c in ANALYTIC_CATEGORIES}
    for nome, cat in categoria_de.items():
        configurados.setdefault(cat, []).append(nome)
    status_distribution = [{
        "category": c,
        "count": por_categoria[c]["count"],
        "percent": round((por_categoria[c]["count"] / total_dist) * 100, 1) if total_dist else 0.0,
        # Status realmente encontrados no período; sem nenhum, mostra os configurados.
        "statuses": (sorted(por_categoria[c]["statuses"].keys()) or sorted(configurados.get(c, []))),
    } for c in ANALYTIC_CATEGORIES]

    # --- Maiores Empenhos do Período ---
    bid_por_id = {r["id"]: r for r in lic}
    ranking = sorted(
        [r for r in empenhos if in_range(r["data"], p_start, p_end)],
        key=lambda r: r["valor"], reverse=True,
    )
    top_bids = []
    for r in ranking[:100]:
        b = bid_por_id.get(r["bid_id"], {})
        top_bids.append({
            "bid_id": r["bid_id"],
            "orgao": r["orgao"] or b.get("orgao") or SEM_ORGAO,
            "objeto": r["objeto"] or b.get("objeto") or "",
            "pregao": b.get("pregao", ""),
            "uasg": b.get("uasg", ""),
            "portal": r["portal"],
            "data_empenho": r["data"],
            "valor_empenhado": _r(r["valor"]),
            "etapa": r["etapa"],
        })

    # --- Portais (dinâmicos: saem dos próprios dados, nada hardcodado) ---
    portais = {}
    for r in periodo:
        p = portais.setdefault(r["portal"], {"participadas": 0, "ganhas": 0, "valor": 0.0, "lucro": 0.0})
        if r["participou"]:
            p["participadas"] += 1
        if r["adjudicada"]:
            p["ganhas"] += 1
            p["valor"] += r["empenho"]
            p["lucro"] += r["lucro"]
    portal_performance = sorted(
        [{
            "portal": nome,
            "won": v["ganhas"],
            "participated": v["participadas"],
            "success_rate": success_rate(v["ganhas"], v["participadas"]),
            "valor_adjudicado": _r(v["valor"]),
            "lucro_estimado": _r(v["lucro"]),
        } for nome, v in portais.items()],
        key=lambda x: (x["won"], x["valor_adjudicado"]), reverse=True,
    )

    # --- Insights (derivados do MESMO dataset mensal / ranking) ---
    melhor_mes = max(monthly, key=lambda m: m["committed_value"], default=None)
    melhor_taxa = max(monthly, key=lambda m: (m["success_rate"], m["adjudicated"]), default=None)
    maior = top_bids[0] if top_bids else None
    insights = {
        "best_month": None if not melhor_mes or not melhor_mes["committed_value"] else {
            "label": melhor_mes["full_label"],
            "month_label": MESES[melhor_mes["month"] - 1],
            "committed_value": melhor_mes["committed_value"],
            "participated": melhor_mes["participated"],
        },
        "best_success_rate": None if not melhor_taxa or not melhor_taxa["participated"] else {
            "label": melhor_taxa["full_label"],
            "month_label": MESES[melhor_taxa["month"] - 1],
            "success_rate": melhor_taxa["success_rate"],
            "adjudicated": melhor_taxa["adjudicated"],
            "participated": melhor_taxa["participated"],
        },
        "growth": {
            "current": summary["committed_value"],
            "previous": comparison_summary["committed_value"],
            "change": comparison["committed_value"],
            "comparison_label": c_label,
        },
        "top_bid": None if not maior else {
            "orgao": maior["orgao"],
            "objeto": maior["objeto"],
            "valor_empenhado": maior["valor_empenhado"],
        },
    }

    return {
        "period": {"start": p_start.isoformat(), "end": p_end.isoformat(), "label": label, "type": ptype},
        "comparison_period": {"start": c_start.isoformat(), "end": c_end.isoformat(), "label": c_label},
        "summary": summary,
        "comparison": comparison,
        "comparison_summary": comparison_summary,
        "monthly": monthly,
        "status_distribution": status_distribution,
        "status_total": total_dist,
        "top_bids": top_bids,
        "portal_performance": portal_performance,
        "insights": insights,
    }
