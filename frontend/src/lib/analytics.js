// Apoio da página Análises de Licitações: cores das séries, formatação compacta
// e construção dos períodos do seletor.
// IMPORTANTE: aqui NÃO existe cálculo de métrica. Participação, adjudicação,
// Total Adjudicado, Valor Empenhado, Taxa de Sucesso e categorias vêm prontos
// de GET /api/analytics (backend/analytics.py) — fonte única.

// Cores das 4 séries (Ref 1), consistentes em toda a página.
export const SERIES_COLORS = {
  participadas: "#2B91F7", // azul   — Licitações Participadas (quantidade)
  adjudicado: "#F5A623",   // laranja— Total Adjudicado (R$)
  empenhado: "#9858EE",    // roxo   — Valor Empenhado (R$)
  lucro: "#2FCB8D",        // verde  — Lucro Estimado (R$)
};

// Gráfico de linha: azul/roxo um pouco mais saturados que as barras (Ref 1),
// para as duas curvas se separarem bem sobre a grade clara.
export const LINE_COLORS = { participacoes: "#1687F8", taxa: "#8B45F5" };

// Cinzas/azuis de apoio dos gráficos — espelham os tokens `.an-scope` do index.css
// (Recharts precisa de cor literal em atributos SVG).
export const CHART_INK = { grid: "#E8EFF6", axis: "#6076A1" };

// Cores das Categorias Analíticas (donut + legenda). As categorias em si são
// definidas no backend (ANALYTIC_CATEGORIES) e configuráveis por status.
export const CATEGORY_COLORS = {
  "Preparação": "#1687F8",
  "Em Julgamento": "#9858EE",
  "Vencidas": "#19B975",
  "Desclassificado": "#64748B",
  "Disputadas": "#EF4444",
  "Fracassadas": "#F5A623",
  "Outros": "#CBD5E1",
};
// Categorias Analíticas disponíveis — espelho de ANALYTIC_CATEGORIES em
// backend/routes.py (manter em sincronia). Usadas no seletor de Configurações.
export const ANALYTIC_CATEGORIES = [
  "Preparação", "Em Julgamento", "Vencidas", "Desclassificado",
  "Disputadas", "Fracassadas", "Outros",
];
export const DEFAULT_ANALYTIC_CATEGORY = "Outros";

export const categoryColor = (nome) => CATEGORY_COLORS[nome] || "#94A3B8";

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
export const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Moeda completa (tooltips e tabelas): R$ 42.000,00
export const money = (v) => n(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Moeda compacta conforme a magnitude (cards e eixos): R$ 12,4 mi · R$ 850 mil · R$ 42.000,00
export function compactMoney(v) {
  const val = n(v);
  const abs = Math.abs(val);
  if (abs >= 1e6) return `R$ ${(val / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e5) return `R$ ${Math.round(val / 1e3).toLocaleString("pt-BR")} mil`;
  return money(val);
}

// Eixo/rótulo financeiro do gráfico (curto, sem distorcer): 1,2 mi · 850 mil · 8.944
// Abrevia em "mil" só a partir de 10 mil — abaixo disso o arredondamento
// enganaria (R$ 1.681 não é "2 mil").
export function axisMoney(v) {
  const val = n(v);
  const abs = Math.abs(val);
  if (abs >= 1e6) return `${(val / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e4) return `${Math.round(val / 1e3).toLocaleString("pt-BR")} mil`;
  return Math.round(val).toLocaleString("pt-BR");
}

// Forma curta do rótulo de período para espaços apertados (cards de KPI):
// "2025 (até 21/09)" -> "2025"; "01/01/2026 a 15/03/2026" -> "01/01–15/03/2026".
// O rótulo completo continua no tooltip (title) e nos demais blocos.
export function shortPeriodLabel(label) {
  if (!label) return "—";
  const semParenteses = String(label).replace(/\s*\(.*\)\s*$/, "").trim();
  const intervalo = semParenteses.match(/^(\d{2}\/\d{2})\/(\d{4}) a (\d{2}\/\d{2})\/(\d{4})$/);
  if (intervalo) {
    const [, a, ay, b, by] = intervalo;
    return ay === by ? `${a}–${b}/${by}` : `${a}/${ay}–${b}/${by}`;
  }
  return semParenteses;
}

export const pctLabel = (v) => `${n(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

// Data ISO (YYYY-MM-DD) -> DD/MM/AAAA, sem conversão de fuso.
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

// ---- Períodos (o seletor nunca persiste a escolha; ver DEFAULT_PERIOD) ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lastDay = (year, month) => new Date(year, month, 0).getDate(); // month 1-12

export const monthStart = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;
export const monthEnd = (year, month) => `${year}-${String(month).padStart(2, "0")}-${lastDay(year, month)}`;

// Padrão SEMPRE recalculado na carga da página: 1º de janeiro do ano corrente
// até hoje (YTD). Nada é lido de localStorage/preferências.
export function defaultPeriod(today = new Date()) {
  return { start: `${today.getFullYear()}-01-01`, end: iso(today) };
}

export const yearPeriod = (year) => ({ start: monthStart(year, 1), end: monthEnd(year, 12) });
export const quarterPeriod = (year, q) => ({ start: monthStart(year, q * 3 - 2), end: monthEnd(year, q * 3) });
export const monthPeriod = (year, month) => ({ start: monthStart(year, month), end: monthEnd(year, month) });
export const rangePeriod = (year, from, to) => {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { start: monthStart(year, a), end: monthEnd(year, b) };
};

// Anos disponíveis para escolha: os que têm licitação + o ano corrente.
export function availableYears(bids = [], today = new Date()) {
  const anos = new Set([today.getFullYear()]);
  bids.forEach((b) => {
    const y = Number(String(b?.data_disputa || "").slice(0, 4));
    if (y >= 2000 && y <= 2100) anos.add(y);
  });
  return [...anos].sort((a, b) => b - a);
}
