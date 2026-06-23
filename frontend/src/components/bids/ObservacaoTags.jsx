import { useState } from "react";
import { Plus, X, Check } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hexToRgba, tagColorAt } from "@/lib/constants";
import { smartTitleCase } from "@/lib/textcase";

let _tid = 0;
const newId = () => `obs_${Date.now()}_${_tid++}`;

// Sistema de observações em tags/chips coloridos: adicionar (+), editar inline
// (clique no texto) e excluir (X) com modal de confirmação. Componente controlado.
export const ObservacaoTags = ({ value = [], onChange, testid = "obs" }) => {
  const tags = Array.isArray(value) ? value : [];
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  const commitEdit = (id) => {
    const t = smartTitleCase(draft.trim());
    onChange(t ? tags.map((tg) => (tg.id === id ? { ...tg, text: t } : tg)) : tags.filter((tg) => tg.id !== id));
    setEditingId(null);
  };
  const addTag = () => {
    const t = smartTitleCase(newText.trim());
    if (t) onChange([...tags, { id: newId(), text: t, color: tagColorAt(tags.length) }]);
    setNewText("");
    setAdding(false);
  };
  const confirmDelete = () => {
    if (pendingDelete) onChange(tags.filter((tg) => tg.id !== pendingDelete.id));
    setPendingDelete(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testid}-tags`}>
      {tags.map((tg, i) => {
        const color = tg.color || tagColorAt(i);
        const style = { backgroundColor: hexToRgba(color, 0.15), borderColor: hexToRgba(color, 0.45), color: "#1A1A1A" };
        if (editingId === tg.id) {
          return (
            <span key={tg.id} className="inline-flex items-center rounded-full border px-2 py-0.5" style={style}>
              <input
                autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(tg.id); } if (e.key === "Escape") setEditingId(null); }}
                onBlur={() => commitEdit(tg.id)}
                data-testid={`${testid}-edit-input`}
                className="w-24 bg-transparent text-xs outline-none"
              />
            </span>
          );
        }
        return (
          <span key={tg.id} data-testid={`${testid}-tag`} style={style}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
            <button type="button" onClick={() => { setDraft(tg.text); setEditingId(tg.id); }} className="max-w-[140px] truncate" title="Clique para editar">
              {tg.text}
            </button>
            <button type="button" data-testid={`${testid}-remove`} onClick={() => setPendingDelete(tg)} className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-black/10" title="Excluir">
              <X size={11} />
            </button>
          </span>
        );
      })}

      {adding ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/50 px-2 py-0.5">
          <input
            autoFocus value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } if (e.key === "Escape") { setNewText(""); setAdding(false); } }}
            onBlur={addTag} placeholder="Observação..." data-testid={`${testid}-add-input`}
            className="w-28 bg-transparent text-xs outline-none"
          />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addTag} className="text-emerald-600" title="Adicionar"><Check size={12} /></button>
        </span>
      ) : (
        <button type="button" data-testid={`${testid}-add`} onClick={() => setAdding(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand" title="Adicionar observação">
          <Plus size={13} />
        </button>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent data-testid={`${testid}-delete-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir observação?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir “{pendingDelete?.text}”? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testid}-delete-cancel`}>Cancelar</AlertDialogCancel>
            <AlertDialogAction data-testid={`${testid}-delete-confirm`} onClick={confirmDelete}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
