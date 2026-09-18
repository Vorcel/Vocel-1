import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/StatusBadge";
import { ATESTADO_OPTIONS } from "@/lib/constants";
import { atestadoOf, atestadoColor } from "@/lib/execution";

// Menu do Atestado de Capacidade Técnica — mesmo visual/comportamento do
// StatusDropdown das licitações (StatusBadge como gatilho): fechado mostra o
// estado atual na sua cor; aberto, cada opção aparece como badge na própria cor.
// Salva na hora via `onChange(valor)` — sem botão Salvar.
export const AtestadoDropdown = ({ execution, onChange }) => {
  const value = atestadoOf(execution);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBadge
          as="button"
          color={atestadoColor(value)}
          data-testid={`atestado-trigger-${execution.bid_id}`}
          className="cursor-pointer transition-transform hover:scale-105"
        >
          {value}
          <ChevronDown size={12} />
        </StatusBadge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {ATESTADO_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.nome}
            data-testid={`atestado-option-${execution.bid_id}-${opt.nome}`}
            onClick={() => opt.nome !== value && onChange(opt.nome)}
            className="cursor-pointer"
          >
            <StatusBadge color={opt.cor}>{opt.nome}</StatusBadge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
