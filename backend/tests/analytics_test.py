"""Testes da camada analítica (página Análises de Licitações).

Não dependem de banco nem de rede: `analytics.db` é substituído por um duplo em
memória que respeita os filtros usados pelo módulo (owner_id + range de datas).
Assim as REGRAS de negócio (participação por exceção, Total Adjudicado x Valor
Empenhado, Taxa de Sucesso, categorias, períodos comparados) ficam verificadas
sem tocar em dados reais.

Rodar:  backend/venv/Scripts/python.exe tests/analytics_test.py
(ou `pytest backend/tests/analytics_test.py -v` onde houver pytest)
"""
import asyncio
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import analytics as A  # noqa: E402

OWNER = "user-1"
OUTRO = "user-2"
CONSULTAS = []   # toda query recebida pelo duplo (usado no teste de isolamento)


# -------------------- duplo de banco em memória --------------------
def _match(doc, query):
    for campo, cond in (query or {}).items():
        valor = doc.get(campo)
        if isinstance(cond, dict):
            if "$gte" in cond and (valor is None or valor < cond["$gte"]):
                return False
            if "$lte" in cond and (valor is None or valor > cond["$lte"]):
                return False
            if "$in" in cond and valor not in cond["$in"]:
                return False
        elif valor != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, limite=None):
        return list(self.docs)

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Colecao:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        CONSULTAS.append(query or {})
        return _Cursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None):
        CONSULTAS.append(query or {})
        return next((d for d in self.docs if _match(d, query)), None)


class _Banco:
    def __init__(self, bids, executions, budgets, params):
        self.bids = _Colecao(bids)
        self.executions = _Colecao(executions)
        self.budgets = _Colecao(budgets)
        self.params = _Colecao(params)


# -------------------- massa de teste --------------------
STATUS_TODOS = [
    "Orçando", "Cadastrar", "Disputar", "Ganho", "Julgamento", "Adjudicado",
    "Encerrado", "Desclassificado", "Adiado", "Cancelado", "Perdido",
]

TIMELINE_EM = lambda idx: [  # noqa: E731 - timeline com a etapa `idx` em andamento
    {"step": i, "name": n,
     "status": "Concluído" if i < idx else "Em Andamento" if i == idx else "Pendente", "files": []}
    for i, n in enumerate(A.TIMELINE_STEPS)
]


def _massa():
    bids, budgets, execucoes = [], [], []

    def bid(_id, status, data, portal="Comprasnet", orgao="Ministério da Saúde",
            valor=0.0, lucro=0.0, owner=OWNER, objeto="Objeto", **extra):
        bids.append({"_id": _id, "owner_id": owner, "status": status, "data_disputa": data,
                     "portal": portal, "orgao": orgao, "objeto": objeto, "pregao": "90001/2026",
                     "uasg": "111222", **extra})
        budgets.append({"bid_id": _id, "owner_id": owner,
                        "summary": {"valor_total": valor, "custo_global": 0.0, "lucro_global": lucro}})

    # 11 licitações, uma por status, todas em 10/05/2026 (regra de participação).
    for i, st in enumerate(STATUS_TODOS):
        bid(f"b{i}", st, "2026-05-10", valor=1000.0, lucro=100.0)
    # A adjudicada do conjunto acima ("b5") é o caso do exemplo do enunciado:
    budgets[5]["summary"] = {"valor_total": 80000.0, "custo_global": 68000.0, "lucro_global": 12000.0}

    # Licitação com VÁRIOS LOTES: o orçamento já vem somado (1 bid = 1 licitação).
    bid("multi", "Adjudicado", "2026-05-20", valor=50000.0, lucro=5000.0, portal="BLL Compras")

    # Adjudicada sem portal e sem órgão (fallbacks analíticos).
    bid("semportal", "Adjudicado", "2026-06-01", portal="", orgao="", valor=7000.0, lucro=700.0)

    # Status inexistente/nulo -> Outros, sem quebrar.
    bid("semstatus", None, "2026-06-02", valor=0.0, lucro=0.0)

    # Status novo criado pelo usuário, ainda sem Categoria Analítica -> Outros.
    bid("novo", "Habilitação", "2026-06-03", valor=0.0, lucro=0.0)

    # Período ANTERIOR (2025) para a comparação YTD.
    bid("p1", "Adjudicado", "2025-05-10", valor=40000.0, lucro=6000.0)
    bid("p2", "Disputar", "2025-05-11")

    # Dados de OUTRO usuário, nas mesmas datas e com valores altos.
    bid("x1", "Adjudicado", "2026-05-10", valor=999999.0, lucro=999999.0, owner=OUTRO)

    # Execuções (Valor Empenhado):
    # 1) b5: etapa "Comprar Mercadoria" (posterior a Empenho Recebido) + data de
    #    referência 15/07 -> reconhece R$ 80.000 em JULHO.
    execucoes.append({"bid_id": "b5", "owner_id": OWNER, "objeto": "Objeto", "portal": "Comprasnet",
                      "orgao": "Ministério da Saúde", "current_step": 2, "timeline": TIMELINE_EM(2),
                      "data_referencia_entrega": "2026-07-15"})
    # 2) multi: ainda em "Aguardando Empenho" com data de referência -> NÃO conta.
    execucoes.append({"bid_id": "multi", "owner_id": OWNER, "objeto": "Objeto", "portal": "BLL Compras",
                      "orgao": "Prefeitura", "current_step": 0, "timeline": TIMELINE_EM(0),
                      "data_referencia_entrega": "2026-07-20"})
    # 3) semportal: "Entregue" (bem posterior) mas SEM data de referência -> NÃO conta.
    execucoes.append({"bid_id": "semportal", "owner_id": OWNER, "objeto": "Objeto", "portal": "",
                      "orgao": "", "current_step": 8, "timeline": TIMELINE_EM(8)})
    # 4) execução de OUTRO usuário, reconhecível e com valor alto.
    execucoes.append({"bid_id": "x1", "owner_id": OUTRO, "objeto": "Outro", "portal": "Comprasnet",
                      "orgao": "Outro órgão", "current_step": 5, "timeline": TIMELINE_EM(5),
                      "data_referencia_entrega": "2026-07-10"})

    params = [{
        "owner_id": OWNER,
        "statuses": [{"nome": s, "cor": "#000", "categoria": A.seed_category_for(s)} for s in STATUS_TODOS]
        # "Habilitação" NÃO está cadastrado com categoria — cai em Outros.
    }]
    return _Banco(bids, execucoes, budgets, params)


