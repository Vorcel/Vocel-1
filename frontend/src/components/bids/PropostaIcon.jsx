import { cn } from "@/lib/utils";

// Ícone da proposta: folha/documento com a letra "P" incorporada.
// Desenhado no mesmo sistema dos ícones lucide usados na tabela (viewBox 24,
// traço 2px, currentColor, pontas arredondadas) para não destoar da linha.
// A cor vem de fora via className: desbotado quando não há proposta, azul vivo
// quando existe — ver PropostaButton.
export const PropostaIcon = ({ size = 18, className, strokeWidth = 2, ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    {/* folha com o canto dobrado */}
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    {/* letra P */}
    <path d="M9 18v-7h2.5a2.25 2.25 0 0 1 0 4.5H9" />
  </svg>
);

// Estado real, vindo do dado da licitação (nunca de state temporário do frontend).
export const hasProposta = (bid) => Boolean(bid?.proposta?.file_id);

// Botão da tabela, ao lado da calculadora. Mesmo tamanho/raio do botão do orçamento.
export const PropostaButton = ({ bid, onClick }) => {
  const ativa = hasProposta(bid);
  return (
    <button
      type="button"
      data-testid={`bid-proposta-${bid.id}`}
      onClick={onClick}
      title="Proposta"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        ativa
          ? "text-brand hover:bg-brand/10"                       // com proposta: azul vivo
          : "text-brand/30 hover:bg-accent hover:text-brand/60"  // sem proposta: azul desbotado
      )}
    >
      <PropostaIcon size={18} />
    </button>
  );
};
