// Regras de apresentação do módulo Financeiro (o backend é a fonte da verdade:
// valores em CENTAVOS inteiros, datas de calendário "YYYY-MM-DD").
import api from "@/lib/api";

// ---------------- dinheiro ----------------
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (cents) => BRL.format((Number(cents) || 0) / 100);
// Valor compacto para eixos de gráfico: R$ 1,2 mi / R$ 350 mil
export const moneyShort = (cents) => {
  const v = (Number(cents) || 0) / 100;
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

// Texto digitado ("1.234,56") -> centavos inteiros, sem float. null se inválido.
export function parseMoney(text) {
  if (text == null) return null;
  let s = String(text).replace(/R\$|\s/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/^-/, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  const cents = Number(int) * 100 + Number((dec + "00").slice(0, 2)) + (Number(dec[2] || 0) >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}
// Centavos -> texto editável "1.234,56"
export const centsToInput = (cents) =>
  cents == null ? "" : ((Number(cents) || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mesma divisão do backend (split_installments): diferença de centavos na última.
export function splitInstallments(totalCents, n) {
  if (!totalCents || !n || n < 1) return [];
  const base = Math.floor(totalCents / n);
  const parts = Array(n).fill(base);
  parts[n - 1] += totalCents - base * n;
  return parts;
}

// ---------------- datas (calendário, sem UTC) ----------------
const pad = (n) => String(n).padStart(2, "0");
export function todaySP() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthBounds = (iso, offset = 0) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(last)}`];
};
// Timestamp do sistema (UTC) exibido em São Paulo: "07/11/2026 17:30:12"
export function fmtTimestamp(ts) {
  if (!ts) return { date: "—", time: "" };
  const d = new Date(ts);
  const o = { timeZone: "America/Sao_Paulo" };
  return {
    date: d.toLocaleDateString("pt-BR", o),
    time: d.toLocaleTimeString("pt-BR", { ...o, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}
export function relativeTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 60000;
  if (diff < 1) return "agora";
  if (diff < 60) return `há ${Math.round(diff)} min`;
  if (diff < 1440) return `há ${Math.floor(diff / 60)} h`;
  return `há ${Math.floor(diff / 1440)} d`;
}

// Períodos rápidos (Visão Geral / páginas). Nunca persistidos.
export function periodPresets(today) {
  const [m0a, m0b] = monthBounds(today, 0);
  const [m1a, m1b] = monthBounds(today, 1);
  return [
    { key: "mes", label: "Este mês", from: m0a, to: m0b },
    { key: "prox_mes", label: "Próximo mês", from: m1a, to: m1b },
    { key: "30d", label: "Próximos 30 dias", from: today, to: addDays(today, 30) },
    { key: "90d", label: "Próximos 90 dias", from: today, to: addDays(today, 90) },
    { key: "ano", label: "Este ano", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}

// ---------------- status (fonte única no frontend) ----------------
// `status_efetivo` vem do backend: pendente | atrasado | pago | recebido | cancelado
// (+ `status` armazenado "parcial" quando houve baixa parcial — ver entryStatus).
export const STATUS = {
  pendente: { label: "Previsto", tone: "info" },
  parcial_pagar: { label: "Parcialmente pago", tone: "warning" },
  parcial_receber: { label: "Parcialmente recebido", tone: "warning" },
  atrasado: { label: "Atrasado", tone: "danger" },
  pago: { label: "Pago", tone: "success" },
  recebido: { label: "Recebido", tone: "success" },
  cancelado: { label: "Cancelado", tone: "muted" },
  aguardando: { label: "Aguardando aprovação", tone: "warning" },
};
export const TONES = {
  success: { bg: "var(--fin-success-soft)", fg: "var(--fin-success)" },
  danger: { bg: "var(--fin-danger-soft)", fg: "var(--fin-danger)" },
  warning: { bg: "var(--fin-warning-soft)", fg: "var(--fin-warning)" },
  info: { bg: "var(--fin-info-soft)", fg: "var(--fin-info)" },
  muted: { bg: "var(--fin-muted-soft)", fg: "var(--fin-muted)" },
};

// Status de um lançamento para a tela: parcial é informação própria e
// "Atrasado" se soma a ela quando o saldo restante venceu (nunca se perde).
export function entryStatus(e) {
  const atrasado = e.status_efetivo === "atrasado";
  if (e.status === "parcial") return { main: `parcial_${e.type}`, atrasado };
  return { main: atrasado ? "atrasado" : (e.status_efetivo || e.status), atrasado: false };
}
export const isOpenEntry = (e) => e.status === "pendente" || e.status === "parcial";

export const TIPOS = { pagar: "A Pagar", receber: "A Receber" };
export const MODOS = { avista: "À vista", parcelado: "Parcelado", recorrente: "Recorrente" };
export const FREQUENCIAS = [
  { value: "semanal", label: "Semanal" },
  { value: "quinzenal", label: "Quinzenal" },
  { value: "mensal", label: "Mensal" },
  { value: "bimestral", label: "Bimestral" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];
export const TIPOS_CONTA = [
  { value: "corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
  { value: "pagamento", label: "Conta de pagamento" },
  { value: "investimento", label: "Investimento" },
  { value: "caixa", label: "Caixa (dinheiro)" },
];
export const BANDEIRAS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Outra"];

// Cores do gráfico de fluxo — Ref10 (verde = a receber, vermelho = a pagar,
// azul = caixa projetado). Identidade nunca só pela cor: legenda + tooltip.
export const CHART = { receber: "#5DB06F", pagar: "#F06B66", caixa: "#1559F5" };

// ---------------- histórico ----------------
export const ACOES = {
  lancamento_criado: { label: "Lançamento criado", tone: "info" },
  sequencia_criada: { label: "Sequência criada", tone: "info" },
  lancamento_duplicado: { label: "Lançamento duplicado", tone: "warning" },
  lancamento_editado: { label: "Lançamento editado", tone: "warning" },
  sequencia_editada: { label: "Sequência editada", tone: "warning" },
  valor_alterado: { label: "Valor alterado", tone: "warning" },
  vencimento_alterado: { label: "Vencimento alterado", tone: "warning" },
  categoria_alterada: { label: "Categoria alterada", tone: "warning" },
  forma_alterada: { label: "Forma de pagamento alterada", tone: "warning" },
  banco_alterado: { label: "Banco alterado", tone: "warning" },
  cartao_alterado: { label: "Cartão alterado", tone: "warning" },
  lancamento_cancelado: { label: "Lançamento cancelado", tone: "danger" },
  lancamento_excluido: { label: "Lançamento excluído", tone: "danger" },
  lancamento_reativado: { label: "Lançamento reativado", tone: "info" },
  pagamento_baixado: { label: "Baixa de pagamento", tone: "success" },
  recebimento_baixado: { label: "Recebimento baixado", tone: "success" },
  pagamento_parcial: { label: "Pagamento parcial realizado", tone: "success" },
  recebimento_parcial: { label: "Recebimento parcial realizado", tone: "success" },
  pagamento_estornado: { label: "Pagamento estornado", tone: "danger" },
  recebimento_reaberto: { label: "Recebimento estornado", tone: "danger" },
  pagamento_parcial_estornado: { label: "Pagamento parcial estornado", tone: "danger" },
  recebimento_parcial_estornado: { label: "Recebimento parcial estornado", tone: "danger" },
  solicitacao_enviada: { label: "Solicitação recebida da Execução", tone: "warning" },
  solicitacao_retirada: { label: "Solicitação retirada", tone: "muted" },
  recebivel_aprovado: { label: "Recebível aprovado", tone: "success" },
  recebivel_rejeitado: { label: "Recebível rejeitado", tone: "danger" },
  atualizacao_recebida: { label: "Alteração recebida da Execução", tone: "warning" },
  atualizacao_ignorada: { label: "Alteração ignorada", tone: "muted" },
  recebivel_atualizado: { label: "Recebível atualizado", tone: "info" },
  execucao_atualizada: { label: "Execução atualizada", tone: "info" },
  saldo_ajustado: { label: "Saldo ajustado", tone: "info" },
};
for (const [k, nome] of Object.entries({ categoria: "Categoria", forma: "Forma de pagamento", conta: "Conta", cartao: "Cartão", tag: "Tag" })) {
  ACOES[`${k}_criado`] = { label: `${nome} criada`, tone: "info" };
  ACOES[`${k}_editado`] = { label: `${nome} editada`, tone: "warning" };
  ACOES[`${k}_inativado`] = { label: `${nome} inativada`, tone: "muted" };
  ACOES[`${k}_reativado`] = { label: `${nome} reativada`, tone: "info" };
  ACOES[`${k}_excluido`] = { label: `${nome} excluída`, tone: "danger" };
}
export const MODULOS = { pagar: "A Pagar", receber: "A Receber", bancos: "Bancos", config: "Configurações", execucao: "Execução" };

// Valor legível de um campo alterado no histórico.
export function changeValue(field, v) {
  if (v == null || v === "") return "—";
  if (field.endsWith("_cents")) return money(v);
  if (field === "due_date" || field.endsWith("_date")) return fmtDate(v);
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (field === "status") return STATUS[v]?.label || (v === "parcial" ? "Parcial" : v);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

// ---------------- API ----------------
export const finApi = {
  cadastros: () => api.get("/fin/cadastros").then((r) => r.data),
  criarCadastro: (kind, body) => api.post(`/fin/cadastros/${kind}`, body).then((r) => r.data),
  editarCadastro: (kind, id, body) => api.put(`/fin/cadastros/${kind}/${id}`, body).then((r) => r.data),
  excluirCadastro: (kind, id) => api.delete(`/fin/cadastros/${kind}/${id}`).then((r) => r.data),
  ajustarSaldo: (id, body) => api.post(`/fin/contas/${id}/saldo`, body).then((r) => r.data),
  lancamentos: (params) => api.get("/fin/lancamentos", { params }).then((r) => r.data),
  lancamento: (id) => api.get(`/fin/lancamentos/${id}`).then((r) => r.data),
  criar: (body) => api.post("/fin/lancamentos", body).then((r) => r.data),
  editar: (id, body) => api.put(`/fin/lancamentos/${id}`, body).then((r) => r.data),
  baixar: (id, body) => api.post(`/fin/lancamentos/${id}/baixar`, body).then((r) => r.data),
  baixas: (id) => api.get(`/fin/lancamentos/${id}/baixas`).then((r) => r.data),
  estornarBaixa: (id, sid, body) => api.post(`/fin/lancamentos/${id}/baixas/${sid}/estornar`, body).then((r) => r.data),
  movimentos: (params) => api.get("/fin/movimentos", { params }).then((r) => r.data),
  reabrir: (id, body) => api.post(`/fin/lancamentos/${id}/reabrir`, body).then((r) => r.data),
  cancelar: (id, body) => api.post(`/fin/lancamentos/${id}/cancelar`, body).then((r) => r.data),
  excluir: (id, scope) => api.delete(`/fin/lancamentos/${id}`, { params: { scope } }).then((r) => r.data),
  visaoGeral: (params) => api.get("/fin/visao-geral", { params }).then((r) => r.data),
  resumo: (params) => api.get("/fin/resumo", { params }).then((r) => r.data),
  fluxo: (params) => api.get("/fin/fluxo", { params }).then((r) => r.data),
  historico: (params) => api.get("/fin/historico", { params }).then((r) => r.data),
  solicitacoes: (status = "pendente") => api.get("/fin/recebiveis/solicitacoes", { params: { status } }).then((r) => r.data),
  enviarSolicitacao: (body) => api.post("/fin/recebiveis/solicitacoes", body).then((r) => r.data),
  retirarSolicitacao: (id) => api.post(`/fin/recebiveis/solicitacoes/${id}/retirar`).then((r) => r.data),
  aprovar: (id, body) => api.post(`/fin/recebiveis/solicitacoes/${id}/aprovar`, body).then((r) => r.data),
  rejeitar: (id, body) => api.post(`/fin/recebiveis/solicitacoes/${id}/rejeitar`, body).then((r) => r.data),
  atualizacoes: () => api.get("/fin/recebiveis/atualizacoes").then((r) => r.data),
  decidirAtualizacao: (id, body) => api.post(`/fin/recebiveis/atualizacoes/${id}`, body).then((r) => r.data),
  vinculos: () => api.get("/fin/recebiveis/vinculos").then((r) => r.data),
  sincronizarExecucao: (entryId) => api.post("/fin/recebiveis/sincronizar-execucao", { entry_id: entryId }).then((r) => r.data),
};

// Erro do backend pode vir como texto ou {code, msg, count}.
export function apiError(e) {
  const d = e?.response?.data?.detail;
  if (d && typeof d === "object" && !Array.isArray(d)) return d.msg || "Algo deu errado.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return "Preencha os campos obrigatórios.";
  return "Algo deu errado. Tente novamente.";
}
export const apiErrorCode = (e) => (typeof e?.response?.data?.detail === "object" ? e.response.data.detail?.code : null);