def _analytics(start=None, end=None, owner=OWNER):
    A.db = _massa()
    return asyncio.run(A.get_analytics(start=start, end=end, current={"id": owner}))


# -------------------- testes --------------------
def test_participacao_por_excecao():
    """Todos os status contam como participação, menos Adiado/Cancelado/Perdido."""
    d = _analytics("2026-05-01", "2026-05-31")
    # 11 status - 3 excluídos + a licitação multi-lote = 9
    assert d["summary"]["participated"] == 9, d["summary"]
    for st in STATUS_TODOS:
        esperado = st not in ("Adiado", "Cancelado", "Perdido")
        assert A.is_participation(st) is esperado, st
    assert A.is_participation("Status Novo Qualquer") is True   # regra por exceção


def test_adjudicadas_somente_status_adjudicado():
    d = _analytics("2026-05-01", "2026-05-31")
    assert d["summary"]["adjudicated"] == 2          # b5 + multi
    assert A.is_adjudicated("Adjudicado") is True
    assert A.is_adjudicated("Ganho") is False


def test_varios_lotes_contam_uma_licitacao():
    d = _analytics("2026-05-20", "2026-05-20")
    assert d["summary"]["participated"] == 1
    assert d["summary"]["adjudicated"] == 1
    assert d["summary"]["total_adjudicated"] == 50000.0


def test_taxa_de_sucesso():
    d = _analytics("2026-05-01", "2026-05-31")
    assert d["summary"]["success_rate"] == A.success_rate(2, 9) == 22.2
    assert A.success_rate(0, 0) == 0.0               # denominador zero


def test_total_adjudicado_usa_data_da_disputa():
    """Exemplo do enunciado: disputa 10/05 + Adjudicado + Empenho 80.000 -> Maio."""
    d = _analytics("2026-01-01", "2026-12-31")
    maio = next(m for m in d["monthly"] if m["month"] == 5)
    assert maio["total_adjudicated"] == 130000.0     # 80.000 (b5) + 50.000 (multi)
    assert maio["committed_value"] == 0.0            # nada reconhecido em maio


def test_valor_empenhado_exige_etapa_e_data_de_referencia():
    """Só conta com timeline >= Empenho Recebido E Data de referência preenchida;
    o valor é posicionado pela Data de referência (julho), não pela disputa."""
    d = _analytics("2026-01-01", "2026-12-31")
    julho = next(m for m in d["monthly"] if m["month"] == 7)
    assert julho["committed_value"] == 80000.0       # só b5
    assert julho["total_adjudicated"] == 0.0         # adjudicação foi em maio
    assert d["summary"]["committed_value"] == 80000.0
    # "multi" está em Aguardando Empenho (etapa 0) mesmo tendo data de referência
    # e "semportal" está em Entregue mas sem data de referência: nenhum entra.
    assert [b["bid_id"] for b in d["top_bids"]] == ["b5"]


