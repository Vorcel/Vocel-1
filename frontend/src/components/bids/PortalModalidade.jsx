import { PortalName } from "@/components/bids/PortalName";

// Célula "Portal / Modalidade" — padrão visual único (Página Inicial, Todas as
// Licitações e Execução): portal em cima com a cor do parâmetro, modalidade
// abaixo em texto secundário. Não duplicar este markup nas tabelas.
export const PortalModalidade = ({ portal, modalidade, className }) => (
  <div className={className}>
    <PortalName portal={portal} />
    <span className="block truncate text-xs text-muted-foreground" title={modalidade}>{modalidade}</span>
  </div>
);
