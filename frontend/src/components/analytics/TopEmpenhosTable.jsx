import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { stageColor } from "@/lib/execution";
import { hexToRgba } from "@/lib/constants";
import { fmtDate, money } from "@/lib/analytics";
import { EmptyState } from "@/components/analytics/Panel";

// Maiores Empenhos do Período: ranking por Valor Empenhado reconhecido
// (timeline >= "Empenho Recebido" + Data de referência no período).
// A lista já chega ordenada do backend — aqui só se corta o Top N.
// Larguras percentuais + `table-layout: fixed` (.an-table) + elipse: textos
// longos (órgão/objeto) nunca alargam a tabela nem a página.
const COLS = ["4%", "27%", "26%", "14%", "16%", "13%"];

// Badge de etapa compacto — mesma semântica de cor da Execução (`stageColor`).
const EtapaBadge = ({ etapa }) => (
  <span
    className="inline-block max-w-full truncate rounded-full px-1.5 py-[1px] text-[9px] font-bold"
    style={{ backgroundColor: hexToRgba(stageColor(etapa), 0.16), color: stageColor(etapa) }}
    title={etapa}
  >
    {etapa}
  </span>
);

const Linha = ({ item, i }) => (
  <tr data-testid={`top-bid-row-${i}`}>
    <td className="text-[var(--an-muted)]">{i + 1}</td>
    <td className="font-bold" title={item.orgao}>{item.orgao}</td>
    <td className="text-[var(--an-muted)]" title={item.objeto || "—"}>{item.objeto || "—"}</td>
    <td className="text-[var(--an-muted)]">{fmtDate(item.data_empenho)}</td>
    <td className="font-bold">{money(item.valor_empenhado)}</td>
    <td><EtapaBadge etapa={item.etapa} /></td>
  </tr>
);

const Cabecalho = () => (
  <>
    <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Órgão / Entidade</th>
        <th>Objeto</th>
        <th>Data do Empenho</th>
        <th>Valor Empenhado</th>
        <th>Etapa</th>
      </tr>
    </thead>
  </>
);

// `aberto`/`onAbrir` vêm da página: o gatilho "Ver todas" mora no cabeçalho do
// card (Ref 1), mas o modal continua aqui, junto da tabela que ele repete.
export function TopEmpenhosTable({ items = [], periodLabel, limit = 5, aberto = false, onAbrir }) {
  const setAberto = (v) => onAbrir?.(v);
  if (!items.length) return <EmptyState message="Nenhum empenho reconhecido neste período." />;

  return (
    <>
      <div className="min-w-0 overflow-x-auto">
        <table className="an-table min-w-[540px] lg:min-w-0" data-testid="analytics-top-bids">
          <Cabecalho />
          <tbody>{items.slice(0, limit).map((b, i) => <Linha key={`${b.bid_id}-${i}`} item={b} i={i} />)}</tbody>
        </table>
      </div>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="an-scope max-w-4xl" data-testid="top-bids-modal">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold text-[var(--an-text)]">Maiores Empenhos do Período</DialogTitle>
            <DialogDescription className="text-[11px]">
              {periodLabel} · {items.length} licitação(ões) com empenho reconhecido
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <table className="an-table min-w-[540px] sm:min-w-0">
              <Cabecalho />
              <tbody>{items.map((b, i) => <Linha key={`${b.bid_id}-modal-${i}`} item={b} i={i} />)}</tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
