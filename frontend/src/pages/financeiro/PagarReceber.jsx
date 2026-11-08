import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CalendarRange, CheckCircle2, ClipboardCheck, Hourglass, PieChart,
} from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/context/FinanceContext";
import { apiError, finApi, money, periodPresets, todaySP } from "@/lib/financeiro";
import { EntriesTable } from "@/components/financeiro/EntriesTable";
import { ExecutionUpdates, ReceivableQueue, useReceivableQueue } from "@/components/financeiro/ReceivableQueue";
import { EmptyState, FinSelect, KpiCard, PageHeader, Panel, TonePill } from "@/components/financeiro/ui";

function usePeriodSummary(type) {
  const { version } = useFinance();
  const today = todaySP();
  const presets = useMemo(() => periodPresets(today), [today]);
  const [key, setKey] = useState("mes");
  const p = presets.find((x) => x.key === key);
  const [data, setData] = useState(null);
  useEffect(() => {
    finApi.resumo({ type, date_from: p.from, date_to: p.to }).then(setData).catch((e) => toast.error(apiError(e)));
  }, [type, p.from, p.to, version]);
  const select = (
    <FinSelect value={key} onChange={(e) => setKey(e.target.value)} className="w-auto" data-testid={`fin-${type}-period`}>
      {presets.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </FinSelect>
  );
  return { data, period: p, select };
}

const cnt = (x, word = "lançamento") => `${x?.count ?? 0} ${word}${(x?.count ?? 0) === 1 ? "" : "s"}`;

export function Pagar() {
  const { data, period, select } = usePeriodSummary("pagar");
  return (
    <>
      <PageHeader icon={ArrowUpFromLine} title="Contas a Pagar" subtitle="Despesas, parcelas, recorrências e vencimentos." actions={select} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard testid="fin-pagar-aberto" icon={ArrowUpFromLine} tone="warning" highlight label="A pagar no período" value={money(data?.aberto_periodo?.cents)} sub={`${cnt(data?.aberto_periodo)} · ${period.label.toLowerCase()}`} />
        <KpiCard testid="fin-pagar-vencidas" icon={AlertTriangle} tone="danger" label="Vencidas" value={money(data?.vencidas?.cents)} sub={cnt(data?.vencidas)} />
        <KpiCard testid="fin-pagar-7d" icon={CalendarRange} tone="info" label="Próximos 7 dias" value={money(data?.proximos_7?.cents)} sub={cnt(data?.proximos_7)} />
        <KpiCard testid="fin-pagar-pagas" icon={CheckCircle2} tone="success" label="Pago no período" value={money(data?.realizado_periodo?.cents)}
          sub={`${cnt(data?.realizado_periodo, "pagamento")} · ${data?.parciais?.count ?? 0} parcialmente pago(s)`} />
      </div>
      <Panel className="mt-5" bodyClassName="pt-5"><EntriesTable type="pagar" pageKey="pagar" /></Panel>
      <CategoryBreakdown data={data} period={period} />
    </>
  );
}

function CategoryBreakdown({ data, period }) {
  const { byId } = useFinance();
  const rows = data?.por_categoria || [];
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return (
    <Panel className="mt-5" icon={PieChart} title="Despesas por categoria" subtitle={`Distribuição do total a pagar (${money(total)}) com vencimento ${period.label.toLowerCase()}.`} testid="fin-pagar-categorias">
      {rows.length ? (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {rows.map((r) => {
            const pct = total ? (r.cents / total) * 100 : 0;
            const cor = byId[r.category_id]?.cor || "var(--fin-muted)";
            return (
              <li key={r.category_id || "sem"}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium" style={{ color: "var(--fin-ink)" }}>{byId[r.category_id]?.nome || r.nome}</span>
                  <span className="font-mono-num shrink-0" style={{ color: "var(--fin-ink-2)" }}>{money(r.cents)} · {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--fin-muted-soft)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%`, background: cor }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState icon={PieChart} title="Sem despesas no período" />}
    </Panel>
  );
}

export function Receber() {
  const { data, period, select } = usePeriodSummary("receber");
  const queue = useReceivableQueue();
  const aguardando = queue.items.reduce((s, r) => s + r.amount_cents, 0);
  return (
    <>
      <PageHeader icon={ArrowDownToLine} title="Contas a Receber" subtitle="Recebíveis oficiais, aprovações da Execução e baixa de recebimentos." actions={select} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard testid="fin-receber-aberto" icon={ArrowDownToLine} tone="success" highlight label="A receber no período" value={money(data?.aberto_periodo?.cents)} sub={`${cnt(data?.aberto_periodo, "recebível")} · ${period.label.toLowerCase()}`} />
        <KpiCard testid="fin-receber-aguardando" icon={Hourglass} tone="warning" label="Aguardando aprovação" value={money(aguardando)} sub={`${queue.items.length} solicitação(ões) — fora do previsto`} />
        <KpiCard testid="fin-receber-recebido" icon={CheckCircle2} tone="success" label="Recebido no período" value={money(data?.realizado_periodo?.cents)}
          sub={`${cnt(data?.realizado_periodo, "recebimento")} · ${data?.parciais?.count ?? 0} parcialmente recebido(s)`} />
        <KpiCard testid="fin-receber-atraso" icon={AlertTriangle} tone="danger" label="Em atraso" value={money(data?.vencidas?.cents)} sub={cnt(data?.vencidas, "recebível")} />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel className="2xl:order-2" icon={ClipboardCheck} title="Fila de aprovação" testid="fin-receber-queue"
          subtitle="Solicitações da Execução & Pós-Venda. Ainda não são recebíveis."
          actions={queue.items.length > 0 && <TonePill tone="warning">{queue.items.length} pendente(s)</TonePill>}>
          <ExecutionUpdates updates={queue.updates} />
          <ReceivableQueue items={queue.items} loading={queue.loading} />
        </Panel>
        <Panel className="2xl:order-1" title="Recebíveis" subtitle="Somente recebíveis oficiais (aprovados ou lançados no Financeiro)." bodyClassName="pt-1">
          <EntriesTable type="receber" pageKey="receber" />
        </Panel>
      </div>
    </>
  );
}
