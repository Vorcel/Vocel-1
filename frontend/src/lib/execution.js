// Lógica de timeline da Execução & Pós-Venda (11 etapas, status por nó).
// Normaliza execuções antigas (10 etapas originais sem status por nó, 11 com
// "Solicitar Atestado", ou 10 sem "Aguardando Pagamento") para o formato atual
// SEM tocar no banco — a gravação só acontece quando o usuário interage.
import { TIMELINE_STEPS, ATESTADO_OPTIONS, ATESTADO_DEFAULT } from "@/lib/constants";

export const STEP_PENDING = "Pendente";
export const STEP_ACTIVE = "Em Andamento";
export const STEP_DONE = "Concluído";

const RANK = { [STEP_PENDING]: 0, [STEP_ACTIVE]: 1, [STEP_DONE]: 2 };
const mostAdvanced = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a);

// Mapa de nomes da timeline original (10 etapas antigas) -> atual.
const LEGACY_MAP = {
  "Aguardando Empenho": "Aguardando Empenho",
  "Empenho Recebido": "Empenho Recebido",
  "Pedido de Compra": "Comprar Mercadoria",
  "Aguardando Mercadoria": "Aguardando Mercadoria",
  "Mercadoria Recebida": "Mercadoria Recebida",
  "Faturamento / NF": "Emitir NF",
  "Expedição": "Preparar para Transporte",
  "Em Transporte": "Em Transporte",
  "Entregue": "Entregue",
  "Concluído": "Pagamento Recebido",
};

// Etapa removida da timeline (virou o campo `atestado`). Execuções antigas que
// estavam nela são tratadas como "Entregue" — etapa imediatamente anterior.
const LEGACY_ATESTADO_STEP = "Solicitar Atestado";

// Retorna sempre TIMELINE_STEPS.length nós: [{ step, name, status, files }] na ordem oficial.
export function normalizeTimeline(execution) {
  const raw = Array.isArray(execution?.timeline) ? execution.timeline : [];
  const byName = {};
  TIMELINE_STEPS.forEach((name, i) => {
    byName[name] = { step: i, name, status: STEP_PENDING, files: [] };
  });

  const legacyCurrent = Number(execution?.current_step || 0);
  let legacyAtestadoActive = false;

  raw.forEach((node, i) => {
    if (!node) return;
    const st = node.status || (i < legacyCurrent ? STEP_DONE : i === legacyCurrent ? STEP_ACTIVE : STEP_PENDING);
    if (node.name === LEGACY_ATESTADO_STEP) {
      // Etapa removida: arquivos anexados nela migram para "Entregue" (nada se perde);
      // se era a etapa atual, a execução passa a estar "em Entregue".
      if (Array.isArray(node.files) && node.files.length) {
        byName["Entregue"].files = [...byName["Entregue"].files, ...node.files];
      }
      if (st === STEP_ACTIVE) legacyAtestadoActive = true;
      return;
    }
    const newName = byName[node.name] ? node.name : LEGACY_MAP[node.name];
    if (!newName || !byName[newName]) return;
    if (Array.isArray(node.files) && node.files.length) {
      byName[newName].files = [...byName[newName].files, ...node.files];
    }
    byName[newName].status = mostAdvanced(byName[newName].status, st);
  });

  // Execução antiga parada em "Solicitar Atestado" (logo antes de "Pagamento
  // Recebido"): vira "Entregue" em andamento — salvo se o pagamento já foi concluído.
  if (legacyAtestadoActive && byName["Pagamento Recebido"].status !== STEP_DONE) {
    byName["Entregue"].status = STEP_ACTIVE;
    byName["Pagamento Recebido"].status = STEP_PENDING;
  }

  // Invariante do fluxo sequencial: tudo ANTES da etapa mais avançada está concluído.
  // Garante que etapas inseridas depois (ex.: "Aguardando Pagamento", ausente nos
  // registros antigos) não "puxem" a etapa atual para trás: uma execução antiga em
  // "Pagamento Recebido" continua em "Pagamento Recebido"; uma 100% continua 100%.
  const nodes = TIMELINE_STEPS.map((name) => byName[name]);
  let last = -1;
  nodes.forEach((n, i) => { if (n.status !== STEP_PENDING) last = i; });
  for (let i = 0; i < last; i++) nodes[i].status = STEP_DONE;
  return nodes;
}

export function doneCount(nodes) {
  return nodes.filter((n) => n.status === STEP_DONE).length;
}

// Status sequencial derivado da etapa atual (fluxo cronológico):
// anteriores -> Concluído, atual -> Em Andamento, posteriores -> Pendente.
export function statusForIndex(idx, currentStep) {
  if (idx < currentStep) return STEP_DONE;
  if (idx === currentStep) return STEP_ACTIVE;
  return STEP_PENDING;
}

export function progressOf(nodes) {
  return Math.round((doneCount(nodes) / TIMELINE_STEPS.length) * 100);
}

