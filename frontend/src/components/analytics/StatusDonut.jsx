import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { categoryColor, pctLabel } from "@/lib/analytics";
import { EmptyState } from "@/components/analytics/Panel";

// Donut "Status das Licitações no Período" — uma fatia por CATEGORIA ANALÍTICA
// (configurável por status em Configurações). A classificação é feita no
// backend; aqui só se desenha. Ref 1: donut à esquerda, legenda à direita com
// a contagem alinhada à direita; os status ficam só no tooltip.
function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload || {};
  return (
    <div className="an-tooltip max-w-[13rem]">
      <p className="flex items-center gap-1.5 text-[11px] font-bold">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(d.category) }} />
        {d.category}
      </p>
      <p className="mt-0.5 text-[12px] font-bold">
        {d.count} {d.count === 1 ? "licitação" : "licitações"}
        <span className="ml-1.5 text-[10px] font-medium text-[var(--an-muted)]">{pctLabel(d.percent)}</span>
      </p>
      {!!d.statuses?.length && (
        <>
          <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wide text-[var(--an-muted)]">Status</p>
          <ul className="text-[10px]">
            {d.statuses.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

export function StatusDonut({ distribution, total }) {
  // Memorizado + sem animação: o Pie do Recharts reinicia a animação sempre que
  // a identidade do array muda, o que deixava o donut "piscando"/incompleto.
  const dados = useMemo(() => (distribution || []).filter((d) => d.count > 0), [distribution]);
  if (!dados.length) return <EmptyState />;

  return (
    <div className="flex min-w-0 flex-col items-center gap-3 sm:flex-row">
      <div className="relative h-[168px] w-[168px] shrink-0" data-testid="analytics-status-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={dados} dataKey="count" nameKey="category"
              innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none"
              isAnimationActive={false}
            >
              {dados.map((d) => <Cell key={d.category} fill={categoryColor(d.category)} />)}
            </Pie>
            {/* zIndex: o total central é um overlay absoluto depois do gráfico no DOM. */}
            <Tooltip content={<DonutTooltip />} wrapperStyle={{ zIndex: 20 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span data-testid="donut-total" className="text-[24px] font-extrabold leading-none text-[var(--an-text)]">
            {total ?? 0}
          </span>
          <span className="mt-0.5 text-[10px] text-[var(--an-muted)]">licitações</span>
        </div>
      </div>

      {/* Legenda: SOMENTE o nome da categoria (sem status entre parênteses). */}
      <ul className="w-full min-w-0 flex-1 space-y-1" data-testid="analytics-status-legend">
        {(distribution || []).map((d) => (
          <li key={d.category} className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(d.category) }} />
            <span title={d.category} className="min-w-0 flex-1 truncate text-[var(--an-label)]">{d.category}</span>
            <span className="shrink-0 font-bold text-[var(--an-text)]">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
