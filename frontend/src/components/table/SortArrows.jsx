import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Setas de ordenação reutilizáveis (Todas as Licitações e Execução & Pós-Venda).
// A ordenação é acionada pelo clique nas setas; 1º clique = asc, 2º = desc.
export const SortArrows = ({ active, dir, onClick, testid = "sort-arrows" }) => (
  <button
    type="button"
    data-testid={testid}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="ml-1 inline-flex cursor-pointer flex-col leading-[0] align-middle"
    title="Ordenar"
    aria-label="Ordenar coluna"
  >
    <ChevronUp size={11} className={cn(active && dir === "asc" ? "text-foreground" : "text-muted-foreground/40")} />
    <ChevronDown size={11} className={cn("-mt-0.5", active && dir === "desc" ? "text-foreground" : "text-muted-foreground/40")} />
  </button>
);
