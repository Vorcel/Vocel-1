import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpFromLine, ChartColumnIncreasing, ClipboardCheck, LayoutDashboard, ListOrdered, Scale } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/context/FinanceContext";
import { useData } from "@/context/DataContext";
import { apiError, finApi, money, periodPresets, todaySP } from "@/lib/financeiro";
import { CashFlowChart, DeficitAlert } from "@/components/financeiro/CashFlowChart";
import { EntriesTable } from "@/components/financeiro/EntriesTable";
import { ExecutionUpdates, ReceivableQueue, useReceivableQueue } from "@/components/financeiro/ReceivableQueue";
import { FinButton, FinSelect, KpiCard, PageHeader, Panel, TonePill } from "@/components/financeiro/ui";

// Página inicial do Financeiro = centro operacional, nesta ordem fixa:
//   1. Cards  2. Tabela COMPLETA de lançamentos (o mesmo EntriesTable de
//   A Pagar / A Receber)  3. Fluxo Previsto (Ref10) + fila de aprovação.
// Os valores dos cards são SALDO EM ABERTO (baixas parciais não contam de novo).
export default function Overview() {
  const { version } = useFinance();
  const { prefs } = useData();
  const navigate = useNavigate();
  const today = todaySP();
  const presets = useMemo(() => periodPresets(today), [today]);
  const [periodKey, setPeriodKey] = useState("mes");   // nunca persistido
  const [months, setMonths] = useState(6);
  const [ov, setOv] = useState(null);
  const [flow, setFlow] = useState(null);
  const queue = useReceivableQueue();
  const period = presets.find((p) => p.key === periodKey);

  useEffect(() => {
    finApi.visaoGeral({ date_from: period.from, date_to: period.to }).then(setOv).catch((e) => toast.error(apiError(e)));
  }, [period.from, period.to, version]);
  useEffect(() => {
    finApi.fluxo({ granularity: "mes", periods: months }).then(setFlow).catch((e) => toast.error(apiError(e)));
  }, [months, version]);

  const minimo = prefs?.financeiro?.caixa_minimo_cents || 0;
  const venc = ov?.vencidas || {};
  return (
    <>
      <PageHeader icon={LayoutDashboard} title="Financeiro" subtitle="Gestão de contas, recebimentos, pagamentos e fluxo de caixa."
        actions={(
          <FinSelect value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className="w-auto" data-testid="fin-overview-period">
            {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </FinSelect>
        )} />

      {/* 1 — Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="fin-overview-cards">
        <KpiCard testid="fin-kpi-receber" icon={ArrowDownToLine} tone="success" highlight label="A Receber no Período"
          value={money(ov?.a_receber_cents)} sub={`${ov?.a_receber_count ?? 0} lançamento(s) · ${period.label.toLowerCase()}`}
          onClick={() => navigate("/financeiro/receber")} />
        <KpiCard testid="fin-kpi-pagar" icon={ArrowUpFromLine} tone="warning" label="A Pagar no Período"
          value={money(ov?.a_pagar_cents)} sub={`${ov?.a_pagar_count ?? 0} lançamento(s) · ${period.label.toLowerCase()}`}
          onClick={() => navigate("/financeiro/pagar")} />
        <KpiCard testid="fin-kpi-saldo" icon={Scale} tone={(ov?.saldo_previsto_cents ?? 0) < 0 ? "danger" : "info"} label="Saldo Previsto"
          value={money(ov?.saldo_previsto_cents)} sub="A receber − a pagar no período" />
        <KpiCard testid="fin-kpi-vencidas" icon={AlertTriangle} tone="danger" label="Vencidas"
          value={money((venc.receber_cents || 0) + (venc.pagar_cents || 0))}
          sub={`${venc.pagar_count || 0} a pagar · ${venc.receber_count || 0} a receber`} />
      </div>

      {/* 2 — Lançamentos (tabela completa) */}
      <Panel className="mt-5" icon={ListOrdered} title="Lançamentos" testid="fin-overview-entries"
        subtitle="Contas a pagar e a receber, parcelas e recorrências.">
        <EntriesTable pageKey="lancamentos" />
      </Panel>

      {/* 3 — Fluxo Previsto (Ref10) + fila de aprovação ao lado */}
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel icon={ChartColumnIncreasing} title="Fluxo Previsto" testid="fin-overview-flow"
          subtitle={flow ? `Parte do saldo atual dos bancos (${money(flow.saldo_atual_cents)}) e acumula o que entra e sai em cada mês.` : "Carregando…"}
          actions={(
            <FinSelect value={months} onChange={(e) => setMonths(Number(e.target.value))} className="h-9 w-auto" data-testid="fin-overview-months">
              {[3, 6, 12].map((m) => <option key={m} value={m}>{`Próximos ${m} meses`}</option>)}
            </FinSelect>
          )}>
          <DeficitAlert periodos={flow?.periodos} />
          <div className="mt-2"><CashFlowChart periodos={flow?.periodos} minimo={minimo} /></div>
        </Panel>

        <Panel icon={ClipboardCheck} title="Recebíveis pendentes de aprovação" testid="fin-overview-queue"
          subtitle="Enviados pela Execução & Pós-Venda. Só entram em A Receber e no fluxo depois de aprovados."
          actions={queue.items.length > 0 && <TonePill tone="warning">{queue.items.length} pendente(s)</TonePill>}>
          <ExecutionUpdates updates={queue.updates.slice(0, 2)} />
          <ReceivableQueue items={queue.items} loading={queue.loading} limit={5} compact />
          {(queue.items.length > 5 || queue.updates.length > 2) && (
            <FinButton variant="ghost" className="mt-1 w-full" onClick={() => navigate("/financeiro/receber")}>Ver todas <ArrowRight size={15} /></FinButton>
          )}
        </Panel>
      </div>
    </>
  );
}
