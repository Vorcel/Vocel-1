import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

// Relógio da tela: o prazo dinâmico é recalculado a cada 30 s sem tocar no backend.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Responsáveis ATIVOS (cadastro próprio em Configurações › Responsáveis — não
// são usuários do sistema). Recarrega a cada abertura do modal/página.
export function useResponsibles(enabled = true) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.get("/tasks/responsibles").then(({ data }) => { if (alive) setList(data); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return list;
}

// Mudança rápida de status (checkbox / menu de status) com toast de erro.
export function useTaskStatus(onChanged) {
  return useCallback(async (task, status) => {
    try {
      await api.put(`/tasks/${task.id}`, { status });
      if (status === "concluida") toast.success("Tarefa concluída.");
      else if (task.status === "concluida") toast.success("Tarefa reaberta.");
      onChanged?.();
    } catch (e) {
      if (e.response?.status !== 403) toast.error(formatApiError(e.response?.data?.detail));
    }
  }, [onChanged]);
}
