import { useData } from "@/context/DataContext";
import { findColor } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Nome do portal — texto simples em negrito com a cor configurada em
// Configurações → Listas e Parâmetros → Portais. Sem badge/cápsula/fundo:
// padrão visual único para Página Inicial, Todas as Licitações e Execução.
export const PortalName = ({ portal, className }) => {
  const { lists } = useData();
  return (
    <span
      className={cn("block truncate font-semibold", className)}
      style={{ color: findColor(lists.portais, portal) }}
      title={portal}
    >
      {portal}
    </span>
  );
};
