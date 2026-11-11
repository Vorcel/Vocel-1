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
    { key: "mes_passado", label: "Mês passado", from: monthBounds(today, -1)[0], to: monthBounds(today, -1)[1] },
    { key: "prox_mes", label: "Próximo mês", from: m1a, to: m1b },
    { key: "30d", label: "Próximos 30 dias", from: today, to: addDays(today, 30) },
    { key: "90d", label: "Próximos 90 dias", from: today, to: addDays(today, 90) },
    { key: "ano", label: "Este ano", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}

// Intervalo de um período escolhido nos filtros ("todos", preset ou "custom").
// FONTE ÚNICA: a tabela e os cards da Visão Geral usam exatamente este cálculo.
// `open` = algum limite ausente significa "sem limite" (nunca "mês atual").
export function periodRange(key, custom, presets) {
  if (key === "todos") return { open: true };
  if (key === "custom") return { date_from: custom?.from || undefined, date_to: custom?.to || undefined, open: true };
  const p = presets.find((x) => x.key === key);
  return p ? { date_from: p.from, date_to: p.to } : { open: true };
}

// Períodos da DRE (competência). Trimestre = trimestre civil atual.
export function drePresets(today) {
  const [m0a, m0b] = monthBounds(today, 0);
  const [m1a, m1b] = monthBounds(today, -1);
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const qa = `${today.slice(0, 4)}-${pad(q * 3 + 1)}-01`;
  const qb = monthBounds(`${today.slice(0, 4)}-${pad(q * 3 + 3)}-01`, 0)[1];
  return [
    { key: "mes", label: "Este mês", from: m0a, to: m0b },
    { key: "mes_passado", label: "Mês passado", from: m1a, to: m1b },
    { key: "trimestre", label: "Trimestre", from: qa, to: qb },
    { key: "ano", label: "Ano", from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ];
}
// Rótulo curto de um período: "Nov/26" (mês cheio) ou "01/11/26–15/11/26".
const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export function periodLabel(from, to) {
  if (!from || !to) return "";
  const [a, b] = [monthBounds(from, 0), monthBounds(to, 0)];
  const yy = (iso) => iso.slice(2, 4);
  if (from === a[0] && to === b[1]) {
    const m1 = `${MES_CURTO[Number(from.slice(5, 7)) - 1]}/${yy(from)}`;
    const m2 = `${MES_CURTO[Number(to.slice(5, 7)) - 1]}/${yy(to)}`;
    return m1 === m2 ? m1 : `${m1}–${m2}`;
  }
  const f = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${yy(iso)}`;
  return `${f(from)}–${f(to)}`;
}

// Tipos de Grupo DRE (definem o bloco da DRE em que o grupo entra).
export const DRE_TIPOS = [
  { value: "receita", label: "Receita", bloco: "Receita Bruta" },
  { value: "deducao", label: "Dedução", bloco: "Deduções da Receita" },
  { value: "custo", label: "Custo", bloco: "Custos" },
  { value: "despesa", label: "Despesa", bloco: "Despesas Operacionais" },
  { value: "outra_receita", label: "Outra Receita", bloco: "Outras Receitas e Despesas" },
  { value: "outra_despesa", label: "Outra Despesa", bloco: "Outras Receitas e Despesas" },
  { value: "tributo", label: "Tributo", bloco: "Tributos sobre o Resultado" },
];
export const DRE_TIPO_LABEL = Object.fromEntries(DRE_TIPOS.map((t) => [t.value, t.label]));

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

// Formas que NÃO pedem Banco/Conta no lançamento (espelho de FORMAS_SEM_CONTA
// no backend). Pix, Boleto, Transferência e formas novas pedem. A forma genérica
// "Cartão" não aparece mais: os cartões cadastrados entram direto na seleção.
const norm = (t) => (t || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const FORMAS_SEM_CONTA = new Set(["dinheiro", "especie", "outro", "outros", "cartao", "cartao de credito", "credito"]);
const FORMAS_CARTAO = new Set(["cartao", "cartao de credito", "credito"]);
export const formaExigeConta = (forma) => !!forma && !FORMAS_SEM_CONTA.has(norm(forma.nome));
export const isFormaCartaoGenerica = (forma) => !!forma && FORMAS_CARTAO.has(norm(forma.nome));
export const cardLabel = (c) => (c ? `${c.nome}${c.final ? ` •••• ${c.final}` : ""}` : "");
// Valor único da seleção "Forma de pagamento": "f:<forma>" | "c:<cartão>" | "".
export const paymentValue = (f) => (f.card_id ? `c:${f.card_id}` : f.payment_method_id ? `f:${f.payment_method_id}` : "");
// Troca de forma LIMPA o que ficou incompatível (sem banco escondido):
// cartão => sem forma e sem banco; forma sem conta => sem banco; Pix etc. => sem cartão.
export function applyPaymentChoice(state, value, formas) {
  if (!value) return { ...state, payment_method_id: "", card_id: "", bank_account_id: "" };
  const [k, id] = [value.slice(0, 1), value.slice(2)];
  if (k === "c") return { ...state, payment_method_id: "", card_id: id, bank_account_id: "" };
  const forma = (formas || []).find((x) => x.id === id);
  return { ...state, payment_method_id: id, card_id: "", bank_account_id: formaExigeConta(forma) ? state.bank_account_id : "" };
}
// Filtro rápido da tabela da Visão Geral -> status da API.
export const QUICK_FILTERS = [
  { key: "todos", label: "Todos", status: "", color: null },
  { key: "aberto", label: "Em aberto", status: "aberto", color: "var(--fin-info)" },
  { key: "pago", label: "Pago", status: "realizado", color: "var(--fin-success)" },
  { key: "vencido", label: "Vencido", status: "atrasado", color: "var(--fin-danger)" },
];

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

// ---------------- cor dos valores (regra global do Financeiro) ----------------
// Entrada/receita/crédito = verde; saída/débito/desconto = vermelho; o resto
// (valor original, saldo, limite) é neutro. Componente: <Money> / <Amount> (ui.jsx).
export const FLOW_COLOR = { in: "var(--fin-success)", out: "var(--fin-danger)", neutral: "var(--fin-ink)" };
export const flowOf = (type) => (type === "pagar" ? "out" : type === "receber" ? "in" : "neutral");
// Fluxo de um evento do histórico (pelo módulo do registro).
export const flowOfModule = (module) => (module === "pagar" ? "out" : module === "receber" ? "in" : "neutral");

// Alerta de vencimento de um lançamento, SEMPRE pelo saldo em aberto:
//   "atrasado" (vencido com saldo) > "hoje" (vence hoje com saldo) > null.
// Quitado, cancelado ou sem saldo nunca recebe alerta.
export function dueAlert(e, today) {
  if (!(e.status === "pendente" || e.status === "parcial")) return null;
  const aberto = e.open_cents ?? (e.amount_cents - (e.settled_cents || 0));
  if (!(aberto > 0) || !e.due_date) return null;
  if (e.due_date < today) return "atrasado";
  if (e.due_date === today) return "hoje";
  return null;
}

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
for (const [k, nome] of Object.entries({ categoria: "Categoria", forma: "Forma de pagamento", conta: "Conta", cartao: "Cartão", tag: "Tag", subcategoria: "Subcategoria" })) {
  ACOES[`${k}_criado`] = { label: `${nome} criada`, tone: "info" };
  ACOES[`${k}_editado`] = { label: `${nome} editada`, tone: "warning" };
  ACOES[`${k}_inativado`] = { label: `${nome} inativada`, tone: "muted" };
  ACOES[`${k}_reativado`] = { label: `${nome} reativada`, tone: "info" };
  ACOES[`${k}_excluido`] = { label: `${nome} excluída`, tone: "danger" };
}
// DRE
Object.assign(ACOES, {
  dre_grupo_criado: { label: "Grupo DRE criado", tone: "info" },
  dre_grupo_editado: { label: "Grupo DRE editado", tone: "warning" },
  dre_grupo_inativado: { label: "Grupo DRE inativado", tone: "muted" },
  dre_grupo_reativado: { label: "Grupo DRE reativado", tone: "info" },
  dre_grupo_excluido: { label: "Grupo DRE excluído", tone: "danger" },
  dre_reclassificado: { label: "Reclassificação na DRE", tone: "warning" },
  dre_estrutura_editada: { label: "Estrutura da DRE editada", tone: "warning" },
  competencia_alterada: { label: "Competência alterada", tone: "warning" },
  subcategoria_alterada: { label: "Subcategoria alterada", tone: "warning" },
});
// Clientes e Fornecedores (fin_contacts)
Object.assign(ACOES, {
  cliente_criado: { label: "Cliente criado", tone: "info" },
  fornecedor_criado: { label: "Fornecedor criado", tone: "info" },
  cliente_fornecedor_criado: { label: "Cliente e Fornecedor criado", tone: "info" },
  contato_editado: { label: "Cliente/Fornecedor editado", tone: "warning" },
  contato_inativado: { label: "Cadastro inativado", tone: "muted" },
  contato_reativado: { label: "Cadastro reativado", tone: "info" },
  contato_excluido: { label: "Cadastro excluído", tone: "danger" },
  contato_alterado: { label: "Cliente/Fornecedor alterado", tone: "warning" },
});

// Licitações, Execução e Usuários (usuários internos + segurança) — mesmo histórico imutável.
Object.assign(ACOES, {
  licitacao_criada: { label: "Licitação criada", tone: "info" },
  licitacao_editada: { label: "Licitação editada", tone: "warning" },
  licitacao_status_alterado: { label: "Status da licitação alterado", tone: "warning" },
  licitacao_excluida: { label: "Licitação excluída", tone: "danger" },
  licitacao_documento_anexado: { label: "Documento anexado", tone: "info" },
  licitacao_documento_removido: { label: "Documento removido", tone: "muted" },
  execucao_editada: { label: "Execução editada", tone: "warning" },
  execucao_etapa_alterada: { label: "Etapa da execução alterada", tone: "warning" },
  usuario_criado: { label: "Usuário criado", tone: "info" },
  usuario_editado: { label: "Usuário editado", tone: "warning" },
  usuario_ativado: { label: "Usuário ativado", tone: "info" },
  usuario_desativado: { label: "Usuário desativado", tone: "danger" },
  permissoes_alteradas: { label: "Permissões alteradas", tone: "warning" },
  senha_redefinida: { label: "Senha redefinida pelo administrador", tone: "warning" },
  senha_alterada_pelo_usuario: { label: "Senha alterada pelo usuário", tone: "muted" },
  sessoes_encerradas: { label: "Sessões encerradas", tone: "warning" },
  login_realizado: { label: "Login realizado", tone: "muted" },
});

export const MODULOS = { pagar: "A Pagar", receber: "A Receber", bancos: "Bancos", dre: "DRE", config: "Configurações", execucao: "Execução",
  licitacoes: "Licitações", usuarios: "Usuários" };

// Valor legível de um campo alterado no histórico.
export function changeValue(field, v) {
  if (v == null || v === "") return "—";
  if (field.endsWith("_cents")) return money(v);
  if (field === "due_date" || field.endsWith("_date")) return fmtDate(v);
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (field === "status") return STATUS[v]?.label || (v === "parcial" ? "Parcial" : v);
  if (field === "contato_document") return fmtDocument(v);
  if (field === "contato_person_type") return PESSOAS[v] || v;
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

// ---------------- clientes e fornecedores ----------------
export const PAPEIS = { cliente: "Cliente", fornecedor: "Fornecedor", ambos: "Cliente e Fornecedor" };
export const PESSOAS = { pf: "Pessoa Física", pj: "Pessoa Jurídica" };
// Papéis que podem ser escolhidos em cada tipo de lançamento (mesma regra do backend).
export const PAPEIS_DO_TIPO = { pagar: ["fornecedor", "ambos"], receber: ["cliente", "ambos"] };
export const contatoServe = (c, type) => !!c && PAPEIS_DO_TIPO[type]?.includes(c.role);

export const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
// Máscara progressiva (enquanto digita): CPF 000.000.000-00 / CNPJ 00.000.000/0000-00
export function maskDocument(text, personType) {
  const d = onlyDigits(text).slice(0, personType === "pf" ? 11 : 14);
  if (personType === "pf") {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
export const fmtDocument = (d) => {
  const x = onlyDigits(d);
  if (!x) return "—";
  return maskDocument(x, x.length <= 11 ? "pf" : "pj");
};
export function maskPhone(text) {
  const d = onlyDigits(text).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export const maskCep = (text) => { const d = onlyDigits(text).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export function validCpf(text) {
  const d = onlyDigits(text);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(d[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}
export function validCnpj(text) {
  const d = onlyDigits(text);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [12, 13]) {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(d[i]) * pesos[i];
    const dv = 11 - (s % 11);
    if ((dv >= 10 ? 0 : dv) !== Number(d[n])) return false;
  }
  return true;
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
  dre: (params) => api.get("/fin/dre", { params }).then((r) => r.data),
  dreLancamentos: (params) => api.get("/fin/dre/lancamentos", { params }).then((r) => r.data),
  dreClassificarPendentes: () => api.post("/fin/dre/classificar-pendentes").then((r) => r.data),
  dreTitulos: () => api.get("/fin/dre/titulos").then((r) => r.data),
  dreSalvarTitulos: (titles) => api.put("/fin/dre/titulos", { titles }).then((r) => r.data),
  descricoesRecentes: () => api.get("/fin/descricoes-recentes").then((r) => r.data.items || []),
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
  contatos: (params) => api.get("/fin/contatos", { params }).then((r) => r.data),
  contato: (id) => api.get(`/fin/contatos/${id}`).then((r) => r.data),
  criarContato: (body) => api.post("/fin/contatos", body).then((r) => r.data),
  editarContato: (id, body) => api.put(`/fin/contatos/${id}`, body).then((r) => r.data),
  excluirContato: (id) => api.delete(`/fin/contatos/${id}`).then((r) => r.data),
  sugestaoContato: (nome, type = "receber") => api.get("/fin/contatos/sugestao", { params: { nome, type } }).then((r) => r.data.item),
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
