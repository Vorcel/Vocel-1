// Shared constants & helpers for status colors and timeline.

export const STATUS_STYLES = {
  Disputar: { bg: "bg-brand/10", text: "text-brand", dot: "bg-brand", ring: "ring-brand/30" },
  Ganho: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-300" },
  "Analisando proposta": { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-300" },
  Adjudicado: { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500", ring: "ring-violet-300" },
  Desclassificado: { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-500", ring: "ring-red-300" },
  Perdido: { bg: "bg-slate-200", text: "text-slate-600", dot: "bg-slate-400", ring: "ring-slate-300" },
  Adiado: { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500", ring: "ring-orange-300" },
};

export function statusStyle(status) {
  return STATUS_STYLES[status] || { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400", ring: "ring-slate-300" };
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