def test_etapas_posteriores_contam_pela_ordem_real():
    for idx, nome in enumerate(A.TIMELINE_STEPS):
        reconhece = A.step_index({"current_step": idx, "timeline": TIMELINE_EM(idx)}) >= A.EMPENHO_STEP_INDEX
        assert reconhece is (idx >= 1), nome
    # etapas legadas e a etapa removida "Solicitar Atestado" continuam legíveis
    assert A.step_index({"current_step": 5, "timeline": [{"name": "Faturamento / NF"}]}) == A.TIMELINE_STEPS.index("Emitir NF")
    assert A.step_index({"current_step": 9, "timeline": [{"name": "Solicitar Atestado", "status": "Em Andamento"}]}) == A.TIMELINE_STEPS.index("Entregue")


def test_lucro_estimado_vem_do_orcamento():
    d = _analytics("2026-05-01", "2026-05-31")
    assert d["summary"]["estimated_profit"] == 17000.0   # 12.000 + 5.000, sem recálculo


def test_distribuicao_de_status_e_total_do_donut():
    d = _analytics("2026-01-01", "2026-12-31")
    por_cat = {c["category"]: c["count"] for c in d["status_distribution"]}
    assert por_cat["Preparação"] == 2                 # Orçando, Cadastrar
    assert por_cat["Em Julgamento"] == 3              # Disputar, Ganho, Julgamento
    assert por_cat["Vencidas"] == 3                   # b5, multi e semportal
    assert por_cat["Desclassificado"] == 1
    assert por_cat["Disputadas"] == 1                 # Encerrado
    assert por_cat["Fracassadas"] == 3                # Adiado, Cancelado, Perdido
    assert por_cat["Outros"] == 2                     # sem status + "Habilitação"
    # O donut inclui Adiado/Cancelado/Perdido: total != Licitações Participadas.
    assert d["status_total"] == 15                    # 15 licitações do usuário em 2026
    assert d["summary"]["participated"] == 12        # 15 - Adiado/Cancelado/Perdido
    # Legenda/tooltip: categoria + status encontrados (sem parênteses no nome).
    outros = next(c for c in d["status_distribution"] if c["category"] == "Outros")
    assert sorted(outros["statuses"]) == ["Habilitação", "Sem status"]


def test_portais_dinamicos_e_fallback():
    d = _analytics("2026-01-01", "2026-12-31")
    portais = {p["portal"]: p for p in d["portal_performance"]}
    assert "Sem portal" in portais                     # portal ausente não é descartado
    assert portais["BLL Compras"]["won"] == 1
    assert portais["BLL Compras"]["valor_adjudicado"] == 50000.0
    assert portais["Comprasnet"]["success_rate"] == A.success_rate(
        portais["Comprasnet"]["won"], portais["Comprasnet"]["participated"])
    # ordenação padrão: Licitações Ganhas DESC
    assert [p["won"] for p in d["portal_performance"]] == sorted(
        [p["won"] for p in d["portal_performance"]], reverse=True)


def test_orgao_ausente_tem_placeholder():
    d = _analytics("2026-01-01", "2026-12-31")
    assert all(b["orgao"] for b in d["top_bids"])
    assert A.SEM_ORGAO == "Órgão não informado"


def test_periodos_e_comparacao_equivalente():
    casos = [
        (("2025-01-01", "2025-12-31"), "2025", ("2024-01-01", "2024-12-31")),          # ano
        (("2026-07-01", "2026-09-30"), "3º trimestre/2026", ("2026-04-01", "2026-06-30")),  # trimestre
        (("2026-09-01", "2026-09-30"), "Setembro/2026", ("2026-08-01", "2026-08-31")),      # mês
        (("2026-07-01", "2026-09-30"), "3º trimestre/2026", ("2026-04-01", "2026-06-30")),  # 3 meses
        (("2026-01-01", "2026-10-31"), "Jan–Out/2026", ("2025-03-01", "2025-12-31")),       # 10 meses
        (("2026-01-01", "2026-09-21"), "2026 (até 21/09)", ("2025-01-01", "2025-09-21")),   # YTD
    ]
    for (ini, fim), rotulo, anterior in casos:
        d = _analytics(ini, fim)
        assert d["period"]["label"] == rotulo, (ini, fim, d["period"])
        assert (d["comparison_period"]["start"], d["comparison_period"]["end"]) == anterior, (ini, fim)


