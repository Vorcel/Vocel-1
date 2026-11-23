import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { RangeCalendar } from "@/components/RangeCalendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ALL_PERIODS, fmtDate, monthPeriod, periodBounds, periodTitle, quickFilters, shiftPeriod, todaySP } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

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
  const [period, setPeriod] = useState(() => (type ? ALL_PERIODS : monthPeriod(todaySP())));
  const [status, setStatus] = useState(initialStatus);
  const [qText, setQText] = useState("");
  const q = useDebounced(qText.trim());
  const [adv, setAdv] = useState(EMPTY_ADV);
  const bounds = periodBounds(period);
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

// ‹  Novembro 2026  ›  [calendário]. `allPeriods`: páginas com "Todos os períodos".
export function PeriodNav({ value, onChange, className, allPeriods }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const custom = value.mode === "custom";
  // No modo mensal o calendário abre limpo (1º clique = início) no mês em exibição.
  const onOpen = (o) => {
    if (o) setDraft(custom ? { from: value.from, to: value.to } : { from: "", to: "" });
    setOpen(o);
  };
  const aplicar = (p) => { onChange(p); setOpen(false); };
  const incompleto = !draft.from || !draft.to;
  const btn = "flex h-full w-9 shrink-0 items-center justify-center transition-colors hover:bg-[var(--fin-muted-soft)]";
  return (
    <div className={cn("inline-flex h-10 max-w-full items-stretch overflow-hidden rounded-lg border", className)} data-testid="fin-period"
      style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink-2)" }}>
      <button type="button" className={btn} onClick={() => onChange(shiftPeriod(value, -1))} title={value.mode === "all" ? "Mês atual" : "Mês anterior"} aria-label={value.mode === "all" ? "Mês atual" : "Mês anterior"} data-testid="fin-period-prev">
        <ChevronLeft size={17} />
      </button>
      <span className="flex min-w-[132px] items-center justify-center truncate px-1 text-sm font-semibold" style={{ color: "var(--fin-ink)" }}
        data-testid="fin-period-label" aria-live="polite">
        {periodTitle(value)}
      </span>
      <button type="button" className={btn} onClick={() => onChange(shiftPeriod(value, 1))} title={value.mode === "all" ? "Mês atual" : "Próximo mês"} aria-label={value.mode === "all" ? "Mês atual" : "Próximo mês"} data-testid="fin-period-next">
        <ChevronRight size={17} />
      </button>
      <Popover open={open} onOpenChange={onOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(btn, "border-l")} title="Período personalizado" aria-label="Período personalizado" data-testid="fin-period-calendar"
            style={{ borderColor: "var(--fin-border)", ...(custom ? { background: "var(--fin-primary-soft)", color: "var(--fin-primary)" } : {}) }}>
            <CalendarDays size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="fin-scope w-[304px] max-w-[calc(100vw-24px)] p-3" data-testid="fin-period-popover"
          style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
          <RangeCalendar value={draft} onChange={setDraft} defaultMonth={periodBounds(value).from} testid="fin-period-range" />
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5" style={{ borderColor: "var(--fin-border)" }}>
            <span className="text-sm" style={{ color: "var(--fin-ink)" }} data-testid="fin-period-draft">
              {!draft.from ? "Selecione a data inicial" : !draft.to ? `${fmtDate(draft.from)} – …` : `${fmtDate(draft.from)} – ${fmtDate(draft.to)}`}
            </span>
            <button type="button" disabled={incompleto} data-testid="fin-period-apply" onClick={() => aplicar({ mode: "custom", from: draft.from, to: draft.to })}
              className="h-8 rounded-lg bg-[#16A34A] px-3 text-sm font-bold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
              Aplicar
            </button>
          </div>
          <button type="button" onClick={() => aplicar(allPeriods ? ALL_PERIODS : { mode: "custom", from: "", to: "" })} data-testid="fin-period-all"
            className="mt-2 block w-full text-center text-sm hover:underline" style={{ color: "var(--fin-ink-2)" }}>
            {allPeriods ? "Todos os períodos" : "Ver todo o histórico"}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
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
      {periodTitle(period)}
    </p>
  );
}
