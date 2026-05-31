import { useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useData } from "@/context/DataContext";
import { toast } from "sonner";

// Select with an inline "+" to add a new option to a managed list (modalidades/portais).
export const SelectWithAdd = ({ listType, value, onChange, placeholder, testid }) => {
  const { lists, addListItem } = useData();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [cor, setCor] = useState("#0C7B93");
  const options = lists[listType] || [];

  const confirm = async () => {
    const v = text.trim();
    if (!v) return;
    try {
      await addListItem(listType, v, cor);
      onChange(v);
      setText("");
      setAdding(false);
      toast.success("Item adicionado");
    } catch {
      toast.error("Não foi possível adicionar");
    }
  };

  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          data-testid={`${testid}-new-input`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), confirm())}
          placeholder="Digite o novo item"
        />
        <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} data-testid={`${testid}-new-color`} className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5" title="Cor" />
        <button type="button" onClick={confirm} data-testid={`${testid}-new-confirm`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover">
          <Check size={16} />
        </button>
        <button type="button" onClick={() => setAdding(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testid} className="flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.nome} value={o.nome}>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.cor }} />
                {o.nome}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="button" onClick={() => setAdding(true)} data-testid={`${testid}-add`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-brand hover:bg-brand/10" title="Adicionar novo">
        <Plus size={16} />
      </button>
    </div>
  );
};
