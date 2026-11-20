import { useNavigate } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, Clock, AlertTriangle, AlarmClock } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import {
  TASK_STATUSES, statusLabel, priorityLabel, deadlineInfo, formatDueFull, initialOf, avatarColor, pregaoTag,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Tabela de tarefas compartilhada pela home (Tarefas do Dia) e pela página
// Tarefas. Colunas FIXAS nesta ordem: Tarefa · Responsável · Status ·
// Prioridade · Prazo · Data final.

export const COLS = ["Tarefa", "Responsável", "Status", "Prioridade", "Prazo", "Data final"];

// Responsável: bolinha com a inicial + nome. Vazio = "—".
export const Assignee = ({ id, name }) =>
  name ? (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: avatarColor(id || name) }}
      >
        {initialOf(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

// Status NEUTRO (não compete com Prioridade/Prazo): cinza/branco com borda discreta.
const STATUS_STYLE = {
  pendente: "border-border bg-card text-foreground/80",
  em_andamento: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200",
  concluida: "border-border bg-muted/60 text-muted-foreground",
};
const StatusDot = ({ status }) =>
  status === "concluida" ? <Check size={12} className="shrink-0" /> :
  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status === "em_andamento" ? "bg-slate-500" : "bg-slate-300 dark:bg-slate-500")} />;

