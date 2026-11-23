import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Inbox, Plus, Repeat, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { SortArrows } from "@/components/table/SortArrows";
import { usePersistentPageSize } from "@/hooks/usePersistentPageSize";
import { usePersistentSort } from "@/hooks/usePersistentSort";
import { useFinance } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";
import { MODOS, apiError, dueAlert, finApi, fmtDate, isOpenEntry, money, quickFilters, todaySP } from "@/lib/financeiro";
import { EntryRowActions } from "./EntryActions";
import { EMPTY_ADV, PeriodNav, QuickFilters } from "./EntryFilters";
import { TagPicker } from "./TagPicker";
import { Amount, CategoryChip, EmptyState, EntryStatus, FinButton, FinInput, FinSelect, Pager, TagChips, TonePill } from "./ui";

// Status além dos filtros rápidos (mesmo estado: escolher aqui tira o botão rápido).
const STATUS_OPTS = {
  pagar: [["", "Status: pelos filtros rápidos"], ["a_vencer", "A vencer"], ["parcial", "Parcialmente pagos"], ["cancelado", "Cancelados"]],
  receber: [["", "Status: pelos filtros rápidos"], ["a_vencer", "A vencer"], ["parcial", "Parcialmente recebidos"], ["cancelado", "Cancelados"]],
  all: [["", "Status: pelos filtros rápidos"], ["a_vencer", "A vencer"], ["parcial", "Com baixa parcial"], ["cancelado", "Cancelados"]],
};

function RowCheckbox({ indeterminate, ...props }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" {...props}
      className="h-4 w-4 cursor-pointer align-middle disabled:cursor-not-allowed disabled:opacity-35" style={{ accentColor: "var(--fin-primary)" }} />
  );
}

