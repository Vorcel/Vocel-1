import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFinance } from "@/context/FinanceContext";
import { cardLabel, flowBounds, flowTitle, quickFilters, todaySP } from "@/lib/financeiro";
import { CardThumb } from "./PaymentFields";
import { ChipSelect } from "./ui";

// FILTROS COMPARTILHADOS do Financeiro (Visão Geral, A Pagar, A Receber).
// A página é dona do estado (useEntryFilters) e entrega o MESMO `params` para a
// tabela e para os cards — não existe um segundo estado de período ou status.

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const EMPTY_ADV = { type: "", category_id: "", payment_method_id: "", account_id: "", mode: "", tag_ids: [] };

// `type` fixo (A Pagar / A Receber: abre em "Todos os períodos") ou null (Visão Geral:
// abre no mês atual). Nada é persistido.
export function useEntryFilters({ type = null, initialStatus = "" } = {}) {
  const [period, setPeriod] = useState(() => ({ mode: type ? "todos" : "mensal", ref: todaySP() }));
  const [status, setStatus] = useState(initialStatus);
  const [qText, setQText] = useState("");
  const q = useDebounced(qText.trim());
  const [adv, setAdv] = useState(EMPTY_ADV);
  const bounds = flowBounds(period);
  // Chave estável: muda exatamente quando algum filtro muda.
  const key = JSON.stringify({
    type: type || adv.type || undefined, status: status || undefined, q: q || undefined,
    date_from: bounds.from || undefined, date_to: bounds.to || undefined,
    category_id: adv.category_id || undefined, payment_method_id: adv.payment_method_id || undefined,
    account_id: adv.account_id || undefined, mode: adv.mode || undefined,
    tag_ids: adv.tag_ids.length ? adv.tag_ids.join(",") : undefined,
  });
  const params = useMemo(() => JSON.parse(key), [key]);
  return { type, period, setPeriod, status, setStatus, qText, setQText, adv, setAdv, key, params };
}

// Todos / Em aberto / Pago (ou Recebido) / Vencido
export function QuickFilters({ type, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="fin-quick-filters">
      <span className="text-[13px] font-medium" style={{ color: "var(--fin-ink)" }}>Filtros pré-definidos</span>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg p-1" style={{ background: "var(--fin-muted-soft)" }} role="tablist">
        {quickFilters(type).map((qf) => {
          const active = value === qf.status;
          return (
            <button key={qf.key} type="button" role="tab" aria-selected={active} onClick={() => onChange(qf.status)}
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
  );
}

// Referência visual acima dos cards (não é um filtro).
export function PeriodHeading({ period }) {
  return (
    <p className="mb-3 text-center font-heading text-base font-bold uppercase tracking-[0.14em]" style={{ color: "var(--fin-ink)" }} data-testid="fin-period-heading">
      {flowTitle(period)}
    </p>
  );
}

// Cartões de crédito em chips (um por vez), na MESMA seleção "Banco / cartão" do painel
// Filtros. "Todos" = sem cartão. Muitos cartões => rolagem horizontal só aqui.
export function CardQuickFilter({ value, onChange }) {
  const { cad } = useFinance();
  const cartoes = (cad.cartao || []).filter((c) => c.ativo !== false || c.id === value);
  if (!cartoes.length) return null;
  const atual = cartoes.some((c) => c.id === value) ? value : "";
  const chip = (id, label, content, active, onClick) => (
    <button key={id} type="button" role="radio" aria-checked={active} title={label} onClick={onClick}
      data-testid={`fin-card-filter-${id}`} data-selected={active || undefined}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors hover:bg-[var(--fin-muted-soft)]"
      style={active ? { borderColor: "var(--fin-primary)", background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }
        : { borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink)" }}>
      {content}
    </button>
  );
  return (
    <div className="fin-hscroll flex min-w-[min(100%,240px)] flex-1 items-center gap-2 overflow-x-auto py-0.5" role="radiogroup" aria-label="Cartões de crédito" data-testid="fin-card-filter">
      {chip("todos", "Todos os cartões", "Todos", !atual, () => atual && onChange(""))}
      {cartoes.map((c) => chip(c.id, cardLabel(c), (
        <><CardThumb card={c} /><span className="max-w-[140px] truncate">{c.nome}</span></>
      ), c.id === atual, () => onChange(c.id === atual ? "" : c.id)))}
    </div>
  );
}

// Tags cadastradas no sistema, ao lado dos cartões (mesmo filtro de tags do painel
// Filtros, vários = OU). As primeiras ficam visíveis; as demais no dropdown "Mais tags".
const TAGS_VISIVEIS = 2;
export function TagQuickFilter({ value, onChange }) {
  const { cad } = useFinance();
  const tags = (cad.tag || []).filter((t) => t.ativo !== false || value.includes(t.id));
  if (!tags.length) return null;
  const opt = (t) => ({ value: t.id, color: t.cor || "#64748B", title: t.nome,
    label: <span className="block max-w-[110px] truncate">{t.nome}</span> });
  const resto = tags.slice(TAGS_VISIVEIS);
  const marcadas = resto.filter((t) => value.includes(t.id)).length;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <ChipSelect multiple value={value} onChange={onChange} options={tags.slice(0, TAGS_VISIVEIS).map(opt)} testid="fin-tag-filter"
      extra={resto.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" data-testid="fin-tag-filter-more-tags" data-selected={marcadas > 0 || undefined}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-semibold transition-colors"
              style={marcadas ? { background: "var(--fin-surface)", color: "var(--fin-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.08), inset 0 0 0 1px var(--fin-primary)" } : { color: "var(--fin-ink-2)" }}>
              Mais tags{marcadas ? ` (${marcadas})` : ""} <ChevronDown size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="fin-scope w-[240px] p-2" style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
            <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
              {resto.map((t) => (
                <li key={t.id}>
                  <button type="button" role="option" aria-selected={value.includes(t.id)} onClick={() => toggle(t.id)} data-testid={`fin-tag-filter-opt-${t.id}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink)" }}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.cor || "#64748B" }} />
                    <span className="flex-1 truncate text-left">{t.nome}{t.ativo === false ? " (inativa)" : ""}</span>
                    {value.includes(t.id) && <Check size={15} className="shrink-0" style={{ color: "var(--fin-primary)" }} />}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )} />
  );
}
