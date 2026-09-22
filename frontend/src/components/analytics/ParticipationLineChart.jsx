import {
  CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_INK, LINE_COLORS, pctLabel } from "@/lib/analytics";
import { EmptyState } from "@/components/analytics/Panel";

// Evolução de Participações (quantidade) x Taxa de Sucesso (%) — Ref 1 / Ref 3.
// A taxa NÃO é recalculada aqui: vem de `monthly[].success_rate` (backend).
const eixo = { fill: CHART_INK.axis, fontSize: 10 };
const eixoTitulo = { fill: CHART_INK.axis, fontSize: 9 };
// Folga em pixels nas duas escalas: abre espaço para os rótulos acima do ponto
// mais alto e abaixo do ponto mais baixo (0% encostaria nos nomes dos meses).
const FOLGA = { top: 12, bottom: 15 };

// Rótulo de participações: número em azul ACIMA do ponto (Ref 3). Mês sem
// participação não ganha rótulo, para não poluir a linha no zero.
const RotuloParticipacoes = ({ x, y, value }) => {
  if (!value) return null;
  return (
    <text x={x} y={y - 7} textAnchor="middle" fill={LINE_COLORS.participacoes} fontSize={9.5} fontWeight={700}>
      {value}
    </text>
  );
};

// Rótulo da taxa: percentual em roxo ABAIXO do ponto (Ref 3). Aparece sempre que
// houve participação no mês — inclusive "0%", que é informação (participou e não
// ganhou). Sem participação, não há taxa para mostrar.
const rotuloTaxa = (monthly) => ({ x, y, index }) => {
  const m = monthly[index];
  if (!m?.participated) return null;
  // Texto montado em UMA string: `{n}%` em JSX vira dois nós de texto no SVG e
  // o navegador acaba desenhando só o "%".
  const texto = `${Math.round(m.success_rate || 0)}%`;
  return (
    <text x={x} y={y + 13} textAnchor="middle" fill={LINE_COLORS.taxa} fontSize={9.5} fontWeight={700}>
      {texto}
    </text>
  );
};

function LineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload || {};
  return (
    <div className="an-tooltip">
      <p className="mb-1 text-[11px] font-bold">{p.full_label}</p>
      <p className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--an-muted)]">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINE_COLORS.participacoes }} />
        Participações: <strong className="text-[var(--an-text)]">{p.participated ?? 0}</strong>
      </p>
      <p className="flex items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--an-muted)]">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LINE_COLORS.taxa }} />
        Taxa de Sucesso: <strong className="text-[var(--an-text)]">{pctLabel(p.success_rate)}</strong>
      </p>
      <p className="mt-1 text-[10px] text-[var(--an-muted)]">
        {p.adjudicated ?? 0} adjudicada(s) de {p.participated ?? 0} participada(s)
      </p>
    </div>
  );
}

export function ParticipationLineChart({ monthly }) {
  if (!monthly?.length) return <EmptyState message="Sem meses no período selecionado." />;
  if (monthly.every((m) => !m.participated)) return <EmptyState />;

  return (
    <div className="h-[180px] w-full min-w-0" data-testid="analytics-line-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={monthly} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
          <XAxis dataKey="label" tick={eixo} tickLine={false} axisLine={{ stroke: CHART_INK.grid }} tickMargin={4} />
          <YAxis
            yAxisId="qtd" tick={eixo} tickLine={false} axisLine={false} width={34} allowDecimals={false}
            padding={FOLGA}
            label={{ value: "Nº de participações", angle: -90, position: "insideLeft", style: eixoTitulo }}
          />
          <YAxis
            yAxisId="taxa" orientation="right" tick={eixo} tickLine={false} axisLine={false} width={40}
            domain={[0, 100]} tickFormatter={(v) => `${v}%`} padding={FOLGA}
            label={{ value: "Taxa de Sucesso", angle: 90, position: "insideRight", style: eixoTitulo }}
          />
          <Tooltip content={<LineTooltip />} />
          <Line
            yAxisId="qtd" type="monotone" dataKey="participated" name="Participações"
            stroke={LINE_COLORS.participacoes} strokeWidth={2} isAnimationActive={false}
            dot={{ r: 2.5, fill: LINE_COLORS.participacoes, strokeWidth: 0 }} activeDot={{ r: 4 }}
          >
            <LabelList dataKey="participated" content={RotuloParticipacoes} />
          </Line>
          <Line
            yAxisId="taxa" type="monotone" dataKey="success_rate" name="Taxa de Sucesso"
            stroke={LINE_COLORS.taxa} strokeWidth={2} isAnimationActive={false}
            dot={{ r: 2.5, fill: LINE_COLORS.taxa, strokeWidth: 0 }} activeDot={{ r: 4 }}
          >
            <LabelList dataKey="success_rate" content={rotuloTaxa(monthly)} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
