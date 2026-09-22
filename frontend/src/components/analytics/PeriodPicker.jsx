import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MESES, MESES_ABREV, availableYears, defaultPeriod,
  monthPeriod, quarterPeriod, rangePeriod, yearPeriod,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

// Seletor hierárquico de período: Ano / Trimestre / Mês / Intervalo de meses.
// A seleção vive SÓ em memória (estado do React) — nunca em localStorage, nem em
// preferências do usuário, nem no banco. Recarregar a página volta ao ano corrente
// até hoje (ver defaultPeriod em lib/analytics.js).
const MODOS = [
  { id: "ano", label: "Ano" },
  { id: "trimestre", label: "Trimestre" },
  { id: "mes", label: "Mês" },
  { id: "intervalo", label: "Intervalo" },
];

const Chip = ({ active, children, ...props }) => (
  <button
    type="button"
    {...props}
    className={cn(
      "rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1687F8]/35",
      active
        ? "border-[#1687F8] bg-[#1687F8] text-white"
        : "border-[#DDE7F2] bg-[var(--an-surface)] text-[var(--an-label)] hover:border-[#1687F8]/50 hover:text-[var(--an-text)] dark:border-border"
    )}
  >
    {children}
  </button>
);

export function PeriodPicker({ period, label, onChange, bids = [] }) {
  const [open, setOpen] = useState(false);
  const hoje = useMemo(() => new Date(), []);
  const anos = useMemo(() => availableYears(bids, hoje), [bids, hoje]);
  const anoDoPeriodo = Number(String(period.start).slice(0, 4)) || hoje.getFullYear();
  const [ano, setAno] = useState(anoDoPeriodo);
  const [modo, setModo] = useState("ano");
  const [de, setDe] = useState(1);
  const [ate, setAte] = useState(Math.max(1, hoje.getMonth() + 1));

  useEffect(() => { if (open) setAno(anoDoPeriodo); }, [open, anoDoPeriodo]);

  const aplicar = (novo) => { onChange(novo); setOpen(false); };
  const ytd = defaultPeriod(hoje);
  const ehYtd = period.start === ytd.start && period.end === ytd.end;
  const mesesDoAno = ano === hoje.getFullYear() ? hoje.getMonth() + 1 : 12;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="analytics-period-trigger"
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] border border-[#DDE7F2] bg-[var(--an-surface)] px-2.5 text-[11px] font-semibold text-[var(--an-text)] transition-colors duration-150 hover:border-[#1687F8]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1687F8]/35 dark:border-border"
        >
          <CalendarRange size={14} className="shrink-0 text-[#1687F8]" />
          <span className="font-medium text-[var(--an-muted)]">Período:</span>
          <span className="max-w-[13rem] truncate">{label || "—"}</span>
          <ChevronDown size={13} className="shrink-0 text-[var(--an-muted)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="an-scope w-[min(22rem,calc(100vw-1.5rem))] p-3.5" data-testid="analytics-period-panel">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--an-muted)]">Ano</p>
            <div className="flex flex-wrap gap-2">
              {anos.map((y) => (
                <Chip key={y} active={y === ano} data-testid={`period-year-${y}`} onClick={() => setAno(y)}>{y}</Chip>
              ))}
            </div>
          </div>

          <div className="flex gap-1 rounded-[8px] bg-[var(--an-head-bg)] p-1">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                data-testid={`period-mode-${m.id}`}
                onClick={() => setModo(m.id)}
                className={cn(
                  "flex-1 rounded-[6px] px-2 py-1 text-[11px] font-semibold transition-colors duration-150",
                  modo === m.id
                    ? "bg-[var(--an-surface)] text-[var(--an-text)] shadow-sm"
                    : "text-[var(--an-muted)] hover:text-[var(--an-text)]"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {modo === "ano" && (
            <div className="flex flex-wrap gap-2">
              <Chip data-testid="period-year-full" onClick={() => aplicar(yearPeriod(ano))}>Ano inteiro de {ano}</Chip>
              {ano === hoje.getFullYear() && (
                <Chip active={ehYtd} data-testid="period-ytd" onClick={() => aplicar(defaultPeriod(hoje))}>
                  Até hoje (padrão)
                </Chip>
              )}
            </div>
          )}

          {modo === "trimestre" && (
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((q) => (
                <Chip key={q} data-testid={`period-quarter-${q}`} onClick={() => aplicar(quarterPeriod(ano, q))}>
                  {q}º trimestre
                </Chip>
              ))}
            </div>
          )}

          {modo === "mes" && (
            <div className="grid grid-cols-4 gap-2">
              {MESES.map((nome, i) => (
                <Chip key={nome} data-testid={`period-month-${i + 1}`} onClick={() => aplicar(monthPeriod(ano, i + 1))}>
                  {MESES_ABREV[i]}
                </Chip>
              ))}
            </div>
          )}

          {modo === "intervalo" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[["De", de, setDe, "period-range-from"], ["Até", ate, setAte, "period-range-to"]].map(([rot, valor, set, tid]) => (
                  <label key={rot} className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--an-muted)]">{rot}</span>
                    <select
                      data-testid={tid}
                      value={valor}
                      onChange={(e) => set(Number(e.target.value))}
                      className="h-8 w-full rounded-[8px] border border-[#DDE7F2] bg-[var(--an-surface)] px-2 text-[11px] text-[var(--an-text)] dark:border-border"
                    >
                      {MESES.map((nome, i) => (
                        <option key={nome} value={i + 1}>{nome}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[var(--an-muted)]">
                Intervalo contínuo de meses do mesmo ano — ex.: 3, 6 ou 10 meses.
              </p>
              <button
                type="button"
                data-testid="period-range-apply"
                onClick={() => aplicar(rangePeriod(ano, de, ate))}
                className="h-8 w-full rounded-[8px] bg-[#1687F8] text-[11px] font-bold text-white transition-colors duration-150 hover:bg-[#0F63C4]"
              >
                Aplicar intervalo
              </button>
            </div>
          )}

          {modo !== "intervalo" && ano === hoje.getFullYear() && (
            <p className="text-[10px] text-[var(--an-muted)]">
              Meses futuros não entram nas análises — o ano corrente vai até {MESES_ABREV[mesesDoAno - 1]}.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