// Tabela de lançamentos com paginação/ordenação NO SERVIDOR (só a página atual
// trafega). `filters` = useEntryFilters da página: o MESMO estado alimenta os cards.
// `onSelectionChange(rows)` liga a seleção por checkbox (A Pagar / A Receber):
// só linhas VISÍVEIS com saldo em aberto; qualquer mudança de filtro, página ou
// ordenação limpa a seleção (nunca há item marcado invisível).
export function EntriesTable({ filters, pageKey, onSelectionChange }) {
  const { type, period, setPeriod, status, setStatus, qText, setQText, adv, setAdv, key: filterKey, params: filterParams } = filters;
  const { cad, version, novoLancamento, acaoLancamento } = useFinance();
  const { can } = useAuth();
  // Tipos que o usuário pode lançar: com um só, o formulário já abre nele.
  const criaveis = ["pagar", "receber"].filter((t) => can(`finance.${t}.create`) && (!type || t === type));
  const today = todaySP();
  const [sort, toggleSort] = usePersistentSort(`fin-${pageKey}`, { key: "due_date", dir: "asc" });
  const [pageSize, setPageSize] = usePersistentPageSize(`fin-${pageKey}`, 10);
  // A página vale só para os filtros em que foi escolhida: filtro novo = página 1.
  const pageScope = `${filterKey}|${pageSize}`;
  const [pageState, setPageState] = useState({ scope: pageScope, page: 1 });
  const page = pageState.scope === pageScope ? pageState.page : 1;
  const setPage = (n) => setPageState({ scope: pageScope, page: n });
  const [showAdv, setShowAdv] = useState(false);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const selectable = !!onSelectionChange;
  const [sel, setSel] = useState({ scope: "", ids: [] });

  const key = JSON.stringify({ ...filterParams, page, page_size: pageSize, sort: sort.key, dir: sort.dir });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    finApi.lancamentos(JSON.parse(key))
      .then((d) => {
        if (!alive) return;
        setData({ ...d, key });
        // A baixa pode esvaziar a última página: volta para a última existente.
        const last = Math.max(1, Math.ceil(d.total / d.page_size));
        if (d.page > last) setPageState({ scope: pageScope, page: last });
        // Linha que deixou de estar em aberto sai da seleção.
        const abertas = new Set(d.items.filter(isOpenEntry).map((e) => e.id));
        setSel((s) => ({ ...s, ids: s.ids.filter((id) => abertas.has(id)) }));
      })
      .catch((e) => alive && toast.error(apiError(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  // Texto ainda não aplicado (debounce) também já limpa a seleção.
  const selScope = `${key}|${qText}`;
  const selIds = sel.scope === selScope ? sel.ids : [];
  const setIds = (ids) => setSel({ scope: selScope, ids });
  const selecionaveis = data.key === key ? data.items.filter(isOpenEntry) : [];
  const selecionados = selecionaveis.filter((e) => selIds.includes(e.id));
  const todos = selecionaveis.length > 0 && selecionados.length === selecionaveis.length;
  const totalSel = selecionados.reduce((s, e) => s + e.open_cents, 0);
  const selSig = selecionados.map((e) => `${e.id}:${e.open_cents}`).join(",");
  useEffect(() => {
    onSelectionChange?.(selecionados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSig]);
  const podeBaixar = !!type && can(`finance.${type}.settle`);
  const statusExtra = !quickFilters(type).some((qf) => qf.status === status);

  const advCount = Object.entries(adv).filter(([k, v]) => (Array.isArray(v) ? v.length : v) && !(type && k === "type")).length + (statusExtra ? 1 : 0);
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
    return <div className="leading-tight"><div>{forma || "—"}</div>{conta && <div className="text-[13px]" style={{ color: "var(--fin-ink-2)" }}>{conta}</div>}</div>;
  };

  return (
    <div data-testid={`fin-table-${pageKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--fin-ink-3)" }} />
          <FinInput value={qText} onChange={(e) => setQText(e.target.value)} placeholder={type === "receber" ? "Buscar por descrição, cliente, pregão..." : "Buscar por descrição, fornecedor..."} className="pl-9" data-testid="fin-search" />
        </div>
        <PeriodNav allPeriods={!!type} value={period} onChange={setPeriod} />
        <FinButton variant="outline" onClick={() => setShowAdv((s) => !s)} data-testid="fin-filter-more">
          <SlidersHorizontal size={15} /> Filtros{advCount ? ` (${advCount})` : ""}
        </FinButton>
        {criaveis.length > 0 && (
          <FinButton onClick={() => novoLancamento(type ? { type } : criaveis.length === 1 ? { type: criaveis[0] } : undefined)}
            data-testid="fin-new-entry"><Plus size={16} /> Novo lançamento</FinButton>
        )}
      </div>
      <div className="mt-3"><QuickFilters type={type} value={status} onChange={setStatus} /></div>
      {showAdv && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }} data-testid="fin-adv-filters">
          {!type && (
            <FinSelect value={adv.type} onChange={(e) => setAdv((a) => ({ ...a, type: e.target.value }))}>
              <option value="">Tipo: todos</option><option value="pagar">A Pagar</option><option value="receber">A Receber</option>
            </FinSelect>
          )}
          <FinSelect value={statusExtra ? status : ""} onChange={(e) => setStatus(e.target.value)} data-testid="fin-filter-status">
            {STATUS_OPTS[type || "all"].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </FinSelect>
          <FinSelect value={adv.category_id} onChange={(e) => setAdv((a) => ({ ...a, category_id: e.target.value }))} data-testid="fin-filter-category">
            <option value="">Categoria: todas</option>
            {catList.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
          <FinSelect value={adv.payment_method_id} onChange={(e) => setAdv((a) => ({ ...a, payment_method_id: e.target.value }))}>
            <option value="">Forma: todas</option>
            {cad.forma.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
          <FinSelect value={adv.account_id} onChange={(e) => setAdv((a) => ({ ...a, account_id: e.target.value }))} data-testid="fin-filter-account">
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
            <button onClick={() => { setAdv(EMPTY_ADV); if (statusExtra) setStatus(""); }}
              className="flex items-center gap-1 text-xs font-semibold sm:col-span-2 lg:col-span-3 xl:col-span-6" style={{ color: "var(--fin-primary)" }}>
              <X size={13} /> Limpar filtros
            </button>
          )}
        </div>
      )}

      {selecionados.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 text-sm" data-testid="fin-selection-bar"
          style={{ borderColor: "var(--fin-primary)", background: "var(--fin-primary-soft)", color: "var(--fin-ink)" }}>
          <span className="font-semibold">{selecionados.length} selecionado{selecionados.length === 1 ? "" : "s"}</span>
          <span style={{ color: "var(--fin-ink-3)" }}>|</span>
          <span className="font-mono-num font-semibold">{money(totalSel)}</span>
          {podeBaixar && (
            <FinButton onClick={() => acaoLancamento("settle-batch", { type, entries: selecionados })} data-testid="fin-settle-selected">
              <CheckCircle2 size={15} /> Baixar selecionados
            </FinButton>
          )}
          <button type="button" onClick={() => setIds([])} className="ml-auto flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--fin-primary)" }}
            data-testid="fin-selection-clear"><X size={13} /> Limpar seleção</button>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
        <table className="fin-table w-full min-w-[860px]">
          <thead>
            <tr>
              {selectable && (
                <th className="w-10">
                  <RowCheckbox checked={todos} indeterminate={!todos && selecionados.length > 0} disabled={!selecionaveis.length}
                    onChange={() => setIds(todos ? [] : selecionaveis.map((e) => e.id))}
                    aria-label="Selecionar todos os lançamentos visíveis" title="Selecionar os visíveis desta página" data-testid="fin-select-all" />
                </th>
              )}
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
                  {selectable && (
                    <td className="w-10">
                      <RowCheckbox checked={selIds.includes(e.id) && isOpenEntry(e)} disabled={!isOpenEntry(e) || data.key !== key}
                        onChange={() => setIds(selIds.includes(e.id) ? selIds.filter((x) => x !== e.id) : [...selIds, e.id])}
                        aria-label={`Selecionar ${e.description}`} title={isOpenEntry(e) ? undefined : "Sem saldo em aberto"} data-testid={`fin-select-${e.id}`} />
                    </td>
                  )}
                  <td className="font-mono-num whitespace-nowrap"
                    style={{ color: alerta === "atrasado" ? "var(--fin-danger)" : alerta === "hoje" ? "var(--fin-warning)" : "var(--fin-ink)", fontWeight: alerta ? 600 : 400 }}>
                    {fmtDate(e.due_date)}
                  </td>
                  <td className="max-w-[260px]">
                    <div className="truncate font-medium" style={{ color: "var(--fin-ink)" }} title={e.description}>{e.description}</div>
                    {(e.client_supplier || e.bid_label || e.tag_ids?.length > 0) && (
                      <div className="flex min-w-0 items-center gap-1.5 text-[13px]" style={{ color: "var(--fin-ink-2)" }}>
                        {(e.client_supplier || e.bid_label) && <span className="truncate" title={e.bid_label || ""}>{e.client_supplier || e.bid_label}</span>}
                        <TagChips ids={e.tag_ids} names={e.tag_names} className="shrink-0 flex-nowrap" />
                      </div>
                    )}
                  </td>
                  {!type && <td><TonePill tone={e.type === "pagar" ? "warning" : "success"}>{e.type === "pagar" ? "A Pagar" : "A Receber"}</TonePill></td>}
                  <td><CategoryChip id={e.category_id} name={e.category_name} /></td>
                  <td className="text-sm" style={{ color: "var(--fin-ink-2)" }}>{pagamento(e)}</td>
                  <td className="whitespace-nowrap text-sm" style={{ color: "var(--fin-ink-2)" }}>
                    {e.sequence_id ? (
                      <span className="inline-flex items-center gap-1" title={MODOS[e.mode]}>
                        {e.mode === "recorrente" && <Repeat size={12} />}{e.sequence_index}/{e.sequence_total}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="text-right">
                    <Amount cents={e.amount_cents} type={e.type} strong />
                    {e.status === "parcial" && (
                      <div className="font-mono-num whitespace-nowrap text-xs" style={{ color: "var(--fin-ink-2)" }} title={`Original ${money(e.amount_cents)} · baixado ${money(e.settled_cents)}`}>
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
