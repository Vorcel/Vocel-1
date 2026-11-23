import { useState } from "react";
import { Check, ChevronDown, Landmark, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BankLogo } from "./icons";
import { PeriodModes, PeriodStepper } from "./PeriodControls";
import { ChipSelect } from "./ui";

// Filtros do Fluxo de Caixa. A página é dona do estado (período, tags e bancos).
function FilterLabel({ children }) {
  return <p className="text-[13px] font-medium" style={{ color: "var(--fin-ink)" }}>{children}</p>;
}

// Vários bancos; nenhum marcado = todos (contas ativas). Inativas ficam no fim.
function BankMultiSelect({ value, onChange, contas }) {
  const [open, setOpen] = useState(false);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const options = [...contas].sort((a, b) => Number(b.ativo) - Number(a.ativo));
  const item = (key, selected, onClick, content) => (
    <li key={key}>
      <button type="button" role="option" aria-selected={selected} onClick={onClick} data-testid={`fin-flow-banks-opt-${key}`}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink)" }}>
        {content}
        {selected && <Check size={15} className="ml-auto shrink-0" style={{ color: "var(--fin-primary)" }} />}
      </button>
    </li>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="fin-flow-banks" aria-label="Bancos"
          className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1 rounded-lg border px-2.5 py-1 text-left text-sm"
          style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink)" }}>
          {!value.length && <span>Todos os bancos</span>}
          {value.map((id) => {
            const c = contas.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-1 text-[13px] font-medium"
                style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}>
                {c && <BankLogo item={c} size={18} />}<span className="truncate">{c?.nome || "Banco"}</span>
                <span role="button" tabIndex={0} title="Remover" aria-label={`Remover ${c?.nome || "banco"}`} className="rounded-full p-0.5 hover:bg-black/10"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(id); } }}><X size={12} /></span>
              </span>
            );
          })}
          <ChevronDown size={15} className="ml-auto shrink-0" style={{ color: "var(--fin-ink-3)" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="fin-scope w-[280px] max-w-[calc(100vw-24px)] p-2" style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
        <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
          {item("todos", !value.length, () => onChange([]), <><Landmark size={18} className="shrink-0" style={{ color: "var(--fin-ink-3)" }} /> Todos os bancos</>)}
          {options.map((c) => item(c.id, value.includes(c.id), () => toggle(c.id),
            <><BankLogo item={c} size={22} /><span className="truncate">{c.nome}{c.ativo ? "" : " (inativa)"}</span></>))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function CashFlowFilters({ period, onPeriod, title, tags, onTags, bancos, onBancos, contas, tagOptions }) {
  const options = [
    { value: "", label: "Todas" },
    ...tagOptions.map((t) => ({ value: t.id, label: `${t.nome}${t.ativo === false ? " (inativa)" : ""}`, color: t.cor || "#64748B" })),
  ];
  return (
    <section className="fin-card mt-5 space-y-3.5 px-5 py-4" data-testid="fin-flow-filters">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-0 max-w-full space-y-1.5">
          <FilterLabel>Período</FilterLabel>
          <PeriodModes period={period} onPeriod={onPeriod} testid="fin-flow" />
        </div>
        <PeriodStepper period={period} onPeriod={onPeriod} title={title} testid="fin-flow" />
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <FilterLabel>Bancos</FilterLabel>
          <BankMultiSelect value={bancos} onChange={onBancos} contas={contas} />
        </div>
      </div>
      <div className="space-y-1.5">
        <FilterLabel>Tags</FilterLabel>
        {/* "Todas" = nenhuma tag; escolher uma tag desmarca "Todas" e vice-versa. */}
        <ChipSelect multiple value={tags.length ? tags : [""]} options={options} maxCollapsed={Infinity} testid="fin-flow-tags"
          onChange={(v) => onTags(tags.length && v.includes("") ? [] : v.filter(Boolean))} />
      </div>
    </section>
  );
}
