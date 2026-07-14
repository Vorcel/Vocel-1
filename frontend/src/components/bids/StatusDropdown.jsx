import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/StatusBadge";
import { useData } from "@/context/DataContext";
import { findColor } from "@/lib/constants";

// Menu de status — mesmo visual da Execução & Pós-Venda (StatusBadge):
// fechado mostra o status atual com a cor configurada; aberto, cada opção
// aparece como badge na sua própria cor.
export const StatusDropdown = ({ bid }) => {
  const { lists, changeStatus } = useData();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusBadge
          as="button"
          color={findColor(lists.statuses, bid.status)}
          data-testid={`status-trigger-${bid.id}`}
          className="cursor-pointer transition-transform hover:scale-105"
        >
          {bid.status}
          <ChevronDown size={12} />
        </StatusBadge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {(lists.statuses || []).map((st) => (
          <DropdownMenuItem
            key={st.nome}
            data-testid={`status-option-${bid.id}-${st.nome}`}
            onClick={() => st.nome !== bid.status && changeStatus(bid.id, st.nome)}
            className="cursor-pointer"
          >
            <StatusBadge color={st.cor}>{st.nome}</StatusBadge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
