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
  const options = lists[listType] || [];

  const confirm = async () => {
    const v = text.trim();
    if (!v) return;
    try {
      await addListItem(listType, v);
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
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="button" onClick={() => setAdding(true)} data-testid={`${testid}-add`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-brand hover:bg-brand/10" title="Adicionar novo">
        <Plus size={16} />
      </button>
    </div>
  );
};
