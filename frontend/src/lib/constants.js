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
    badge: { backgroundColor: hexToRgba(c, 0.14), color: c, borderColor: hexToRgba(c, 0.4) },
    solid: { backgroundColor: c, color: "#ffffff" },
    dot: { backgroundColor: c },
    text: { color: c },
  };
}

// Find color for an item name within a list of {nome, cor}.
export function findColor(list, nome, fallback = "#64748B") {
  const item = (list || []).find((i) => i.nome === nome);
  return item?.cor || fallback;
}

export const TIMELINE_STEPS = [
  "Aguardando Empenho",
  "Empenho Recebido",
  "Pedido de Compra",
  "Aguardando Mercadoria",
  "Mercadoria Recebida",
  "Faturamento / NF",
  "Expedição",
  "Em Transporte",
  "Entregue",
  "Concluído",
];
