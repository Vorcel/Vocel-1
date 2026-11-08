import { Fragment, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronRight, History, Inbox, PencilLine, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { usePersistentPageSize } from "@/hooks/usePersistentPageSize";
import { useFinance } from "@/context/FinanceContext";
import { ACOES, MODULOS, addDays, apiError, changeValue, finApi, fmtDate, fmtTimestamp, money, todaySP } from "@/lib/financeiro";
import { EmptyState, FinInput, FinSelect, KpiCard, PageHeader, Pager, Panel, TonePill } from "@/components/financeiro/ui";

// Grupos do filtro "Tipo de ação" (cada um cobre várias ações do log).
const GRUPOS = [
  ["", "Tipo de ação: todos"],
  ["lancamento_criado,sequencia_criada,lancamento_duplicado", "Criações e duplicações"],
  ["lancamento_editado,sequencia_editada,valor_alterado,vencimento_alterado,categoria_alterada,forma_alterada,banco_alterado,cartao_alterado", "Edições"],
  ["pagamento_baixado,recebimento_baixado", "Baixas"],
  ["pagamento_estornado,recebimento_reaberto,lancamento_reativado", "Estornos e reaberturas"],
  ["lancamento_cancelado,lancamento_excluido", "Cancelamentos e exclusões"],
  ["solicitacao_enviada,solicitacao_retirada,recebivel_aprovado,recebivel_rejeitado,atualizacao_recebida,atualizacao_ignorada,recebivel_atualizado,execucao_atualizada", "Integração com a Execução"],
  ["saldo_ajustado,conta_criado,conta_editado,conta_inativado,conta_reativado,conta_excluido,cartao_criado,cartao_editado,cartao_inativado,cartao_reativado,cartao_excluido", "Bancos e cartões"],
  ["categoria_criado,categoria_editado,categoria_inativado,categoria_reativado,categoria_excluido,forma_criado,forma_editado,forma_inativado,forma_reativado,forma_excluido", "Categorias e formas"],
];

function detail(h) {
  const m = h.metadata || {};
  const parts = [];
  if (h.amount_cents != null && !h.changes?.length) parts.push(money(h.amount_cents));
  if (h.financial_date) parts.push(`Data financeira informada: ${fmtDate(h.financial_date)}`);
  if (m.count > 1) parts.push(`${m.count} lançamentos${m.scope === "next" ? " (este e próximos)" : m.scope === "all" ? " (sequência inteira)" : ""}`);
  if (m.preservados) parts.push(`${m.preservados} realizado(s) preservado(s)`);
  if (m.origem_label) parts.push(`a partir de "${m.origem_label}"`);
  if (m.motivo) parts.push(`Motivo: ${m.motivo}`);
  if (m.conta) parts.push(`Conta: ${m.conta}`);
  return parts.join(" · ");
}

export default function Historico() {
  const { version } = useFinance();
  const today = todaySP();
  const [pageSize, setPageSize] = usePersistentPageSize("fin-historico", 10);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [user, setUser] = useState("");
  const [acao, setAcao] = useState("");
  const [modulo, setModulo] = useState("");
  const [periodo, setPeriodo] = useState("30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [open, setOpen] = useState(() => new Set());
  const [data, setData] = useState({ items: [], total: 0, usuarios: [], kpis: {} });
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [qDeb, user, acao, modulo, periodo, custom.from, custom.to, pageSize]);
  const range = periodo === "todos" ? {} : periodo === "custom" ? { date_from: custom.from || undefined, date_to: custom.to || undefined }
    : periodo === "hoje" ? { date_from: today, date_to: today } : { date_from: addDays(today, -Number(periodo)), date_to: today };
  const params = JSON.stringify({ q: qDeb || undefined, user_id: user || undefined, action: acao || undefined, module: modulo || undefined, ...range, page, page_size: pageSize });
  useEffect(() => {
    finApi.historico(JSON.parse(params)).then(setData).catch((e) => toast.error(apiError(e)));
  }, [params, version]);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const k = data.kpis || {};

  return (
    <>
      <PageHeader icon={History} title="Histórico de Operações" subtitle="Registro imutável de tudo o que foi feito no Financeiro, pelo horário real de cada ação." />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard icon={CalendarDays} tone="info" highlight label="Eventos hoje" value={k.hoje ?? 0} />
        <KpiCard icon={PencilLine} tone="warning" label="Alterações no mês" value={k.alteracoes_mes ?? 0} />
        <KpiCard icon={CheckCircle2} tone="success" label="Baixas no mês" value={k.baixas_mes ?? 0} />
        <KpiCard icon={ShieldCheck} tone="info" label="Aprovações no mês" value={k.aprovacoes_mes ?? 0} />
      </div>
      <Panel className="mt-5" bodyClassName="pt-5" testid="fin-history">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--fin-ink-3)" }} />
            <FinInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar registro, ID, usuário, motivo..." className="pl-9" data-testid="fin-history-search" />
          </div>
          <FinSelect value={user} onChange={(e) => setUser(e.target.value)} className="w-auto" data-testid="fin-history-user">
            <option value="">Usuário: todos</option>
            {data.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </FinSelect>
          <FinSelect value={acao} onChange={(e) => setAcao(e.target.value)} className="w-auto" data-testid="fin-history-action">
            {GRUPOS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
          </FinSelect>
          <FinSelect value={modulo} onChange={(e) => setModulo(e.target.value)} className="w-auto" data-testid="fin-history-module">
            <option value="">Módulo: todos</option>
            {Object.entries(MODULOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </FinSelect>
          <FinSelect value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-auto" data-testid="fin-history-period">
            <option value="hoje">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option><option value="todos">Todo o histórico</option><option value="custom">Personalizado…</option>
          </FinSelect>
        </div>
        {periodo === "custom" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--fin-ink-2)" }}>
            Ações de <DatePickerInput value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} className="w-40" testid="fin-history-from" />
            até <DatePickerInput value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} className="w-40" testid="fin-history-to" />
          </div>
        )}
        <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
          <table className="fin-table w-full min-w-[960px]">
            <thead><tr><th className="w-8" /><th>Data e hora ↓</th><th>Usuário</th><th>Ação</th><th>Módulo</th><th>Registro afetado</th><th>Detalhes</th><th>Origem</th></tr></thead>
            <tbody>
              {data.items.map((h) => {
                const t = fmtTimestamp(h.ts);
                const a = ACOES[h.action] || { label: h.action, tone: "muted" };
                const hasMore = h.changes?.length > 0 || h.metadata?.excluidos?.length > 0;
                const isOpen = open.has(h.id);
                const initials = (h.user_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <Fragment key={h.id}>
                    <tr data-testid={`fin-history-row-${h.id}`} className={hasMore ? "cursor-pointer" : undefined} onClick={() => hasMore && toggle(h.id)}>
                      <td style={{ color: "var(--fin-ink-3)" }}>{hasMore && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</td>
                      <td className="whitespace-nowrap"><div className="font-medium" style={{ color: "var(--fin-ink)" }}>{t.date}</div><div className="font-mono-num text-xs" style={{ color: "var(--fin-ink-3)" }}>{t.time}</div></td>
                      <td className="whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--fin-muted-soft)", color: "var(--fin-ink-2)" }}>{initials}</span>
                          <span style={{ color: "var(--fin-ink)" }}>{h.user_name || "—"}</span>
                        </span>
                      </td>
                      <td><TonePill tone={a.tone}>{a.label}</TonePill></td>
                      <td className="whitespace-nowrap" style={{ color: "var(--fin-ink-2)" }}>{MODULOS[h.module] || h.module}</td>
                      <td className="max-w-[220px]"><div className="truncate font-medium" style={{ color: "var(--fin-ink)" }} title={h.entity_label}>{h.entity_label || "—"}</div><div className="font-mono-num text-[11px]" style={{ color: "var(--fin-ink-3)" }}>#{(h.entity_id || "").slice(0, 8)}</div></td>
                      <td className="max-w-[300px] text-xs" style={{ color: "var(--fin-ink-2)" }}>
                        {h.changes?.length === 1
                          ? <>{h.changes[0].label}: {changeValue(h.changes[0].field, h.changes[0].before)} → <b>{changeValue(h.changes[0].field, h.changes[0].after)}</b></>
                          : h.changes?.length > 1 ? `${h.changes.length} campos alterados` : null}
                        {detail(h) && <div className="truncate" title={detail(h)}>{detail(h)}</div>}
                      </td>
                      <td><TonePill tone={h.origin === "Execução" ? "warning" : "muted"}>{h.origin}</TonePill></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td />
                        <td colSpan={7} style={{ background: "var(--fin-surface-2)" }}>
                          {h.changes?.length > 0 && (
                            <table className="text-xs">
                              <thead><tr><th className="pr-6 text-left" style={{ color: "var(--fin-ink-3)" }}>Campo</th><th className="pr-6 text-left" style={{ color: "var(--fin-ink-3)" }}>Antes</th><th className="text-left" style={{ color: "var(--fin-ink-3)" }}>Depois</th></tr></thead>
                              <tbody>{h.changes.map((c) => (
                                <tr key={c.field}><td className="pr-6 py-0.5">{c.label}</td><td className="pr-6 py-0.5" style={{ color: "var(--fin-ink-3)" }}>{changeValue(c.field, c.before)}</td><td className="py-0.5 font-semibold">{changeValue(c.field, c.after)}</td></tr>
                              ))}</tbody>
                            </table>
                          )}
                          {h.metadata?.excluidos?.length > 0 && (
                            <ul className="mt-1 text-xs" style={{ color: "var(--fin-ink-2)" }}>
                              {h.metadata.excluidos.map((x) => <li key={x.id}>{x.descricao} · {money(x.valor)} · venc. {fmtDate(x.vencimento)}</li>)}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!data.items.length && <EmptyState icon={Inbox} title="Nenhum evento no período" />}
        </div>
        <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} sizes={[10, 25, 50]} />
      </Panel>
    </>
  );
}
