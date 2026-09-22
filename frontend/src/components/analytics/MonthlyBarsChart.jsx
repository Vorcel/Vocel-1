import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_INK, SERIES_COLORS, axisMoney, money } from "@/lib/analytics";
import { EmptyState } from "@/components/analytics/Panel";

// Gráfico principal (Ref 1): 4 séries por mês em DUAS escalas — quantidade à
// esquerda, valores à direita. Dados prontos de `monthly` (backend); aqui só
// formatação. Sempre 100% da largura do card (ResponsiveContainer).
const SERIES = [
  { key: "participated", name: "Licitações Participadas", color: SERIES_COLORS.participadas, axis: "qtd" },
  { key: "total_adjudicated", name: "Total Adjudicado", color: SERIES_COLORS.adjudicado, axis: "money" },
  { key: "committed_value", name: "Valor Empenhado", color: SERIES_COLORS.empenhado, axis: "money" },
  { key: "estimated_profit", name: "Lucro Estimado", color: SERIES_COLORS.lucro, axis: "money" },
];

const eixo = { fill: CHART_INK.axis, fontSize: 10 };
const eixoTitulo = { fill: CHART_INK.axis, fontSize: 9 };

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Passo "redondo" (1 / 2 / 2,5 / 5 × 10^n) para as marcas do eixo financeiro.
function passoRedondo(valor) {
  if (!(valor > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(valor));
  const r = valor / base;
  const mult = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return mult * base;
}

/**
 * Escalas com o ZERO NA MESMA ALTURA nos dois eixos.
 *
 * Sem isso, quando alguma série monetária é negativa (lucro no prejuízo), o eixo
 * da direita ganha domínio negativo e o "zero" dele sobe — as barras de dinheiro
 * ficavam flutuando enquanto as de quantidade continuavam na base (ver Ref 2).
 * A correção: os dois eixos usam o MESMO número de divisões acima e abaixo do
 * zero, então a linha de base é uma só para todas as barras.
 */
function escalasAlinhadas(monthly) {
  const qtds = monthly.map((m) => n(m.participated));
  const valores = monthly.flatMap((m) => [n(m.total_adjudicated), n(m.committed_value), n(m.estimated_profit)]);
  const maxQtd = Math.max(1, ...qtds);
  const maxValor = Math.max(1, ...valores);
  const minValor = Math.min(0, ...valores);

  // Quantidade: marcas sempre inteiras (no máximo ~5 acima do zero).
  const passoQtd = Math.max(1, Math.ceil(maxQtd / 5));
  const divisoes = Math.max(1, Math.ceil(maxQtd / passoQtd));
  const passoValor = passoRedondo(maxValor / divisoes);

  // Espaço abaixo do zero, em divisões. Um prejuízo pequeno perto do maior valor
  // (ex.: −R$ 227 contra R$ 640 mil) não merece uma divisão inteira — ganha só
  // uma folga para a barra aparecer; prejuízos relevantes ocupam divisões cheias.
  const fracaoNegativa = minValor < 0 ? Math.abs(minValor) / passoValor : 0;
  const divisoesAbaixo = fracaoNegativa === 0
    ? 0
    : fracaoNegativa < 0.9
      ? Math.max(fracaoNegativa * 1.25, 0.08)
      : Math.ceil(fracaoNegativa);
  const marcasAbaixo = Math.floor(divisoesAbaixo);   // só marcas em divisões inteiras

  const marcas = (passo, de, ate) => {
    const out = [];
    // `|| 0` normaliza o -0 de `0 * passo` (senão o eixo imprime "-0").
    for (let i = de; i <= ate; i++) out.push(i * passo || 0);
    return out;
  };

  return {
    // O domínio da quantidade acompanha a MESMA fração negativa para o zero bater,
    // mas as MARCAS mostradas continuam só as não-negativas (não existe "-1 licitação").
    dominioQtd: [-divisoesAbaixo * passoQtd, divisoes * passoQtd],
    marcasQtd: marcas(passoQtd, 0, divisoes),
    dominioValor: [-divisoesAbaixo * passoValor, divisoes * passoValor],
    marcasValor: marcas(passoValor, -marcasAbaixo, divisoes),
  };
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ponto = payload[0]?.payload || {};
  return (
    <div className="an-tooltip">
      <p className="mb-1 text-[11px] font-bold">{ponto.full_label || label}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--an-muted)]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          {s.name}:
          <strong className="text-[var(--an-text)]">
            {s.axis === "qtd" ? ponto[s.key] ?? 0 : money(ponto[s.key])}
          </strong>
        </p>
      ))}
    </div>
  );
}

export function MonthlyBarsChart({ monthly }) {
  const escalas = useMemo(() => escalasAlinhadas(monthly || []), [monthly]);
  if (!monthly?.length) return <EmptyState message="Sem meses no período selecionado." />;
  const semDados = monthly.every(
    (m) => !m.participated && !m.total_adjudicated && !m.committed_value && !m.estimated_profit
  );
  if (semDados) return <EmptyState />;

  return (
    <div className="h-[190px] w-full min-w-0" data-testid="analytics-bars-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={monthly} margin={{ top: 16, right: 4, left: 0, bottom: 0 }} barGap={1} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
          {/* A linha de base visível é o ZERO (não o fundo da área), para as barras
              negativas descerem a partir dela. */}
          <XAxis dataKey="label" tick={eixo} tickLine={false} axisLine={false} tickMargin={4} />
          <YAxis
            yAxisId="qtd" tick={eixo} tickLine={false} axisLine={false} width={38}
            domain={escalas.dominioQtd} ticks={escalas.marcasQtd} allowDecimals={false}
            label={{ value: "Quantidade de Licitações", angle: -90, position: "insideLeft", style: eixoTitulo }}
          />
          <YAxis
            yAxisId="money" orientation="right" tick={eixo} tickLine={false} axisLine={false} width={52}
            domain={escalas.dominioValor} ticks={escalas.marcasValor} tickFormatter={axisMoney}
            label={{ value: "Valor (R$)", angle: 90, position: "insideRight", style: eixoTitulo }}
          />
          <ReferenceLine yAxisId="qtd" y={0} stroke={CHART_INK.axis} strokeWidth={1} strokeOpacity={0.45} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART_INK.grid, opacity: 0.55 }} />
          {SERIES.map((s) => (
            <Bar
              key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.name} fill={s.color}
              radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}
            >
              {/* Rótulo sobre a barra, como na referência — oculto quando zero. */}
              <LabelList
                dataKey={s.key}
                position="top"
                style={{ fill: s.color, fontSize: 8.5, fontWeight: 700 }}
                formatter={(v) => (!v ? "" : s.axis === "qtd" ? String(v) : axisMoney(v))}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
