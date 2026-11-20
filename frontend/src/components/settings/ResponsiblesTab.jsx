import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { initialOf } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Configurações › Responsáveis: cadastro PRÓPRIO de quem pode ser responsável por
// tarefas. Não são usuários do sistema (sem login, senha, e-mail ou permissões).
// Sem exclusão: inativar tira das novas tarefas e preserva o histórico.
function ResponsibleModal({ open, onOpenChange, item, onSaved }) {
  const { can } = useAuth();
  const editing = !!item;
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name || "");
    setActive(item ? item.active : true);
    setTried(false);
  }, [open, item]);

  const canName = editing ? can("task_responsibles.edit") : can("task_responsibles.create");
  const canActive = editing ? can("task_responsibles.deactivate") : can("task_responsibles.create");

  const save = async () => {
    setTried(true);
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (editing) {
        const body = {};
        if (name.trim() !== item.name) body.name = name.trim();
        if (active !== item.active) body.active = active;
        if (Object.keys(body).length) await api.put(`/tasks/responsibles/${item.id}`, body);
        toast.success("Responsável atualizado.");
      } else {
        await api.post("/tasks/responsibles", { name: name.trim(), active });
        toast.success("Responsável cadastrado.");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="responsible-modal" className="w-[min(440px,94vw)] max-w-[94vw]">
        <DialogHeader className="text-left">
          <DialogTitle className="font-heading text-[17px] font-bold">{editing ? "Editar responsável" : "Novo responsável"}</DialogTitle>
          <DialogDescription className="text-xs">Aparece como opção no campo Responsável das tarefas. Não acessa o Vorcel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="responsible-name">Nome *</Label>
            <Input id="responsible-name" data-testid="responsible-name" value={name} maxLength={120} disabled={!canName}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="Ex.: Betânia" aria-invalid={tried && !name.trim()}
              className={cn(tried && !name.trim() && "border-alert focus-visible:ring-alert")} />
          </div>
          <label className="flex w-fit cursor-pointer items-center gap-3">
            <Switch checked={active} onCheckedChange={setActive} disabled={!canActive} data-testid="responsible-active" aria-label="Responsável ativo" />
            <span className="text-[13px] font-semibold text-foreground">Ativo</span>
          </label>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          {tried && !name.trim() && <span className="mr-auto text-xs text-alert">Informe o nome</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="responsible-cancel">Cancelar</Button>
          <Button onClick={save} disabled={saving} data-testid="responsible-save" className="bg-brand hover:bg-brand-hover">
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResponsiblesTab() {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState({ open: false, item: null });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/tasks/responsibles", { params: { all: true } });
      setItems(data);
    } catch { /* 403: aba nem aparece sem permissão */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r) => {
    setBusyId(r.id);
    try {
      await api.put(`/tasks/responsibles/${r.id}`, { active: !r.active });
      toast.success(r.active ? `${r.name} inativado.` : `${r.name} reativado.`);
      load();
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6" data-testid="responsibles-section">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Responsáveis de tarefas</h2>
          <p className="text-sm text-muted-foreground">
            Pessoas que podem ser escolhidas como responsáveis nas tarefas. Não são usuários do sistema: não fazem login nem têm permissões.
          </p>
        </div>
        {can("task_responsibles.create") && (
          <Button onClick={() => setModal({ open: true, item: null })} data-testid="responsible-new" className="bg-brand hover:bg-brand-hover">
            <Plus size={16} className="mr-1.5" /> Novo responsável
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[460px] text-sm" data-testid="responsibles-table">
          <thead>
            <tr className="bg-muted/60 text-left text-[12.5px] font-semibold text-foreground/80">
              <th className="px-4 py-2">Nome</th>
              <th className="w-[140px] px-4 py-2">Status</th>
              <th className="w-[220px] px-4 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loaded && items.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum responsável cadastrado.</td></tr>
            )}
            {items.map((r) => (
              <tr key={r.id} className="border-t border-border" data-testid={`responsible-row-${r.id}`}>
                <td className="px-4 py-2">
                  <span className={cn("flex items-center gap-2.5", !r.active && "text-muted-foreground")}>
                    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {initialOf(r.name)}
                    </span>
                    <span className="font-medium">{r.name}</span>
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-[12px] font-medium",
                    r.active ? "border-border bg-card text-foreground/80" : "border-border bg-muted text-muted-foreground")}>
                    {r.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    {can("task_responsibles.edit") && (
                      <Button variant="outline" size="sm" onClick={() => setModal({ open: true, item: r })} data-testid={`responsible-edit-${r.id}`}>
                        <Pencil size={13} className="mr-1.5" /> Editar
                      </Button>
                    )}
                    {can("task_responsibles.deactivate") && (
                      <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => toggle(r)} data-testid={`responsible-toggle-${r.id}`}>
                        {busyId === r.id ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Power size={13} className="mr-1.5" />}
                        {r.active ? "Inativar" : "Ativar"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Responsável inativo some das novas tarefas, mas continua aparecendo nas tarefas antigas.</p>

      <ResponsibleModal open={modal.open} item={modal.item} onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))} onSaved={load} />
    </div>
  );
}
