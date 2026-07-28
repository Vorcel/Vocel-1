import { useCallback } from "react";
import { useData } from "@/context/DataContext";

// Ordenação persistida por página, salva no backend (preferências do usuário).
// `page` = chave da tabela ("bids" | "executions"); `defaultSort` = { key, dir }
// aplicado quando não há preferência salva (mantém o padrão atual do sistema).
// Retorna [sort, toggle] onde toggle(key) faz 1º clique asc / 2º clique desc.
export function usePersistentSort(page, defaultSort) {
  const { prefs, saveTableSort } = useData();
  const saved = prefs?.table_sorts?.[page];
  const sort = saved && saved.key ? saved : defaultSort;

  const toggle = useCallback((key) => {
    if (!key) return;
    const dir = sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : "asc";
    saveTableSort(page, { key, dir });
  }, [page, sort, saveTableSort]);

  return [sort, toggle];
}
