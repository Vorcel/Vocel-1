// Shared constants & helpers for status colors and timeline.

// Convert a hex color to an rgba string with given alpha.
export function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(100,116,139,${alpha})`;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Inline styles for badges/dots derived from an arbitrary hex color.
export function colorStyles(hex) {
  const c = hex || "#64748B";
  return {
    badge: { backgroundColor: hexToRgba(c, 0.18), color: c, borderColor: hexToRgba(c, 0.55) },
    // Mesma cor temática no fundo/borda, mas TEXTO sempre escuro (legibilidade/WCAG).
    badgeDark: { backgroundColor: hexToRgba(c, 0.18), color: "#1A1A1A", borderColor: hexToRgba(c, 0.55) },
    solid: { backgroundColor: c, color: "#ffffff" },
    dot: { backgroundColor: c },
    text: { color: c },
  };
}

// Paleta pastel para tags/itens — cores alternadas e não-repetitivas por índice.
export const TAG_PALETTE = ["#2563EB", "#64748B", "#059669", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#475569"];
export function tagColorAt(i) {
  return TAG_PALETTE[((i % TAG_PALETTE.length) + TAG_PALETTE.length) % TAG_PALETTE.length];
}

// Find color for an item name within a list of {nome, cor}.
export function findColor(list, nome, fallback = "#64748B") {
  const item = (list || []).find((i) => i.nome === nome);
  return item?.cor || fallback;
}

// 11 etapas sequenciais — espelho de backend/routes.py TIMELINE_STEPS (manter em sincronia).
// FONTE ÚNICA da ordem/nomes: timeline, progresso, status da tabela, filtros e
// ícones (STEP_ICONS por nome em Execution.jsx) derivam daqui.
// "Solicitar Atestado" deixou de ser etapa: virou o campo independente `atestado`.
// "Aguardando Pagamento" (entre Entregue e Pagamento Recebido) adicionada em 2026-09-18.
export const TIMELINE_STEPS = [
  "Aguardando Empenho",
  "Empenho Recebido",
  "Comprar Mercadoria",
  "Aguardando Mercadoria",
  "Mercadoria Recebida",
  "Preparar para Transporte",
  "Emitir NF",
  "Em Transporte",
  "Entregue",
  "Aguardando Pagamento",
  "Pagamento Recebido",
];

// Atestado de Capacidade Técnica — controle independente da timeline, por execução.
// Ordem = sequência lógica (usada na ordenação da coluna). Cores da paleta do Vorcel.
export const ATESTADO_OPTIONS = [
  { nome: "Não solicitado", cor: "#DC2626" },
  { nome: "Solicitado", cor: "#2563EB" },
  { nome: "Recebido", cor: "#059669" },
];
export const ATESTADO_DEFAULT = ATESTADO_OPTIONS[0].nome;
