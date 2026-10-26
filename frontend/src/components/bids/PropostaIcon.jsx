import { CountBadge } from "@/components/CountBadge";
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

// Cor da proposta preenchida — a MESMA em todas as telas (tabela, hub, orçamento).
export const PROPOSTA_COLOR = "#0114FF";

// Propostas da licitação, do dado real (nunca de state temporário do frontend).
// Mesma regra do backend (`_propostas` em propostas.py): a lista `propostas`; a
// licitação gravada no modelo antigo (só `proposta`) vale como lista de UM item.
// O id da antiga é o próprio file_id — o mesmo que o backend usa no `?pid=`.
export const listPropostas = (bid) => {
  const lista = bid?.propostas ?? (bid?.proposta?.file_id ? [bid.proposta] : []);
  return lista.filter((p) => p?.file_id).map((p) => ({ ...p, id: p.id || p.file_id }));
};
export const hasProposta = (bid) => listPropostas(bid).length > 0;

// Botão da tabela, ao lado da calculadora. Mesmo tamanho/raio do botão do orçamento.
// Sem proposta: cinza desbotado; com proposta: #0114FF; com 2+: #0114FF + badge.
export const PropostaButton = ({ bid, onClick }) => {
  const total = listPropostas(bid).length;
  const ativa = total > 0;
  return (
    <button
      type="button"
      data-testid={`bid-proposta-${bid.id}`}
      data-count={total}
      onClick={onClick}
      title={total > 1 ? `Propostas (${total})` : "Proposta"}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        ativa ? "hover:bg-[#0114FF]/10" : "text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground/70"
      )}
      style={ativa ? { color: PROPOSTA_COLOR } : undefined}
    >
      <PropostaIcon size={18} />
      <CountBadge count={total} color={PROPOSTA_COLOR} testid={`bid-proposta-${bid.id}-badge`} small />
    </button>
  );
};
