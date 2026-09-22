import { money, pctLabel } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/analytics/Panel";

// Resumo do Período: consome o MESMO dataset `monthly` dos gráficos.
// Nenhuma métrica é recalculada aqui (inclusive a Taxa de Sucesso).
// Cabeçalho fixo (sticky) enquanto a lista de meses rola dentro do card.
const COLS = ["14%", "13%", "12%", "17%", "17%", "12%", "15%"];

export function PeriodSummaryTable({ monthly = [] }) {
  if (!monthly.length) return <EmptyState message="Sem meses no período selecionado." />;
  return (
    <div className="max-h-[180px] min-w-0 overflow-auto">
      <table className="an-table min-w-[540px] lg:min-w-0" data-testid="analytics-period-summary">
        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th>Mês</th>
            <th className="!text-right">Participações</th>
            <th className="!text-right">Adjudicadas</th>
            <th className="!text-right">Total Adjudicado</th>
            <th className="!text-right">Valor Empenhado</th>
            <th className="!text-right">Taxa de Sucesso</th>
            <th className="!text-right">Lucro Estimado</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m) => (
            <tr key={`${m.year}-${m.month}`} data-testid={`summary-row-${m.year}-${m.month}`}>
              <td className="font-semibold" title={m.full_label}>{m.full_label}</td>
              <td className="text-right text-[var(--an-muted)]">{m.participated}</td>
              <td className="text-right text-[var(--an-muted)]">{m.adjudicated}</td>
              <td className="text-right text-[var(--an-muted)]">{money(m.total_adjudicated)}</td>
              <td className="text-right text-[var(--an-muted)]">{money(m.committed_value)}</td>
              <td className="text-right text-[var(--an-muted)]">{pctLabel(m.success_rate)}</td>
              <td className={cn("text-right font-bold", m.estimated_profit < 0 ? "text-[#E23D3D]" : "text-[var(--an-profit)]")}>
                {money(m.estimated_profit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