// Etapa "atual" para badges: primeiro nó Em Andamento; senão o primeiro não concluído;
// se tudo concluído, a última etapa.
export function currentStage(nodes) {
  const active = nodes.find((n) => n.status === STEP_ACTIVE);
  if (active) return active.name;
  const pending = nodes.find((n) => n.status !== STEP_DONE);
  return pending ? pending.name : TIMELINE_STEPS[TIMELINE_STEPS.length - 1];
}

export function isPaid(nodes) {
  return nodes.find((n) => n.name === "Pagamento Recebido")?.status === STEP_DONE;
}

// Card "Pagamentos Pendentes": conta a execução SOMENTE quando a etapa atual está
// entre "Empenho Recebido" (inclusive) e antes de "Pagamento Recebido".
// Usa a posição real da etapa atual na timeline (currentStage) — não texto solto.
// Exclui "Aguardando Empenho" (índice 0) e "Pagamento Recebido" (última). "Aguardando
// Pagamento" (penúltima) conta como pendente.
export function isPaymentPending(nodes) {
  const idx = TIMELINE_STEPS.indexOf(currentStage(nodes));
  return idx >= 1 && idx < TIMELINE_STEPS.length - 1;
}

// ---- Atestado de Capacidade Técnica (campo independente da timeline) ----
const ATESTADO_RANK = Object.fromEntries(ATESTADO_OPTIONS.map((o, i) => [o.nome, i]));

// Valor efetivo do atestado; registros antigos sem o campo valem "Não solicitado".
export function atestadoOf(execution) {
  const v = execution?.atestado;
  return v in ATESTADO_RANK ? v : ATESTADO_DEFAULT;
}

// Posição na sequência lógica (Não solicitado < Solicitado < Recebido) — ordenação.
export function atestadoRank(execution) {
  return ATESTADO_RANK[atestadoOf(execution)];
}

export function atestadoColor(value) {
  return ATESTADO_OPTIONS.find((o) => o.nome === value)?.cor || ATESTADO_OPTIONS[0].cor;
}

// Card "Solicitar Atestados": atestado pendente = qualquer estado != "Recebido"
// ("Não solicitado" ou "Solicitado"), e só a partir de "Entregue" concluído —
// regra de momento preservada da etapa antiga (antes disso o atestado não se aplica).
export function isAtestadoPending(execution, nodes) {
  const entregue = nodes.find((n) => n.name === "Entregue")?.status === STEP_DONE;
  return entregue && atestadoOf(execution) !== "Recebido";
}

// Status que exigem ação do usuário (para o KPI "Aguardando Ação").
export const ACTION_STAGES = new Set([
  "Comprar Mercadoria",
  "Preparar para Transporte",
  "Emitir NF",
]);

// Fases agregadas para a barra de status (GROUP BY) na visão consolidada.
export const PHASE_GROUPS = [
  { key: "empenho", label: "Aguardando Empenho", color: "#F59E0B", steps: ["Aguardando Empenho", "Empenho Recebido"] },
  { key: "compra", label: "Comprar produtos", color: "#EF4444", steps: ["Comprar Mercadoria", "Aguardando Mercadoria", "Mercadoria Recebida"] },
  { key: "transporte", label: "Em Transporte", color: "#3B82F6", steps: ["Preparar para Transporte", "Emitir NF", "Em Transporte"] },
  { key: "entregue", label: "Entregues (Mês)", color: "#10B981", steps: ["Entregue", "Aguardando Pagamento", "Pagamento Recebido"] },
];

// Cor do badge de Status por etapa. Padrão = cor da fase (PHASE_GROUPS); etapas de
// espera podem ter cor própria (âmbar, a mesma de "Aguardando Empenho").
// As etapas da timeline não são configuráveis em Configurações (só os status da licitação).
const STAGE_COLOR_OVERRIDES = { "Aguardando Pagamento": "#F59E0B" };
export function stageColor(stageName) {
  if (STAGE_COLOR_OVERRIDES[stageName]) return STAGE_COLOR_OVERRIDES[stageName];
  const g = PHASE_GROUPS.find((p) => p.key === phaseOfStage(stageName));
  return g ? g.color : "#0C7B93";
}

const STAGE_TO_PHASE = {};
PHASE_GROUPS.forEach((g) => g.steps.forEach((s) => { STAGE_TO_PHASE[s] = g.key; }));
export function phaseOfStage(stageName) {
  return STAGE_TO_PHASE[stageName] || PHASE_GROUPS[0].key;
}

// Está atrasado? Data de entrega no passado e ainda não entregue.
export function isLate(execution, nodes) {
  const d = execution?.data_entrega;
  if (!d) return false;
  const entregue = nodes.find((n) => n.name === "Entregue")?.status === STEP_DONE;
  return !entregue && d < new Date().toISOString().slice(0, 10);
}
