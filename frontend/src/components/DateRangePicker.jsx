import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const toDate = (s) => (s ? new Date(s + "T00:00:00") : undefined);
const toStr = (d) => (d ? format(d, "yyyy-MM-dd") : "");

// Date RANGE picker. value = { from: 'YYYY-MM-DD'|'', to: 'YYYY-MM-DD'|'' }
export const DateRangePicker = ({ value, onChange, testid = "date-range", className }) => {
  const [open, setOpen] = useState(false);
  const from = value?.from ? toDate(value.from) : undefined;
  const to = value?.to ? toDate(value.to) : undefined;

  const label = () => {
    if (from && to) return `${format(from, "dd/MM/yyyy")} até ${format(to, "dd/MM/yyyy")}`;
    if (from) return `${format(from, "dd/MM/yyyy")} até ...`;
    return "Selecionar período";
  };

  const handleSelect = (range) => {
    onChange({ from: toStr(range?.from), to: toStr(range?.to) });
    if (range?.from && range?.to) setOpen(false);
  };

  const clear = (e) => { e.stopPropagation(); onChange({ from: "", to: "" }); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className={cn(
            "flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:border-brand/50",
            className
          )}
        >
          <CalendarIcon size={15} className="shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !from && "text-muted-foreground")}>{label()}</span>
          {(from || to) && (
            <span onClick={clear} className="ml-auto cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`${testid}-clear`}>
              <X size={14} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={handleSelect}
          numberOfMonths={2}
          locale={ptBR}
          defaultMonth={from}
        />
      </PopoverContent>
    </Popover>
  );
};
