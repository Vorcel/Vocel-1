import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/DateRangePicker";
import { TaskTable } from "@/components/tasks/TaskTable";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { ScopePill, NewTaskButton } from "@/components/tasks/TodayTasks";
import { useResponsibles, useNow, useTaskStatus } from "@/components/tasks/useTasks";
import { usePersistentPageSize, PAGE_SIZE_OPTIONS } from "@/hooks/usePersistentPageSize";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { PAGE_SCOPES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks";

const ALL = "__all__";

// Página completa de Tarefas: filtros e paginação feitos no backend.
export default function Tasks() {
  const { can } = useAuth();
  const now = useNow();
  const responsibles = useResponsibles();
  const [scope, setScope] = useState("todas");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [responsible, setResponsible] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentPageSize("tasks", 10);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState({ open: false, task: null });

  useEffect(() => {
    const t = setTimeout(() => setQDeb(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [scope, qDeb, responsible, status, priority, period.from, period.to, pageSize]);

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    const params = {
      scope, page, page_size: pageSize,
      q: qDeb || undefined,
      responsible: responsible === ALL ? undefined : responsible,
      status: status === ALL ? undefined : status,
      priority: priority === ALL ? undefined : priority,
      date_from: period.from || undefined,
      date_to: period.to || undefined,
    };
    try {
      const { data: d } = await api.get("/tasks", { params });
      if (id === reqId.current) { setData(d); setLoaded(true); }
    } catch { /* noop */ }
  }, [scope, page, pageSize, qDeb, responsible, status, priority, period.from, period.to]);
  useEffect(() => { load(); }, [load]);

  const onStatus = useTaskStatus(load);
  const total = data.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <>
      <Header title="Tarefas" subtitle="Organize e acompanhe as atividades da equipe." />
      <main className="p-6">
        <section data-testid="tasks-page" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="group" aria-label="Filtrar tarefas por data" className="flex flex-wrap items-center gap-1.5">
              {PAGE_SCOPES.map((s) => (
                <ScopePill key={s.key} active={scope === s.key} onClick={() => setScope(s.key)} testid={`tasks-scope-${s.key}`}>
                  {s.label}
                </ScopePill>
              ))}
            </div>
            {can("tasks.create") && (
              <div className="ml-auto"><NewTaskButton onClick={() => setModal({ open: true, task: null })} testid="tasks-new-button" /></div>
            )}
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_170px_150px_140px_230px]">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefa, observação, licitação…"
                data-testid="tasks-search" aria-label="Buscar tarefas" className="pl-9" />
            </div>
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger data-testid="tasks-filter-responsible" aria-label="Responsável"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os responsáveis</SelectItem>
                <SelectItem value="none">Sem responsável</SelectItem>
                {responsibles.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="tasks-filter-status" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger data-testid="tasks-filter-priority" aria-label="Prioridade"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas prioridades</SelectItem>
                {TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <DateRangePicker value={period} onChange={setPeriod} testid="tasks-filter-period" />
          </div>

          <TaskTable
            tasks={loaded ? data.items : []}
            now={now}
            showDetails
            onEdit={(t) => setModal({ open: true, task: t })}
            onStatus={onStatus}
            testid="tasks-table"
            emptyText={loaded ? "Nenhuma tarefa encontrada." : "Carregando…"}
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <span data-testid="tasks-range">{rangeStart}-{rangeEnd} de {total} tarefas</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span>Por página</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-7 w-16" data-testid="tasks-page-size"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <button data-testid="tasks-page-prev" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40"><ChevronLeft size={15} /></button>
                <span className="px-1 font-medium text-foreground">{page} / {totalPages}</span>
                <button data-testid="tasks-page-next" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40"><ChevronRight size={15} /></button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <TaskFormModal open={modal.open} task={modal.task} onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))} onSaved={load} />
    </>
  );
}
