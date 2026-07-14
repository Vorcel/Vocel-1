import { useEffect, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const toDate = (s) => (s ? new Date(s.slice(0, 10) + "T00:00:00") : undefined);

// Máscara progressiva DD/MM/AAAA enquanto digita.
const mask = (t) => {
  const d = t.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

// Campo de data única: digitação manual (DD/MM/AAAA) + mini calendário no ícone.
// value/onChange em ISO "YYYY-MM-DD", tratado como data de calendário (sem
// horário/UTC). Datas impossíveis (ex.: 31/02) são rejeitadas pelo parse.
export const DatePickerInput = ({ value, onChange, testid = "date-input", className, invalid }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? format(toDate(value), "dd/MM/yyyy") : "");

  // Sincroniza o texto quando o valor muda por fora (calendário / reabertura).
  useEffect(() => {
    if (value) setText(format(toDate(value), "dd/MM/yyyy"));
  }, [value]);

  const commit = (raw) => {
    const t = mask(raw);
    setText(t);
    if (t.length === 10) {
      const parsed = parse(t, "dd/MM/yyyy", new Date());
      if (isValid(parsed)) {
        onChange(format(parsed, "yyyy-MM-dd"));
        return;
      }
    }
    onChange("");
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        data-testid={testid}
        value={text}
        onChange={(e) => commit(e.target.value)}
        placeholder="DD/MM/AAAA"
        inputMode="numeric"
        className={cn("pr-9", invalid && "border-alert focus-visible:ring-alert")}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={`${testid}-calendar`}
            title="Abrir calendário"
            className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CalendarIcon size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={toDate(value)}
            onSelect={(d) => {
              if (d) {
                onChange(format(d, "yyyy-MM-dd"));
                setOpen(false);
              }
            }}
            locale={ptBR}
            defaultMonth={toDate(value)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
