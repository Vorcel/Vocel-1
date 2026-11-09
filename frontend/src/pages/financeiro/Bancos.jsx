import { useEffect, useState } from "react";
import { ArrowLeftRight, CreditCard, Inbox, Landmark, ListOrdered, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/context/FinanceContext";
import { apiError, finApi, fmtDate, monthBounds, money, todaySP } from "@/lib/financeiro";
import { BankLogo } from "@/components/financeiro/icons";
import { Amount, EmptyState, FinSelect, KpiCard, PageHeader, Pager, Panel, TonePill } from "@/components/financeiro/ui";
import { CartoesList, ContasList } from "./Configuracoes";

export default function Bancos() {
  const { cad, version } = useFinance();
  const ativas = cad.conta.filter((c) => c.ativo !== false);
  const consolidado = ativas.reduce((s, c) => s + (c.saldo_atual_cents || 0), 0);
  const [mes, setMes] = useState(null);
  useEffect(() => {
    const [a, b] = monthBounds(todaySP());
    finApi.movimentos({ date_from: a, date_to: b, page_size: 1 }).then(setMes).catch(() => {});
  }, [version]);
  return (
    <>
      <PageHeader icon={Landmark} title="Bancos" subtitle="Saldos, contas, cartões e movimentações por instituição." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard testid="fin-banks-total" icon={Wallet} tone="success" highlight label="Saldo consolidado" value={money(consolidado)} sub={`${ativas.length} conta(s) ativa(s)`} />
        <KpiCard testid="fin-banks-mes" icon={ArrowLeftRight} tone={(mes?.net_cents ?? 0) < 0 ? "warning" : "info"} flow={(mes?.net_cents ?? 0) < 0 ? "out" : (mes?.net_cents ?? 0) > 0 ? "in" : undefined} label="Resultado das baixas no mês" value={money(mes?.net_cents)} sub={`${mes?.total ?? 0} pagamento(s)/recebimento(s)`} />
        <KpiCard testid="fin-banks-cards" icon={CreditCard} tone="info" label="Cartões ativos" value={cad.cartao.filter((c) => c.ativo !== false).length} sub="Configuração em Contas e cartões" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="fin-card min-w-0 p-5 xl:col-span-3"><ContasList compact /></section>
        <section className="fin-card min-w-0 p-5 xl:col-span-2"><CartoesList compact /></section>
      </div>
      <Movimentacoes />
    </>
  );
}

// Extrato do sistema: cada baixa (total ou parcial) é uma movimentação da conta.
function Movimentacoes() {
  const { cad, byId, version, acaoLancamento } = useFinance();
  const [conta, setConta] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  useEffect(() => { setPage(1); }, [conta]);
  useEffect(() => {
    finApi.movimentos({ account_id: conta || undefined, page, page_size: 10 })
      .then(setData).catch((e) => toast.error(apiError(e)));
  }, [conta, page, version]);
  return (
    <Panel className="mt-5" icon={ListOrdered} title="Movimentações bancárias" subtitle="Pagamentos e recebimentos (inclusive parciais), mais recentes primeiro." testid="fin-banks-movements"
      actions={(
        <FinSelect value={conta} onChange={(e) => setConta(e.target.value)} className="w-auto" data-testid="fin-banks-account-filter">
          <option value="">Todas as contas</option>
          {cad.conta.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </FinSelect>
      )}>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
        <table className="fin-table w-full min-w-[680px]">
          <thead><tr><th>Data</th><th>Banco</th><th>Descrição</th><th>Tipo</th><th className="text-right">Valor</th></tr></thead>
          <tbody>
            {data.items.map((e) => {
              const c = byId[e.bank_account_id];
              return (
                <tr key={e.id} className="cursor-pointer" onClick={() => finApi.lancamento(e.entry_id).then((x) => acaoLancamento("detail", x)).catch(() => {})}>
                  <td className="font-mono-num whitespace-nowrap" style={{ color: "var(--fin-ink-2)" }}>{fmtDate(e.financial_date)}</td>
                  <td>
                    {e.bank_account_id
                      ? <span className="flex items-center gap-2"><BankLogo item={c} size={22} /><span className="truncate">{c?.nome || e.account_name}</span></span>
                      : <span style={{ color: "var(--fin-ink-3)" }}>Sem conta</span>}
                  </td>
                  <td className="max-w-[300px] truncate" style={{ color: "var(--fin-ink)" }}>{e.description}</td>
                  <td><TonePill tone={e.type === "pagar" ? "warning" : "success"}>{e.type === "pagar" ? "Pagamento" : "Recebimento"}</TonePill></td>
                  <td className="text-right"><Amount cents={e.amount_cents} type={e.type} strong /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.items.length && <EmptyState icon={Inbox} title="Nenhuma movimentação">As baixas de pagamentos e recebimentos aparecem aqui.</EmptyState>}
      </div>
      <Pager page={page} pageSize={10} total={data.total} onPage={setPage} />
    </Panel>
  );
}
