import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/StatusBadge";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { findColor } from "@/lib/constants";
import { EmpenhoAdjudicacaoDialog } from "@/components/execution/EmpenhoDialogs";

// Menu de status — mesmo visual da Execução & Pós-Venda (StatusBadge):
// fechado mostra o status atual com a cor configurada; aberto, cada opção
// aparece como badge na sua própria cor.
export const StatusDropdown = ({ bid }) => {
  const { lists, changeStatus } = useData();
  // Status inativo não é oferecido para novas seleções (Configurações → Status),
  // mas continua listado se for o status atual da licitação (registro antigo).
  const opcoes = (lists.statuses || []).filter((st) => st.ativo !== false || st.nome === bid.status);
  const { can } = useAuth();
  // Enviar para "Adjudicado" NÃO é imediato: antes o usuário confirma o valor do
  // empenho (pop-up). Cancelar = nada muda (status e empenho intactos).
  const [adjudicar, setAdjudicar] = useState(null);
  const escolher = (nome) => {
    if (nome === bid.status) return;
    if (nome === "Adjudicado") { setAdjudicar({ bid }); return; }
    changeStatus(bid.id, nome);
  };
  const confirmarAdjudicacao = async (cents) => {
    await changeStatus(bid.id, "Adjudicado", { empenho: (cents / 100).toFixed(2) });
    setAdjudicar(null);
    toast.success("Licitação enviada para Adjudicado");
  };
  // Sem permissão de alterar status: só o badge (o backend recusa a troca de qualquer forma).
  if (!can("licitacoes.status")) {
    return <StatusBadge color={findColor(lists.statuses, bid.status)} data-testid={`status-trigger-${bid.id}`}>{bid.status}</StatusBadge>;
  }

  return (
    <>
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
        {opcoes.map((st) => (
          <DropdownMenuItem
            key={st.nome}
            data-testid={`status-option-${bid.id}-${st.nome}`}
            onClick={() => escolher(st.nome)}
            className="cursor-pointer"
          >
            <StatusBadge color={st.cor}>{st.nome}</StatusBadge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    <EmpenhoAdjudicacaoDialog target={adjudicar} onCancel={() => setAdjudicar(null)} onConfirm={confirmarAdjudicacao} />
    </>
  );
};
