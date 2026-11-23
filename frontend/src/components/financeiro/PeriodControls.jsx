import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RangeCalendar } from "@/components/RangeCalendar";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { FLOW_MODES, flowBounds, fmtDate, setFlowMode, shiftFlow } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { Segmented } from "./ui";

// PERÍODO compartilhado: Fluxo de Caixa, Visão Geral, A Pagar e A Receber.
// `compact` = barra de filtros das tabelas (REF5).
// Modos sempre visíveis; "Personalizado" abre o calendário (só troca o modo ao Aplicar).
export function PeriodModes({ period, onPeriod, testid, compact }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const custom = period.mode === "personalizado";
  const choose = (mode) => {
    if (mode !== "personalizado") { onPeriod(setFlowMode(period, mode)); setOpen(false); return; }
    setDraft(custom ? { from: period.from, to: period.to } : { from: "", to: "" });
    setOpen(true);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="max-w-full"><Segmented value={period.mode} onChange={choose} options={FLOW_MODES} testid={`${testid}-mode`}
          className={compact ? "[&>button]:px-2.5" : undefined} /></div>
      </PopoverAnchor>
      <PopoverContent align="end" className="fin-scope w-[304px] max-w-[calc(100vw-24px)] p-3" data-testid={`${testid}-range-popover`}
        style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
        <RangeCalendar value={draft} onChange={setDraft} defaultMonth={flowBounds(period).from} testid={`${testid}-range`} />
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5" style={{ borderColor: "var(--fin-border)" }}>
          <span className="text-sm" style={{ color: "var(--fin-ink)" }}>
            {!draft.from ? "Selecione a data inicial" : `${fmtDate(draft.from)} – ${draft.to ? fmtDate(draft.to) : "…"}`}
          </span>
          <button type="button" disabled={!draft.from || !draft.to} data-testid={`${testid}-range-apply`}
            onClick={() => { onPeriod({ mode: "personalizado", from: draft.from, to: draft.to }); setOpen(false); }}
            className="h-8 rounded-lg bg-[#16A34A] px-3 text-sm font-bold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
            Aplicar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PeriodStepper({ period, onPeriod, title, testid, compact }) {
  const fixo = ["personalizado", "todos"].includes(period.mode);   // sem próximo/anterior
  const arrow = (dir, Icon, label, id) => (
    <button type="button" disabled={fixo} onClick={() => onPeriod(shiftFlow(period, dir))} aria-label={label} data-testid={`${testid}-${id}`}
      title={fixo ? (period.mode === "todos" ? "Para navegar, escolha Mensal, Trimestral, Semestral ou Anual" : "Para mudar o intervalo, clique em Personalizado") : label}
      className={cn("flex h-full shrink-0 items-center justify-center transition-colors enabled:hover:bg-[var(--fin-muted-soft)] disabled:cursor-not-allowed disabled:opacity-40", compact ? "w-8" : "w-9")}>
      <Icon size={17} />
    </button>
  );
  return (
    <div className="inline-flex h-10 max-w-full items-stretch overflow-hidden rounded-lg border" data-testid={`${testid}-period`}
      style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink-2)" }}>
      {arrow(-1, ChevronLeft, "Período anterior", "prev")}
      <span className={cn("flex items-center justify-center whitespace-nowrap px-1 text-sm font-semibold", compact ? "min-w-[148px]" : "min-w-[176px]")} style={{ color: "var(--fin-ink)" }}
        data-testid={`${testid}-period-label`} aria-live="polite">{title}</span>
      {arrow(1, ChevronRight, "Próximo período", "next")}
    </div>
  );
}
