import { PortalName } from "@/components/bids/PortalName";
import { money, pctLabel } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/analytics/Panel";

// Portais com Mais Licitações Ganhas (Ref 1, largura total).
// Portais DINÂMICOS (saem dos dados reais do período, incluindo "Sem portal").
// A coluna monetária é o Valor Adjudicado (status Adjudicado + data da disputa
// no período), não o Valor Empenhado.
const COLS = ["3%", "22%", "18%", "13%", "12%", "17%", "15%"];

// `todos` (ver todos os portais) é controlado pela página, porque o gatilho fica
// no cabeçalho do card (Ref 1).
export function PortalRanking({ portals = [], limit = 5, todos = false }) {
  if (!portals.length) return <EmptyState message="Nenhuma licitação no período." />;

  const maxGanhas = Math.max(...portals.map((p) => p.won), 1);
  const visiveis = todos ? portals : portals.slice(0, limit);

  return (
    <>
      <div className="min-w-0 overflow-x-auto">
      <table className="an-table min-w-[620px] lg:min-w-0" data-testid="analytics-portals">
        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Portal</th>
            <th aria-label="Desempenho" />
            <th className="!text-right">Licitações Ganhas</th>
            <th className="!text-right">Taxa de Sucesso</th>
            <th className="!text-right">Valor Adjudicado</th>
            <th className="!text-right">Lucro Estimado</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((p, i) => (
            <tr key={p.portal} data-testid={`portal-row-${i}`}>
              <td className="text-[var(--an-muted)]">{i + 1}</td>
              {/* Nome na cor configurada em Configurações → Portais (padrão do sistema). */}
              <td className="!overflow-visible"><PortalName portal={p.portal} className="text-[11px]" /></td>
              <td>
                <div className="h-[7px] w-full overflow-hidden rounded-full bg-[var(--an-track)]">
                  <div
                    className="h-full rounded-full bg-[var(--an-bar)] transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max((p.won / maxGanhas) * 100, p.won ? 8 : 0)}%` }}
                  />
                </div>
              </td>
              <td className="text-right font-bold">{p.won}</td>
              <td className="text-right text-[var(--an-muted)]" title={`${p.won} de ${p.participated} participada(s)`}>
                {pctLabel(p.success_rate)}
              </td>
              <td className="text-right text-[var(--an-muted)]">{money(p.valor_adjudicado)}</td>
              <td className={cn("text-right font-bold", p.lucro_estimado < 0 ? "text-[#E23D3D]" : "text-[var(--an-profit)]")}>
                {money(p.lucro_estimado)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
