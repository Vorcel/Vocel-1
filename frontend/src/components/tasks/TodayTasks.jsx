import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronUp, Plus } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePersistentPageSize } from "@/hooks/usePersistentPageSize";
import { HOME_SCOPES } from "@/lib/tasks";
import { TaskTable } from "@/components/tasks/TaskTable";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { useNow, useTaskStatus } from "@/components/tasks/useTasks";
import { cn } from "@/lib/utils";

const COLLAPSED = 5;
const EXPANDED = 10;   // teto da home — o resto fica em "Ver todas as tarefas"
const EMPTY = { todos: "Nenhuma tarefa em aberto.", hoje: "Nenhuma tarefa para hoje.", amanha: "Nenhuma tarefa para amanhã.", proximos2: "Nenhuma tarefa nos próximos 2 dias.", semana: "Nenhuma tarefa nesta semana." };

// Pílula de filtro (ref2): selecionada = preenchida; demais = contorno discreto.
export const ScopePill = ({ active, onClick, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    data-testid={testid}
    className={cn(
      "h-7 whitespace-nowrap rounded-md border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
      active
        ? "border-[#4F46E5] bg-[#4F46E5] text-white shadow-sm"
        : "border-border bg-card text-foreground/80 hover:bg-accent"
    )}
  >
    {children}
  </button>
);

export const NewTaskButton = ({ onClick, testid = "new-task-button" }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testid}
    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-50/60 px-3.5 text-[13px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
  >
    <Plus size={16} /> Nova tarefa
  </button>
);

// Bloco "Tarefas do Dia" da página inicial: resumo operacional (nunca > 10).
// O backend devolve só o necessário (até 10 do filtro + contadores dos 3 filtros).
export function TodayTasks() {
  const { can } = useAuth();
  const now = useNow();
  const [scope, setScope] = useState("todos"); // filtro NÃO persiste: toda abertura/F5 volta para Todos
  const [data, setData] = useState({ items: [], counts: {}, total: 0, today: null });
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState({ open: false, task: null });
  // 5 / 10 por usuário, salvo nas preferências (table_page_sizes.home_tasks) — sobrevive ao F5.
  const [size, setSize] = usePersistentPageSize("home_tasks", COLLAPSED);
  const expanded = size >= EXPANDED;

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const { data: d } = await api.get("/tasks/summary", { params: { scope, limit: EXPANDED } });
      if (id === reqId.current) { setData(d); setLoaded(true); }
    } catch { /* 403/rede: bloco fica como está */ }
  }, [scope]);

  useEffect(() => { load(); }, [load]);
  // Atualiza sozinho: a cada 5 min, ao voltar para a aba e na virada do dia.
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onFocus); };
  }, [load]);
  const dayKey = now.toDateString();
  const firstDay = useRef(dayKey);
  useEffect(() => {
    if (dayKey !== firstDay.current) { firstDay.current = dayKey; load(); }
  }, [dayKey, load]);

  const onStatus = useTaskStatus(load);
  const visible = data.items.slice(0, expanded ? EXPANDED : COLLAPSED);
  const total = data.total || 0;

  return (
    <section data-testid="today-tasks" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={22} className="text-emerald-600" aria-hidden />
          <h2 className="font-heading text-lg font-bold text-foreground">Tarefas do Dia</h2>
          <span data-testid="today-tasks-count" className="min-w-[22px] rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-semibold text-foreground/80">
            {total}
          </span>
        </div>
        <div role="group" aria-label="Filtrar tarefas por data" className="flex flex-wrap items-center gap-1.5">
          {HOME_SCOPES.map((s) => (
            <ScopePill key={s.key} active={scope === s.key} onClick={() => setScope(s.key)} testid={`today-tasks-scope-${s.key}`}>
              {s.label} ({data.counts?.[s.key] ?? 0})
            </ScopePill>
          ))}
        </div>
        {can("tasks.create") && (
          <div className="ml-auto"><NewTaskButton onClick={() => setModal({ open: true, task: null })} /></div>
        )}
      </div>

      <TaskTable
        tasks={loaded ? visible : []}
        now={now}
        onEdit={(t) => setModal({ open: true, task: t })}
        onStatus={onStatus}
        testid="today-tasks-table"
        emptyText={loaded ? EMPTY[scope] : "Carregando…"}
      />

      <div className="mt-2.5 flex items-center justify-between gap-3">
        {total > COLLAPSED ? (
          <button
            type="button"
            onClick={() => setSize(expanded ? COLLAPSED : EXPANDED)}
            aria-expanded={expanded}
            aria-label={expanded ? "Mostrar até 5 tarefas" : "Mostrar até 10 tarefas"}
            data-testid="today-tasks-toggle"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? "Mostrar menos" : `Mostrar mais (${Math.min(total, EXPANDED) - COLLAPSED})`}
          </button>
        ) : <span />}
        <Link to="/tarefas" data-testid="today-tasks-see-all"
          className="text-[13px] font-medium text-[#1D4ED8] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:text-sky-400">
          Ver todas as tarefas
        </Link>
      </div>

      <TaskFormModal open={modal.open} task={modal.task} onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))} onSaved={load} />
    </section>
  );
}
