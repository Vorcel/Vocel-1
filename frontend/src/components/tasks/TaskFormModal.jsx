import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import api, { formatApiError } from "@/lib/api";
const normalizeSearch = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks";
import { useResponsibles } from "@/components/tasks/useTasks";
import { cn } from "@/lib/utils";

const NONE = "__none__";
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const empty = () => ({
  title: "", responsible_id: "", status: "pendente", priority: "media",
  due_date: todayStr(), due_time: "", bid_id: "", notes: "",
});
const fromTask = (t) => ({
  title: t.title || "", responsible_id: t.responsible_id || "", status: t.status || "pendente",
  priority: t.priority || "media", due_date: t.due_date || "", due_time: t.due_time || "",
  bid_id: t.bid_id || "", notes: t.notes || "",
});

const bidLabel = (b) => [b.pregao ? `PE ${b.pregao}` : "", b.objeto].filter(Boolean).join(" — ") || "Licitação";

// Vínculo opcional com uma licitação da conta: busca por pregão/objeto/UASG.
function BidPicker({ value, fallbackLabel, onChange }) {
  const { bids } = useData();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = bids.find((b) => b.id === value);
  const results = useMemo(() => {
    const n = normalizeSearch(q);
    const list = [...bids].sort((a, b) => String(b.data_disputa || "").localeCompare(String(a.data_disputa || "")));
    return (n ? list.filter((b) => normalizeSearch(`${b.pregao} ${b.objeto} ${b.uasg} ${b.orgao || ""}`).includes(n)) : list).slice(0, 40);
  }, [bids, q]);

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" data-testid="task-bid-picker"
            className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {selected ? bidLabel(selected) : value ? fallbackLabel || "Licitação vinculada" : "Nenhuma (tarefa geral)"}
            </span>
            <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(460px,90vw)] p-0">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={14} className="text-muted-foreground" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por pregão, objeto ou UASG…"
              data-testid="task-bid-search" className="h-10 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1" role="listbox">
            {results.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhuma licitação encontrada.</p>}
            {results.map((b) => (
              <button key={b.id} type="button" role="option" aria-selected={b.id === value}
                onClick={() => { onChange(b.id); setOpen(false); setQ(""); }}
                data-testid={`task-bid-option-${b.id}`}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <Check size={13} className={cn("shrink-0", b.id === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{bidLabel(b)}</span>
                {b.data_disputa && <span className="shrink-0 font-mono-num text-[11px] text-muted-foreground">{b.data_disputa.split("-").reverse().join("/")}</span>}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Remover vínculo" data-testid="task-bid-clear"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// Modal Nova tarefa / Editar tarefa. Na edição só vão para o backend os campos
// alterados (as permissões são por campo: status x demais dados).
export function TaskFormModal({ open, onOpenChange, task = null, onSaved }) {
  const { can } = useAuth();
  const responsibles = useResponsibles(open);
  const editing = !!task;
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const initial = useRef(empty());

  useEffect(() => {
    if (!open) return;
    const f = task ? fromTask(task) : empty();
    initial.current = f;
    setForm(f);
    setTried(false);
  }, [open, task]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canEditFields = editing ? can("tasks.edit") : can("tasks.create");
  const canStatus = can("tasks.complete");
  const canSeeBids = can("licitacoes.view");

  // Responsável inativo já gravado na tarefa: continua selecionado (histórico),
  // mas só nesta tarefa — a lista de opções novas tem apenas os ativos.
  const responsibleOptions = useMemo(() => {
    const list = [...responsibles];
    if (task?.responsible_id && !list.some((a) => a.id === task.responsible_id)) {
      list.push({ id: task.responsible_id, name: `${task.responsible_name || "Responsável"} (inativo)` });
    }
    return list;
  }, [responsibles, task]);

  const missing = {
    title: !form.title.trim(),
    due_date: !form.due_date,
    due_time: !/^\d{2}:\d{2}$/.test(form.due_time),
  };
  const invalid = Object.values(missing).some(Boolean);

  const save = async () => {
    setTried(true);
    if (invalid || saving) return;
    setSaving(true);
    try {
      const payload = { ...form, title: form.title.trim(), responsible_id: form.responsible_id || null, bid_id: form.bid_id || null };
      if (editing) {
        const changed = {};
        Object.keys(payload).forEach((k) => {
          const before = initial.current[k] || null;
          const after = payload[k] || null;
          if (before !== after) changed[k] = payload[k] ?? null;
        });
        if (Object.keys(changed).length) await api.put(`/tasks/${task.id}`, changed);
        toast.success("Tarefa atualizada.");
      } else {
        await api.post("/tasks", payload);
        toast.success("Tarefa criada.");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const quickStatus = async (status) => {
    setSaving(true);
    try {
      await api.put(`/tasks/${task.id}`, { status });
      toast.success(status === "concluida" ? "Tarefa concluída." : "Tarefa reaberta.");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tasks/${task.id}`);
      toast.success("Tarefa excluída.");
      setConfirmDelete(false);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setDeleting(false);
    }
  };

  const err = (k) => tried && missing[k];
  const done = task?.status === "concluida";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="task-modal" className="max-h-[90vh] w-[min(600px,94vw)] max-w-[94vw] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="font-heading text-[17px] font-bold">{editing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
            <DialogDescription className="text-xs">
              {editing && task.created_by_name ? `Criada por ${task.created_by_name}` : "Campos com * são obrigatórios."}
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={!canEditFields && !canStatus} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Descrição *</Label>
              <Input id="task-title" data-testid="task-title" value={form.title} disabled={!canEditFields}
                onChange={(e) => set("title", e.target.value)} maxLength={300}
                placeholder="Ex.: Despachar produto para a transportadora"
                aria-invalid={err("title")} className={cn(err("title") && "border-alert focus-visible:ring-alert")} />
            </div>

            <div className="grid gap-3.5 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Responsável</Label>
                <Select value={form.responsible_id || NONE} onValueChange={(v) => set("responsible_id", v === NONE ? "" : v)} disabled={!canEditFields}>
                  <SelectTrigger data-testid="task-responsible"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem responsável</SelectItem>
                    {responsibleOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status *</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)} disabled={!canStatus}>
                  <SelectTrigger data-testid="task-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => set("priority", v)} disabled={!canEditFields}>
                  <SelectTrigger data-testid="task-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Data final *</Label>
                <div className={cn(!canEditFields && "pointer-events-none opacity-60")}>
                  <DatePickerInput testid="task-due-date" value={form.due_date} onChange={(v) => set("due_date", v)} invalid={err("due_date")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due-time">Horário final *</Label>
                <Input id="task-due-time" type="time" data-testid="task-due-time" value={form.due_time} disabled={!canEditFields}
                  onChange={(e) => set("due_time", e.target.value)} aria-invalid={err("due_time")}
                  className={cn(err("due_time") && "border-alert focus-visible:ring-alert")} />
              </div>
            </div>

            {(canSeeBids || form.bid_id) && (
              <div className="space-y-1.5">
                <Label>Vínculo com licitação</Label>
                {canSeeBids && canEditFields ? (
                  <BidPicker value={form.bid_id} fallbackLabel={task?.bid_label} onChange={(v) => set("bid_id", v)} />
                ) : (
                  <p className="rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">{task?.bid_label || "Nenhuma"}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="task-notes">Observação</Label>
              <Textarea id="task-notes" data-testid="task-notes" rows={3} maxLength={4000} value={form.notes} disabled={!canEditFields}
                onChange={(e) => set("notes", e.target.value)} placeholder="Detalhes adicionais (opcional)" />
            </div>
          </fieldset>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {editing && can("tasks.delete") && (
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)} data-testid="task-delete"
                className="border-alert/40 text-alert hover:bg-alert/10 hover:text-alert">
                <Trash2 size={14} className="mr-1.5" /> Excluir
              </Button>
            )}
            {editing && canStatus && (
              <Button type="button" variant="outline" disabled={saving} data-testid={done ? "task-reopen" : "task-complete"}
                onClick={() => quickStatus(done ? "pendente" : "concluida")}>
                {done ? <><RotateCcw size={14} className="mr-1.5" /> Reabrir</> : <><Check size={14} className="mr-1.5" /> Concluir</>}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {tried && invalid && <span className="text-xs text-alert">Preencha os campos obrigatórios</span>}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="task-cancel">Cancelar</Button>
              {(canEditFields || canStatus) && (
                <Button type="button" onClick={save} disabled={saving} data-testid="task-save" className="bg-brand hover:bg-brand-hover">
                  {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />} Salvar
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir tarefa?"
        description={`Tem certeza de que deseja excluir a tarefa "${task?.title || ""}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        loading={deleting}
        onConfirm={remove}
        testid="task-confirm-delete"
      />
    </>
  );
}
