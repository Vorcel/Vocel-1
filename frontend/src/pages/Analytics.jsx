import { useCallback, useEffect, useState } from "react";
import {
  Activity, BarChart3, Building2, Coins, FileText, Landmark, PieChart as PieIcon,
  RefreshCw, Trophy, TrendingUp, Wallet,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/analytics/KpiCard";
import { Panel, LegendDots, EmptyState } from "@/components/analytics/Panel";
import { PeriodPicker } from "@/components/analytics/PeriodPicker";
import { MonthlyBarsChart } from "@/components/analytics/MonthlyBarsChart";
import { ParticipationLineChart } from "@/components/analytics/ParticipationLineChart";
import { StatusDonut } from "@/components/analytics/StatusDonut";
import { TopEmpenhosTable } from "@/components/analytics/TopEmpenhosTable";
import { PeriodSummaryTable } from "@/components/analytics/PeriodSummaryTable";
import { InsightCards } from "@/components/analytics/InsightCards";
import { PortalRanking } from "@/components/analytics/PortalRanking";
import { PanelAction } from "@/components/analytics/PanelAction";
import { useData } from "@/context/DataContext";
import api, { formatApiError } from "@/lib/api";
import { LINE_COLORS, SERIES_COLORS, compactMoney, defaultPeriod } from "@/lib/analytics";

// Página Análises de Licitações (layout conforme referências/Ref 1.png).
// Toda métrica vem consolidada de GET /api/analytics (backend/analytics.py):
// a página pede um período e RENDERIZA — não baixa licitações para calcular.
// Tokens visuais: classe `an-scope` (definida em index.css).
export default function Analytics() {
  // O período NÃO é persistido (nem localStorage, nem preferências, nem banco):
  // toda carga da página recomeça em 1º/jan do ano corrente até hoje.
  const [period, setPeriod] = useState(() => defaultPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  // Estado só de apresentação (gatilhos que ficam no cabeçalho dos cards).
  const [verEmpenhos, setVerEmpenhos] = useState(false);
  const [verPortais, setVerPortais] = useState(false);
  // `bids`/`executions`/`lists` entram como dependência de propósito: alterações
  // feitas em Todas as Licitações, na Execução & Pós-Venda ou em Configurações →
  // Status (Categoria Analítica, "Exibir no gráfico") trocam esses objetos no
  // DataContext e revalidam as análises sem F5.
  const { bids, executions, lists } = useData();

  const carregar = useCallback(async (sinal) => {
    try {
      const { data: resposta } = await api.get("/analytics", {
        params: { start: period.start, end: period.end },
      });
      if (!sinal.cancelado) { setData(resposta); setErro(null); }
    } catch (e) {
      if (!sinal.cancelado) setErro(formatApiError(e.response?.data?.detail));
    } finally {
      if (!sinal.cancelado) setLoading(false);
    }
  }, [period.start, period.end]);

  useEffect(() => {
    const sinal = { cancelado: false };
    setLoading(true);
    // Pequeno atraso: agrupa rajadas (ex.: salvar uma etapa da timeline dispara
    // atualização de bids e executions quase juntas) em uma única consulta.
    const t = setTimeout(() => carregar(sinal), 150);
    return () => { sinal.cancelado = true; clearTimeout(t); };
  }, [carregar, bids, executions, lists]);

  const periodoLabel = data?.period?.label || "—";
  const compLabel = data?.comparison_period?.label || "—";
  const s = data?.summary || {};
  const c = data?.comparison || {};

  const kpis = [
    { testid: "kpi-participadas", icon: FileText, label: "Licitações Participadas", value: s.participated ?? 0, change: c.participated, tone: "participadas" },
    { testid: "kpi-adjudicadas", icon: Trophy, label: "Licitações Adjudicadas", value: s.adjudicated ?? 0, change: c.adjudicated, tone: "adjudicadas" },
    { testid: "kpi-total-adjudicado", icon: Coins, label: "Total Adjudicado", value: compactMoney(s.total_adjudicated), change: c.total_adjudicated, tone: "total" },
    { testid: "kpi-valor-empenhado", icon: Wallet, label: "Valor Empenhado", value: compactMoney(s.committed_value), change: c.committed_value, tone: "empenhado" },
    { testid: "kpi-lucro", icon: TrendingUp, label: "Lucro Estimado", value: compactMoney(s.estimated_profit), change: c.estimated_profit, tone: (s.estimated_profit ?? 0) < 0 ? "lucroNegativo" : "lucro" },
  ];

  // Título e seletor no cabeçalho do app (mesma barra das outras telas):
  // título azul-marinho à esquerda, período discreto à direita.
  const titulo = (
    <div className="min-w-0">
      <h1 className="truncate text-[clamp(19px,1.9vw,27px)] font-extrabold leading-[1.05] tracking-tight text-[var(--an-text)]">
        Análises de Licitações
      </h1>
      <p className="truncate text-[12px] leading-tight text-[var(--an-muted)]">
        Visão completa do seu desempenho em licitações ao longo do tempo.
      </p>
    </div>
  );

  const seletor = (
    <div className="flex min-w-0 items-center gap-2">
      {loading && data && <RefreshCw size={13} className="shrink-0 animate-spin text-[var(--an-muted)]" />}
      <PeriodPicker period={period} label={periodoLabel} onChange={setPeriod} bids={bids} />
    </div>
  );

  return (
    <div className="an-scope min-h-screen bg-[var(--an-bg)]">
      <Header leftContent={titulo} centerContent={seletor} />
      {/* w-full + min-w-0 em cada nível: nenhum bloco pode empurrar a largura
          da página (sem scroll horizontal global em desktop). */}
      <main className="w-full min-w-0 space-y-2.5 px-[18px] py-3" data-testid="analytics-page">
        {erro && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#F3B4B4] bg-[#FDECEC] px-3 py-2 text-[11px] text-[#B42318]">
            <span className="min-w-0">{erro}</span>
            <button
              data-testid="analytics-retry"
              onClick={() => { setLoading(true); carregar({ cancelado: false }); }}
              className="shrink-0 font-bold underline"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!data && loading ? (
          <AnalyticsSkeleton />
        ) : !data ? (
          <EmptyState message="Não foi possível carregar as análises." />
        ) : (
          <>
            {/* 5 KPIs — uma linha a partir de xl (1280px) */}
            <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {kpis.map((k) => <KpiCard key={k.testid} {...k} comparisonLabel={compLabel} />)}
            </div>

            {/* Gráfico principal (largura total) */}
            <Panel
              testid="panel-bars"
              icon={BarChart3}
              title="Licitações Participadas, Total Adjudicado, Valor Empenhado e Lucro por Mês"
              subtitle={`Comparativo mensal dos principais indicadores em ${periodoLabel}.`}
              right={
                <LegendDots
                  className="ml-auto"
                  items={[
                    { label: "Licitações Participadas", color: SERIES_COLORS.participadas },
                    { label: "Total Adjudicado (R$)", color: SERIES_COLORS.adjudicado },
                    { label: "Valor Empenhado (R$)", color: SERIES_COLORS.empenhado },
                    { label: "Lucro Estimado (R$)", color: SERIES_COLORS.lucro },
                  ]}
                />
              }
            >
              <MonthlyBarsChart monthly={data.monthly} />
            </Panel>

            {/* Linha + Donut — ~62% / 38% no desktop, mesma altura */}
            <div className="grid min-w-0 grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
              <Panel
                testid="panel-line"
                icon={Activity}
                title="Evolução de Participações e Taxa de Sucesso"
                subtitle={`Desempenho mês a mês em ${periodoLabel}.`}
                right={
                  <LegendDots
                    className="ml-auto"
                    items={[
                      { label: "Participações", color: LINE_COLORS.participacoes },
                      { label: "Taxa de Sucesso", color: LINE_COLORS.taxa },
                    ]}
                  />
                }
              >
                <ParticipationLineChart monthly={data.monthly} />
              </Panel>
              <Panel
                testid="panel-donut"
                icon={PieIcon}
                title="Status das Licitações no Período"
                subtitle="Distribuição por situação atual (configurável em Configurações)."
              >
                <StatusDonut distribution={data.status_distribution} total={data.status_total} />
              </Panel>
            </div>

            {/* Maiores Empenhos + Resumo do Período — 50/50 no desktop */}
            <div className="grid min-w-0 grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Panel
                testid="panel-top-bids"
                icon={TrendingUp}
                title="Maiores Empenhos do Período"
                subtitle={`Top 5 licitações com maior valor empenhado em ${periodoLabel}.`}
                right={data.top_bids.length > 5 && (
                  <PanelAction testid="top-bids-see-all" onClick={() => setVerEmpenhos(true)}>
                    Ver todas ({data.top_bids.length})
                  </PanelAction>
                )}
              >
                <TopEmpenhosTable
                  items={data.top_bids} periodLabel={periodoLabel}
                  aberto={verEmpenhos} onAbrir={setVerEmpenhos}
                />
              </Panel>
              <Panel
                testid="panel-summary"
                icon={Landmark}
                title="Resumo do Período"
                subtitle="Dados consolidados por mês."
              >
                <PeriodSummaryTable monthly={data.monthly} />
              </Panel>
            </div>

            {/* 4 insights */}
            <InsightCards insights={data.insights} />

            {/* Portais (largura total) */}
            <Panel
              testid="panel-portals"
              icon={Building2}
              title="Portais com Mais Licitações Ganhas"
              subtitle={`Desempenho por portal em ${periodoLabel}.`}
              right={data.portal_performance.length > 5 && (
                <PanelAction testid="portals-see-all" onClick={() => setVerPortais((v) => !v)}>
                  {verPortais ? "Ver menos" : `Ver todos os portais (${data.portal_performance.length})`}
                </PanelAction>
              )}
            >
              <PortalRanking portals={data.portal_performance} todos={verPortais} />
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}

// Esqueleto de carregamento no mesmo desenho da página (nada de undefined/NaN).
function AnalyticsSkeleton() {
  return (
    <div className="space-y-2.5" data-testid="analytics-skeleton">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[66px] rounded-[10px]" />)}
      </div>
      <Skeleton className="h-[250px] rounded-[10px]" />
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <Skeleton className="h-[240px] rounded-[10px]" />
        <Skeleton className="h-[240px] rounded-[10px]" />
      </div>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <Skeleton className="h-[210px] rounded-[10px]" />
        <Skeleton className="h-[210px] rounded-[10px]" />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-[10px]" />)}
      </div>
      <Skeleton className="h-[190px] rounded-[10px]" />
    </div>
  );
}
