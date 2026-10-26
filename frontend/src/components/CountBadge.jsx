import { cn } from "@/lib/utils";

// Badge numérico dos ícones de documento (padrão do hub da Execução & Pós-Venda):
// bolinha na cor do documento, no canto superior direito do ícone. Só aparece com
// 2+ arquivos — com um só, a cor do ícone já diz que existe. A quantidade vem
// sempre do dado persistido. O pai precisa ser `relative`.
export const CountBadge = ({ count, color, testid, small }) =>
  count > 1 ? (
    <span
      data-testid={testid}
      className={cn(
        "pointer-events-none absolute flex items-center justify-center rounded-full border-2 border-card px-1 font-bold leading-none text-white",
        small ? "-right-1 -top-1 h-[15px] min-w-[15px] text-[9px]" : "-right-0.5 -top-0.5 h-[18px] min-w-[18px] text-[10px]"
      )}
      style={{ backgroundColor: color }}
    >
      {count}
    </span>
  ) : null;
