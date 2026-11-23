import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChartColumnIncreasing, Landmark, Table2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useData } from "@/context/DataContext";
import { useFinance } from "@/context/FinanceContext";
import { apiError, finApi, flowBounds, flowTitle, fmtDate, money, todaySP } from "@/lib/financeiro";
import { CashFlowChart } from "@/components/financeiro/CashFlowChart";
import { CashFlowFilters } from "@/components/financeiro/CashFlowFilters";
import { BankLogo } from "@/components/financeiro/icons";
import { EmptyState, KpiCard, Money, PageHeader, Panel } from "@/components/financeiro/ui";

export default function Fluxo() {
  const { version, cad } = useFinance();
  const { prefs } = useData();
  const [period, setPeriod] = useState(() => ({ mode: "todos", ref: todaySP() }));
  const [tags, setTags] = useState([]);
  const [bancos, setBancos] = useState([]);
  const [data, setData] = useState(null);
  const { from, to } = flowBounds(period);
  const titulo = flowTitle(period, data?.horizonte);
  // UMA consulta alimenta cards, gráfico, detalhamento e alertas: mesmo recorte sempre.
  const key = JSON.stringify({
    period_mode: period.mode, date_from: from || undefined, date_to: to || undefined,
    tag_ids: tags.join(",") || undefined, bank_ids: bancos.join(",") || undefined,
  });
  useEffect(() => {
    let alive = true;
    finApi.fluxo(JSON.parse(key)).then((d) => alive && setData(d)).catch((e) => alive && toast.error(apiError(e)));
    return () => { alive = false; };
  }, [key, version]);

  const per = data?.periodos || [];
  const entradas = per.reduce((s, p) => s + p.entradas_cents, 0);
  const saidas = per.reduce((s, p) => s + p.saidas_cents, 0);
  const final = per.length ? per[per.length - 1].saldo_final_cents : 0;
  const alertas = per.filter((p) => p.alerta);
  const minimo = prefs?.financeiro?.caixa_minimo_cents || 0;
  const contasSel = (data?.contas || []).filter((c) => (bancos.length ? bancos.includes(c.id) : c.ativo));
  const ant = data?.anterior || {};
  const temAnterior = ant.entradas_cents > 0 || ant.saidas_cents > 0;

  return (
    <>
      <PageHeader icon={ChartColumnIncreasing} title="Fluxo de Caixa" subtitle="Projeção consolidada: saldo dos bancos + recebíveis − contas a pagar." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard testid="fin-flow-saldo" icon={Wallet} tone="info" highlight label="Saldo bancário atual" value={money(data?.saldo_atual_cents)} sub={bancos.length ? `${contasSel.length} banco(s) selecionado(s)` : `${contasSel.length} conta(s) ativa(s)`} />
        <KpiCard testid="fin-flow-entradas" icon={ArrowDownToLine} tone="success" flow="in" label="Entradas previstas" value={money(entradas)} sub={titulo} />
        <KpiCard testid="fin-flow-saidas" icon={ArrowUpFromLine} tone="warning" flow="out" label="Saídas previstas" value={money(saidas)} sub={titulo} />
        <KpiCard testid="fin-flow-final" icon={ChartColumnIncreasing} tone={final < 0 ? "danger" : "success"} label="Caixa final projetado" value={money(final)} sub={per.length ? `em ${fmtDate(per[per.length - 1].fim)}` : ""} />
      </div>

      <CashFlowFilters period={period} onPeriod={setPeriod} title={titulo} tags={tags} onTags={setTags} bancos={bancos} onBancos={setBancos}
        contas={data?.contas || []} tagOptions={cad.tag || []} />

      <Panel className="mt-5" icon={ChartColumnIncreasing} title="Fluxo de Caixa Projetado" testid="fin-flow-chart"
        subtitle={`Somente lançamentos em aberto, pelo vencimento. Solicitações aguardando aprovação não entram.${bancos.length ? " Lançamentos sem banco definido não entram no filtro de bancos." : ""}`}>
        <CashFlowChart periodos={per} height={300} minimo={minimo} />
      </Panel>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel className="xl:col-span-2" icon={Table2} title="Detalhamento por período" subtitle="Saldo final de cada período = saldo inicial do seguinte." testid="fin-flow-table">
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
            <table className="fin-table w-full min-w-[620px]">
              <thead><tr><th>Período</th><th className="text-right">Saldo inicial</th><th className="text-right">+ Entradas</th><th className="text-right">− Saídas</th><th className="text-right">= Saldo final</th></tr></thead>
              <tbody>
                {per.map((p) => (
                  <tr key={p.inicio}>
                    <td className="whitespace-nowrap font-medium" style={{ color: "var(--fin-ink)" }}>
                      {p.label}
                      {(p.vencidas_entradas_cents > 0 || p.vencidas_saidas_cents > 0) && <span className="ml-1 text-xs font-normal" style={{ color: "var(--fin-ink-3)" }}>(inclui vencidos)</span>}
                    </td>
                    <td className="font-mono-num text-right" style={{ color: "var(--fin-ink)" }}>{money(p.saldo_inicial_cents)}</td>
                    <td className="text-right"><Money cents={p.entradas_cents} flow="in" /></td>
                    <td className="text-right"><Money cents={p.saidas_cents} flow="out" signed={false} /></td>
                    <td className="font-mono-num text-right font-semibold" style={{ color: p.alerta ? "var(--fin-danger)" : "var(--fin-ink)" }}>{money(p.saldo_final_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {temAnterior && (
            <p className="mt-2.5 text-[13px]" style={{ color: "var(--fin-ink-2)" }} data-testid="fin-flow-anterior">
              O saldo inicial parte do saldo bancário atual e já considera o que está em aberto com vencimento antes de {fmtDate(per[0]?.inicio)}:{" "}
              entradas de <Money cents={ant.entradas_cents} flow="in" signed={false} /> e saídas de <Money cents={ant.saidas_cents} flow="out" signed={false} />.
            </p>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel icon={AlertTriangle} title="Alertas de caixa" subtitle={minimo ? `Negativo ou abaixo do mínimo de ${money(minimo)}.` : "Períodos com saldo projetado negativo."} testid="fin-flow-alerts">
            {alertas.length ? (
              <ul className="space-y-2">
                {alertas.map((p) => (
                  <li key={p.inicio} className="flex items-start gap-2.5 rounded-lg p-3 text-sm" style={{ background: "var(--fin-danger-soft)" }}>
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--fin-danger)" }} />
                    <div>
                      <p className="font-semibold" style={{ color: "var(--fin-danger)" }}>{p.alerta === "negativo" ? "Déficit previsto" : "Saldo baixo previsto"}</p>
                      <p className="text-[13px]" style={{ color: "var(--fin-ink-2)" }}>{p.label}: saldo estimado de {money(p.saldo_final_cents)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm" style={{ color: "var(--fin-ink-3)" }}>Nenhum alerta no período projetado.</p>}
          </Panel>
          <Panel icon={Landmark} title="Saldos por banco" subtitle={bancos.length ? "Saldo atual dos bancos selecionados." : "Saldo atual de cada conta ativa."}>
            {contasSel.length ? (
              <ul className="divide-y" style={{ borderColor: "var(--fin-border)" }}>
                {contasSel.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5" style={{ borderColor: "var(--fin-border)" }}>
                    <BankLogo item={c} size={30} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: "var(--fin-ink)" }}>{c.nome}</span>
                    <span className="font-mono-num text-sm font-semibold" style={{ color: c.saldo_cents < 0 ? "var(--fin-danger)" : "var(--fin-ink)" }}>{money(c.saldo_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={Landmark} title="Nenhuma conta cadastrada">Cadastre suas contas em Bancos para a projeção partir do saldo real.</EmptyState>}
          </Panel>
        </div>
      </div>
    </>
  );
}
