import { useCallback, useEffect } from "react";
import { useData } from "@/context/DataContext";

export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

// Registros por página persistidos por tabela, salvos no backend (preferências
// do usuário, `table_page_sizes`) — mesma estrutura da ordenação persistente.
// `page` = chave da tabela ("executions" | ...); `defaultSize` = padrão do sistema.
// localStorage é só cache para evitar o "pulo" 10 -> 25 enquanto as preferências
// carregam; a fonte oficial é o backend (por usuário, sobrevive a logout/outro PC).
// Retorna [pageSize, setPageSize]; setPageSize salva na hora, sem botão.
export function usePersistentPageSize(page, defaultSize = 10) {
  const { prefs, saveTablePageSize } = useData();
  const cacheKey = `table_page_size_${page}`;
  const valid = (n) => PAGE_SIZE_OPTIONS.includes(Number(n)) ? Number(n) : null;

  let cached = null;
  try { cached = valid(localStorage.getItem(cacheKey)); } catch { /* ignore */ }
  const saved = valid(prefs?.table_page_sizes?.[page]);
  const pageSize = saved ?? cached ?? defaultSize;

  // Mantém o cache alinhado ao valor oficial do backend.
  useEffect(() => {
    if (saved != null) { try { localStorage.setItem(cacheKey, String(saved)); } catch { /* ignore */ } }
  }, [saved, cacheKey]);

  const setPageSize = useCallback((n) => {
    const size = valid(n);
    if (!size) return;
    try { localStorage.setItem(cacheKey, String(size)); } catch { /* ignore */ }
    saveTablePageSize(page, size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, cacheKey, saveTablePageSize]);

  return [pageSize, setPageSize];
}
