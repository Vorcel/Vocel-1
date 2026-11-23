import { useState } from "react";
import { addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

// Calendário de INTERVALO (ref3), um mês só. Cliques: 1º = início, 2º = fim
// (antes do início inverte; no mesmo dia = um dia), 3º = limpa a seleção.
// Com só o início marcado, a faixa acompanha o mouse até o dia apontado.
// value/onChange em { from, to } ISO "YYYY-MM-DD" ("" = não escolhido).
const toDate = (s) => (s ? new Date(`${s}T00:00:00`) : undefined);
const toStr = (d) => format(d, "yyyy-MM-dd");
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function RangeCalendar({ value, onChange, defaultMonth, testid = "range-calendar" }) {
  const { from, to } = value;
  const [month, setMonth] = useState(() => toDate(to || from || defaultMonth) || new Date());
  const [hover, setHover] = useState("");

  const click = (day) => {
    const d = toStr(day);
    setHover("");
    if (from && to) onChange({ from: "", to: "" });
    else if (!from) onChange({ from: d, to: "" });
    else onChange(d < from ? { from: d, to: from } : { from, to: d });
  };
  const fim = to || (from && hover) || from;
  const [a, b] = from && fim < from ? [fim, from] : [from, fim];
  const ponta = (d) => !!from && (toStr(d) === from || (!!to && toStr(d) === to));
  const meio = (d) => !!from && toStr(d) >= a && toStr(d) <= b && !ponta(d);

  const nav = (n, Icon, label, id) => (
    <button type="button" onClick={() => setMonth((m) => addMonths(m, n))} title={label} aria-label={label} data-testid={`${testid}-${id}`}
      className="flex h-8 w-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent">
      <Icon size={17} />
    </button>
  );
  return (
    <div data-testid={testid} onMouseLeave={() => setHover("")}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex">{nav(-12, ChevronsLeft, "Ano anterior", "prev-year")}{nav(-1, ChevronLeft, "Mês anterior", "prev")}</div>
        <span className="text-sm font-bold text-foreground" aria-live="polite" data-testid={`${testid}-month`}>{cap(format(month, "MMMM yyyy", { locale: ptBR }))}</span>
        <div className="flex">{nav(1, ChevronRight, "Próximo mês", "next")}{nav(12, ChevronsRight, "Próximo ano", "next-year")}</div>
      </div>
      <DayPicker
        month={month} onMonthChange={setMonth} locale={ptBR} disableNavigation
        formatters={{ formatWeekdayName: (d) => format(d, "EEEEE", { locale: ptBR }) }}
        components={{ Caption: () => null }}
        onDayClick={click}
        onDayMouseEnter={(d) => from && !to && setHover(toStr(d))}
        selected={(d) => ponta(d) || meio(d)}
        modifiers={{ ponta, meio }}
        modifiersClassNames={{
          ponta: "!rounded-lg !bg-[#16A34A] font-bold !text-white",
          meio: "!rounded-none bg-[#16A34A]/15",
        }}
        classNames={{
          months: "", month: "", table: "w-full border-collapse",
          head_row: "flex", head_cell: "h-8 flex-1 text-center text-xs font-normal leading-8 text-muted-foreground",
          row: "mt-0.5 flex", cell: "flex-1 p-0 text-center",
          day: "h-9 w-full rounded-lg text-sm outline-none transition-colors hover:bg-[#16A34A]/20 focus-visible:ring-2 focus-visible:ring-[#16A34A]",
          day_today: "font-bold text-[#16A34A]", day_hidden: "invisible",
        }}
      />
    </div>
  );
}
