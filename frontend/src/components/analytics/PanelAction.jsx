import { ArrowRight } from "lucide-react";

// Gatilho discreto no cabeçalho dos cards ("Ver todas", "Ver todos os portais"),
// posicionado como na Ref 1. Só aparência — a ação vem por prop.
export function PanelAction({ children, onClick, testid }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-[#D6E6F8] bg-[#F2F8FF] px-2 py-[3px] text-[10px] font-semibold text-[#1687F8] transition-colors duration-150 hover:border-[#1687F8]/60 hover:bg-[#E8F2FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1687F8]/40 dark:border-border dark:bg-accent"
    >
      {children} <ArrowRight size={11} />
    </button>
  );
}
