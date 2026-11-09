import { useEffect, useMemo, useState } from "react";
import { Inbox, Plus, Repeat, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { SortArrows } from "@/components/table/SortArrows";
import { usePersistentPageSize } from "@/hooks/usePersistentPageSize";
import { usePersistentSort } from "@/hooks/usePersistentSort";
import { useFinance } from "@/context/FinanceContext";
import { MODOS, QUICK_FILTERS, apiError, dueAlert, finApi, fmtDate, money, periodPresets, periodRange, todaySP } from "@/lib/financeiro";
import { EntryRowActions } from "./EntryActions";
import { TagPicker } from "./TagPicker";
import { Amount, CategoryChip, EmptyState, EntryStatus, FinButton, FinInput, FinSelect, Pager, TagChips, TonePill } from "./ui";

const STATUS_OPTS = {
  pagar: [["", "Todos (exceto cancelados)"], ["aberto", "Em aberto"], ["a_vencer", "A vencer"], ["atrasado", "Atrasados"], ["parcial", "Parcialmente pagos"], ["pago", "Pagos"], ["cancelado", "Cancelados"]],
  receber: [["", "Todos (exceto cancelados)"], ["aberto", "Em aberto"], ["a_vencer", "A vencer"], ["atrasado", "Atrasados"], ["parcial", "Parcialmente recebidos"], ["recebido", "Recebidos"], ["cancelado", "Cancelados"]],
  all: [["", "Todos (exceto cancelados)"], ["aberto", "Em aberto"], ["atrasado", "Atrasados"], ["parcial", "Com baixa parcial"], ["realizado", "Quitados"], ["cancelado", "Cancelados"]],
};

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// Tabela de lançamentos com paginação/ordenação NO SERVIDOR (só a página atual
// trafega). `type` fixo (A Pagar / A Receber) ou null (Lançamentos: ambos).
// `quickFilters` (Visão Geral): botões Todos / Em aberto / Pago / Vencido no
// lugar do select de status, começando SEMPRE em "Em aberto" (não persiste).
// Filtram só esta tabela — cards e gráfico da página não mudam.
// Período: interno, ou CONTROLADO pela página (`period`/`onPeriodChange` +
// `custom`/`onCustomChange`) — na Visão Geral o mesmo estado alimenta os cards.
export function EntriesTable({ type = null, pageKey, defaultPeriod = "mes", title, toolbarExtra, quickFilters = false,
  period: periodProp, onPeriodChange, custom: customProp, onCustomChange }) {
  const { cad, version, novoLancamento } = useFinance();
  const today = todaySP();
  const presets = useMemo(() => periodPresets(today), [today]);
  const [sort, toggleSort] = usePersistentSort(`fin-${pageKey}`, { key: "due_date", dir: "asc" });
  const [pageSize, setPageSize] = usePersistentPageSize(`fin-${pageKey}`, 10);
  const [page, setPage] = useState(1);
  const [qText, setQText] = useState("");
  const q = useDebounced(qText);
  const [status, setStatus] = useState(quickFilters ? "aberto" : "");
  const [periodInt, setPeriodInt] = useState(defaultPeriod);
  const [customInt, setCustomInt] = useState({ from: "", to: "" });
  const period = periodProp ?? periodInt;
  const setPeriod = onPeriodChange || setPeriodInt;
  const custom = customProp ?? customInt;
  const setCustom = onCustomChange || setCustomInt;
  const EMPTY_ADV = { type: "", category_id: "", payment_method_id: "", account_id: "", mode: "", tag_ids: [] };
  const [adv, setAdv] = useState(EMPTY_ADV);
  const [showAdv, setShowAdv] = useState(false);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  const { open: _open, ...range } = periodRange(period, custom, presets);
  const params = {
    type: type || adv.type || undefined, status: status || undefined, q: q || undefined, ...range,
    category_id: adv.category_id || undefined, payment_method_id: adv.payment_method_id || undefined,
    account_id: adv.account_id || undefined, mode: adv.mode || undefined, tag_ids: adv.tag_ids.length ? adv.tag_ids.join(",") : undefined,
    page, page_size: pageSize, sort: sort.key, dir: sort.dir,
  };
  const key = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [q, status, period, custom.from, custom.to, adv.type, adv.category_id, adv.payment_method_id, adv.account_id, adv.mode, adv.tag_ids, pageSize]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    finApi.lancamentos(JSON.parse(key))
      .then((d) => alive && setData(d))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [key, version]);

  const advCount = Object.entries(adv).filter(([k, v]) => (Array.isArray(v) ? v.length : v) && !(type && k === "type")).length;
  const catList = cad.categoria.filter((c) => !type || c.tipo === (type === "receber" ? "receita" : "despesa"));
  const head = (label, sortKey, align) => (
    <th className={align === "right" ? "text-right" : undefined}>
      <span className="inline-flex items-center">{label}{sortKey && <SortArrows active={sort.key === sortKey} dir={sort.dir} onClick={() => toggleSort(sortKey)} testid={`fin-sort-${sortKey}`} />}</span>
    </th>
  );
  const pagamento = (e) => {
    const forma = (e.payment_method_id && cad.forma.find((x) => x.id === e.payment_method_id)?.nome) || e.payment_method_name
      || (e.card_id ? "Cartão de crédito" : null);
    const conta = (e.card_id && (cad.cartao.find((x) => x.id === e.card_id)?.nome || e.card_name)) ||
      (e.bank_account_id && (cad.conta.find((x) => x.id === e.bank_account_id)?.nome || e.account_name));
    if (!forma && !conta) return <span style={{ color: "var(--fin-ink-3)" }}>—</span>;
    return <div className="leading-tight"><div>{forma || "—"}</div>{conta && <div className="text-xs" style={{ color: "var(--fin-ink-3)" }}>{conta}</div>}</div>;
  };

  return (
    <div data-testid={`fin-table-${pageKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        {title}
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--fin-ink-3)" }} />
          <FinInput value={qText} onChange={(e) => setQText(e.target.value)} placeholder={type === "receber" ? "Buscar por descrição, cliente, pregão..." : "Buscar por descrição, fornecedor..."} className="pl-9" data-testid="fin-search" />
        </div>
        {!quickFilters && (
          <FinSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" data-testid="fin-filter-status">
            {STATUS_OPTS[type || "all"].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </FinSelect>
        )}
        <FinSelect value={period} onChange={(e) => setPeriod(e.target.value)} className="w-auto" data-testid="fin-filter-period">
          <option value="todos">Todos os vencimentos</option>
          {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Personalizado…</option>
        </FinSelect>
        <FinButton variant="outline" onClick={() => setShowAdv((s) => !s)} data-testid="fin-filter-more">
          <SlidersHorizontal size={15} /> Filtros{advCount ? ` (${advCount})` : ""}
        </FinButton>
        {toolbarExtra}
        <FinButton onClick={() => novoLancamento(type ? { type } : undefined)} data-testid="fin-new-entry"><Plus size={16} /> Novo lançamento</FinButton>
      </div>
      {quickFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="fin-quick-filters">
          <span className="text-xs font-medium" style={{ color: "var(--fin-ink-3)" }}>Filtros pré-definidos</span>
          <div className="inline-flex flex-wrap gap-1 rounded-lg p-1" style={{ background: "var(--fin-muted-soft)" }} role="tablist">
            {QUICK_FILTERS.map((qf) => {
              const active = status === qf.status;
              return (
                <button key={qf.key} type="button" role="tab" aria-selected={active} onClick={() => setStatus(qf.status)}
                  data-testid={`fin-quick-${qf.key}`} data-selected={active || undefined}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
                  style={active ? { background: "var(--fin-surface)", color: "var(--fin-ink)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : { color: "var(--fin-ink-2)" }}>
                  {qf.color && <span className="h-2 w-2 rounded-full" style={{ background: qf.color }} />}
                  {qf.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {period === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--fin-ink-2)" }}>
          Vencimento de <DatePickerInput value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} testid="fin-period-from" className="w-40" />
          até <DatePickerInput value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} testid="fin-period-to" className="w-40" />
        </div>
      )}
      {showAdv && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }} data-testid="fin-adv-filters">
          {!type && (
            <FinSelect value={adv.type} onChange={(e) => setAdv((a) => ({ ...a, type: e.target.value }))}>
              <option value="">Tipo: todos</option><option value="pagar">A Pagar</option><option value="receber">A Receber</option>
            </FinSelect>
          )}
          <FinSelect value={adv.category_id} onChange={(e) => setAdv((a) => ({ ...a, category_id: e.target.value }))} data-testid="fin-filter-category">
            <option value="">Categoria: todas</option>
            {catList.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
          <FinSelect value={adv.payment_method_id} onChange={(e) => setAdv((a) => ({ ...a, payment_method_id: e.target.value }))}>
            <option value="">Forma: todas</option>
            {cad.forma.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
          <FinSelect value={adv.account_id} onChange={(e) => setAdv((a) => ({ ...a, account_id: e.target.value }))}>
            <option value="">Banco / cartão: todos</option>
            {cad.conta.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            {cad.cartao.map((c) => <option key={c.id} value={c.id}>{`Cartão ${c.nome}`}</option>)}
          </FinSelect>
          <FinSelect value={adv.mode} onChange={(e) => setAdv((a) => ({ ...a, mode: e.target.value }))}>
            <option value="">Modo: todos</option>
            {Object.entries(MODOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </FinSelect>
          <TagPicker value={adv.tag_ids} onChange={(tag_ids) => setAdv((a) => ({ ...a, tag_ids }))} placeholder="Tags: todas" includeInactive testid="fin-filter-tags" />
          {advCount > 0 && (
            <button onClick={() => setAdv(EMPTY_ADV)}
              className="flex items-center gap-1 text-xs font-semibold sm:col-span-2 lg:col-span-3 xl:col-span-6" style={{ color: "var(--fin-primary)" }}>
              <X size={13} /> Limpar filtros
            </button>
          )}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
        <table className="fin-table w-full min-w-[860px]">
          <thead>
            <tr>
              {head("Vencimento", "due_date")}
              {head("Descrição", "description")}
              {!type && <th>Tipo</th>}
              <th>Categoria</th>
              <th>Pagamento</th>
              <th>Parcela</th>
              {head("Valor", "amount", "right")}
              {head("Status", "status")}
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody style={{ opacity: loading ? 0.55 : 1 }}>
            {data.items.map((e) => {
              // Destaque da LINHA pelo saldo em aberto: atrasado > vence hoje > normal
              // (um fundo só; quitado/cancelado nunca destaca).
              const alerta = dueAlert(e, today);
              return (
                <tr key={e.id} data-testid={`fin-row-${e.id}`} data-alert={alerta || undefined}
                  className={alerta === "atrasado" ? "fin-row-late" : alerta === "hoje" ? "fin-row-today" : undefined}>
                  <td className="font-mono-num whitespace-nowrap"
                    style={{ color: alerta === "atrasado" ? "var(--fin-danger)" : alerta === "hoje" ? "var(--fin-warning)" : "var(--fin-ink-2)", fontWeight: alerta ? 600 : 400 }}>
                    {fmtDate(e.due_date)}
                  </td>
                  <td className="max-w-[260px]">
                    <div className="truncate font-medium" style={{ color: "var(--fin-ink)" }} title={e.description}>{e.description}</div>
                    {(e.client_supplier || e.bid_label || e.tag_ids?.length > 0) && (
                      <div className="flex min-w-0 items-center gap-1.5 text-xs" style={{ color: "var(--fin-ink-3)" }}>
                        {(e.client_supplier || e.bid_label) && <span className="truncate" title={e.bid_label || ""}>{e.client_supplier || e.bid_label}</span>}
                        <TagChips ids={e.tag_ids} names={e.tag_names} className="shrink-0 flex-nowrap" />
                      </div>
                    )}
                  </td>
                  {!type && <td><TonePill tone={e.type === "pagar" ? "warning" : "success"}>{e.type === "pagar" ? "A Pagar" : "A Receber"}</TonePill></td>}
                  <td><CategoryChip id={e.category_id} name={e.category_name} /></td>
                  <td className="text-[13px]" style={{ color: "var(--fin-ink-2)" }}>{pagamento(e)}</td>
                  <td className="whitespace-nowrap text-xs" style={{ color: "var(--fin-ink-2)" }}>
                    {e.sequence_id ? (
                      <span className="inline-flex items-center gap-1" title={MODOS[e.mode]}>
                        {e.mode === "recorrente" && <Repeat size={12} />}{e.sequence_index}/{e.sequence_total}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="text-right">
                    <Amount cents={e.amount_cents} type={e.type} strong />
                    {e.status === "parcial" && (
                      <div className="font-mono-num whitespace-nowrap text-[11px]" style={{ color: "var(--fin-ink-3)" }} title={`Original ${money(e.amount_cents)} · baixado ${money(e.settled_cents)}`}>
                        aberto {money(e.open_cents)}
                      </div>
                    )}
                  </td>
                  <td title={e.request_id ? "Veio da Execução & Pós-Venda" : undefined}><EntryStatus entry={e} /></td>
                  <td><EntryRowActions entry={e} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !data.items.length && (
          <EmptyState icon={Inbox} title="Nenhum lançamento encontrado">Ajuste os filtros ou crie um novo lançamento.</EmptyState>
        )}
      </div>
      <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={setPageSize} sizes={[5, 10, 25, 50]} />
    </div>
  );
}