def test_variacao_e_sem_base_de_comparacao():
    d = _analytics("2026-01-01", "2026-09-21")            # vs. 2025 (até 21/09)
    assert d["comparison_period"]["label"] == "2025 (até 21/09)"
    # 2025 teve 1 adjudicada de 40.000; 2026 tem 4 adjudicadas somando 137.000.
    assert d["comparison"]["total_adjudicated"] == A.pct_change(
        d["summary"]["total_adjudicated"], d["comparison_summary"]["total_adjudicated"])
    # 2025 não teve empenho reconhecido -> sem base (nunca Infinity/NaN)
    assert d["comparison_summary"]["committed_value"] == 0
    assert d["comparison"]["committed_value"] is None
    assert A.pct_change(10, 0) is None and A.pct_change(0, 0) is None


def test_insights():
    d = _analytics("2026-01-01", "2026-12-31")
    i = d["insights"]
    assert i["best_month"]["month_label"] == "Julho"          # maior Valor Empenhado
    assert i["best_month"]["committed_value"] == 80000.0
    assert i["best_success_rate"]["success_rate"] == max(m["success_rate"] for m in d["monthly"])
    assert i["growth"]["current"] == 80000.0
    assert i["top_bid"]["orgao"] == "Ministério da Saúde"     # maior empenho individual
    assert i["top_bid"]["valor_empenhado"] == 80000.0


def test_periodo_sem_dados():
    d = _analytics("2020-01-01", "2020-03-31")
    s = d["summary"]
    assert (s["participated"], s["adjudicated"]) == (0, 0)
    assert s["total_adjudicated"] == s["committed_value"] == s["estimated_profit"] == 0
    assert s["success_rate"] == 0
    assert d["top_bids"] == [] and d["portal_performance"] == []
    assert d["status_total"] == 0
    assert all(c["percent"] == 0 for c in d["status_distribution"])
    assert d["insights"]["best_month"] is None and d["insights"]["top_bid"] is None
    assert len(d["monthly"]) == 3                             # jan, fev, mar


def test_isolamento_por_owner_id():
    CONSULTAS.clear()
    d = _analytics("2026-01-01", "2026-12-31", owner=OWNER)
    # nenhum valor do outro usuário (999.999) vaza para as métricas
    assert d["summary"]["total_adjudicated"] == 137000.0
    assert d["summary"]["committed_value"] == 80000.0
    assert all(b["bid_id"] != "x1" for b in d["top_bids"])
    # e toda consulta feita ao banco carrega o owner_id do usuário autenticado
    assert CONSULTAS and all(q.get("owner_id") == OWNER for q in CONSULTAS), CONSULTAS
    # o outro usuário vê só o que é dele
    outro = _analytics("2026-01-01", "2026-12-31", owner=OUTRO)
    assert outro["summary"]["adjudicated"] == 1
    assert outro["summary"]["total_adjudicated"] == 999999.0


def test_meses_do_periodo():
    assert len(_analytics("2026-01-01", "2026-12-31")["monthly"]) == 12
    assert len(_analytics("2026-01-01", "2026-09-21")["monthly"]) == 9   # YTD não cria meses futuros
    assert len(_analytics("2026-07-01", "2026-09-30")["monthly"]) == 3
    assert len(_analytics("2026-09-01", "2026-09-30")["monthly"]) == 1


def test_categoria_do_status_vence_o_nome():
    """A classificação vive no registro do status: renomear não muda a categoria."""
    banco = _massa()
    banco.params.docs[0]["statuses"] = [
        {"nome": "Ganho", "cor": "#000", "categoria": "Vencidas"},       # alterado pelo usuário
        {"nome": "Fase de Lances", "cor": "#000", "categoria": "Em Julgamento"},
    ]
    A.db = banco
    d = asyncio.run(A.get_analytics(start="2026-01-01", end="2026-12-31", current={"id": OWNER}))
    por_cat = {c["category"]: c["count"] for c in d["status_distribution"]}
    assert por_cat["Vencidas"] == 4           # 3 adjudicadas + "Ganho" reclassificado
    assert por_cat["Em Julgamento"] == 2      # Disputar e Julgamento (semente), sem "Ganho"


def test_seed_de_categorias():
    assert A.seed_category_for("Orçando") == "Preparação"
    assert A.seed_category_for("orcando") == "Preparação"      # sem acento
    assert A.seed_category_for("Adjudicado") == "Vencidas"
    assert A.seed_category_for("Encerrado") == "Disputadas"
    assert A.seed_category_for("Perdido") == "Fracassadas"
    assert A.seed_category_for("Habilitação") == "Outros"      # status novo


if __name__ == "__main__":
    testes = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    falhas = 0
    for t in testes:
        try:
            t()
            print(f"  ok   {t.__name__}")
        except AssertionError as e:
            falhas += 1
            print(f"  FALHA {t.__name__}: {e}")
    print(f"\n{len(testes) - falhas}/{len(testes)} testes passaram")
    sys.exit(1 if falhas else 0)