export const StatusPill = ({ task, canChange, onChange, testid }) => {
  const pill = (
    <span className={cn(
      "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium",
      STATUS_STYLE[task.status] || STATUS_STYLE.pendente
    )}>
      <StatusDot status={task.status} />
      {statusLabel(task.status)}
      {canChange && <ChevronDown size={12} className="opacity-60" />}
    </span>
  );
  if (!canChange) return pill;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid={testid} aria-label={`Status: ${statusLabel(task.status)}. Alterar status`}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
          {pill}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {TASK_STATUSES.map((s) => (
          <DropdownMenuItem key={s.value} data-testid={`${testid}-${s.value}`}
            onSelect={() => s.value !== task.status && onChange(s.value)} className="gap-2 text-[13px]">
            <StatusDot status={s.value} />
            {s.label}
            {s.value === task.status && <Check size={13} className="ml-auto text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Prioridade: única coluna (além do prazo) com cor — badge pequena e suave.
const PRIORITY_STYLE = {
  baixa: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  media: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  alta: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
};
export const PriorityBadge = ({ priority }) => (
  <span className={cn("inline-flex h-6 min-w-[56px] items-center justify-center rounded-md px-2 text-[12px] font-medium", PRIORITY_STYLE[priority] || PRIORITY_STYLE.media)}>
    {priorityLabel(priority)}
  </span>
);

// Prazo dinâmico: a cor fica SÓ neste indicador (nunca na linha).
const DEADLINE_STYLE = {
  neutral: "text-foreground/80",
  done: "text-muted-foreground",
  near: "rounded-md border border-border bg-card px-2 text-foreground/80",
  soft: "rounded-md bg-amber-50 px-2 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  warn: "rounded-md bg-orange-100 px-2 font-semibold text-orange-800 ring-1 ring-inset ring-orange-300 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/40",
  late: "rounded-md bg-red-50 px-2 font-semibold text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
};
const DEADLINE_ICON = { neutral: CalendarDays, near: Clock, soft: AlertTriangle, warn: AlarmClock, late: AlertTriangle, done: Check };

export const DeadlineBadge = ({ task, now, testid }) => {
  const info = deadlineInfo(task, now);
  const Icon = DEADLINE_ICON[info.tone];
  return (
    <span data-testid={testid} data-tone={info.tone}
      className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap text-[12.5px]", DEADLINE_STYLE[info.tone])}>
      {Icon && <Icon size={13} className={cn("shrink-0", info.pulse && "task-deadline-pulse")} aria-hidden />}
      {info.text}
    </span>
  );
};

// Tag NEUTRA do pregão vinculado, antes da descrição ("PE 039/2026"). Só a tag é
// clicável (abre a licitação); sem vínculo não renderiza nada.
export const PregaoTag = ({ task, clickable, done, onOpen, testid }) => {
  const label = pregaoTag(task);
  if (!label) return null;
  const cls = cn(
    "inline-flex h-[19px] shrink-0 items-center whitespace-nowrap rounded-[5px] border border-slate-400/70 bg-slate-100 px-1.5 font-mono-num text-[10.5px] font-semibold leading-none text-slate-700",
    "dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200",
    done && "opacity-60"
  );
  if (!clickable) return <span className={cls} data-testid={testid} title={task.bid_label || label}>{label}</span>;
  return (
    <button type="button" onClick={onOpen} data-testid={testid} aria-label={`Abrir ${label}`} title={task.bid_label || `Abrir ${label}`}
      className={cn(cls, "cursor-pointer transition-colors hover:border-slate-500 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 dark:hover:bg-slate-700")}>
      {label}
    </button>
  );
};

export function TaskTable({ tasks, now, onEdit, onStatus, showDetails = false, testid = "tasks-table", emptyText }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canComplete = can("tasks.complete");
  const canSeeBids = can("licitacoes.view") && can("orcamento.view");

  return (
    <div className="overflow-x-auto">
      <table data-testid={testid} className="w-full min-w-[860px] border-collapse text-[13px]">
        <colgroup>
          <col />
          <col className="w-[170px]" />
          <col className="w-[160px]" />
          <col className="w-[110px]" />
          <col className="w-[200px]" />
          <col className="w-[140px]" />
        </colgroup>
        <thead>
          <tr className="bg-muted/60 text-left text-[12.5px] font-semibold text-foreground/80">
            {COLS.map((c, i) => (
              <th key={c} scope="col" className={cn("px-3 py-2 font-semibold", i === 0 && "rounded-l-lg pl-4", i === COLS.length - 1 && "rounded-r-lg")}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 && (
            <tr><td colSpan={COLS.length} className="px-4 py-6 text-center text-xs text-muted-foreground">{emptyText || "Nenhuma tarefa."}</td></tr>
          )}
          {tasks.map((t) => {
            const done = t.status === "concluida";
            return (
              <tr key={t.id} data-testid={`${testid}-row-${t.id}`} data-status={t.status}
                className={cn("border-b border-border/70 last:border-b-0 transition-colors hover:bg-accent/40", done && "text-muted-foreground")}>
                <td className="py-1.5 pl-4 pr-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={done ? `Reabrir: ${t.title}` : `Concluir: ${t.title}`}
                      disabled={!canComplete}
                      onClick={() => onStatus(t, done ? "pendente" : "concluida")}
                      data-testid={`${testid}-check-${t.id}`}
                      className={cn(
                        "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed",
                        done ? "border-slate-400 bg-slate-400 text-white dark:border-slate-500 dark:bg-slate-500" : "border-slate-300 bg-card hover:border-slate-500 dark:border-slate-600"
                      )}
                    >
                      {done && <Check size={11} strokeWidth={3} />}
                    </button>
                    <div className="min-w-0">
                      {/* Descrição primeiro e a tag do pregão logo depois. Descrição
                          longa é cortada com "…", mas a tag continua visível no fim. */}
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEdit(t)}
                          data-testid={`${testid}-open-${t.id}`}
                          title={t.title}
                          className={cn(
                            "min-w-0 max-w-full truncate rounded-sm text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                            done && "text-muted-foreground line-through decoration-slate-400"
                          )}
                        >
                          {t.title}
                        </button>
                        <PregaoTag task={t} clickable={canSeeBids} done={done}
                          onOpen={() => navigate(`/orcamento/${t.bid_id}`)} testid={`${testid}-bid-${t.id}`} />
                      </div>
                      {showDetails && t.notes && (
                        <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={t.notes}>{t.notes}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-1.5"><Assignee id={t.responsible_id} name={t.responsible_name} /></td>
                <td className="px-3 py-1.5">
                  <StatusPill task={t} canChange={canComplete} onChange={(s) => onStatus(t, s)} testid={`${testid}-status-${t.id}`} />
                </td>
                <td className={cn("px-3 py-1.5", done && "opacity-60")}><PriorityBadge priority={t.priority} /></td>
                <td className="px-3 py-1.5"><DeadlineBadge task={t} now={now} testid={`${testid}-deadline-${t.id}`} /></td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono-num text-foreground/80">{formatDueFull(t)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
