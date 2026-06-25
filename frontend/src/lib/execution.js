// Lógica de timeline da Execução & Pós-Venda (11 etapas, status por nó).
// Normaliza execuções antigas (10 etapas, sem status por nó) para o novo formato
// SEM tocar no banco — a gravação só acontece quando o usuário interage.
import { TIMELINE_STEPS } from "@/lib/constants";

export const STEP_PENDING = "Pendente";
export const STEP_ACTIVE = "Em Andamento";
export const STEP_DONE = "Concluído";

const RANK = { [STEP_PENDING]: 0, [STEP_ACTIVE]: 1, [STEP_DONE]: 2 };
const mostAdvanced = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a);

// Mapa de nomes da timeline antiga (10 etapas) -> nova (11 etapas).
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

// Retorna sempre 11 nós: [{ step, name, status, files }] na ordem oficial.
export function normalizeTimeline(execution) {
  const raw = Array.isArray(execution?.timeline) ? execution.timeline : [];
  const byName = {};
  TIMELINE_STEPS.forEach((name, i) => {
    byName[name] = { step: i, name, status: STEP_PENDING, files: [] };
  });

  const hasNodeStatus = raw.some((n) => n && n.status);
  const legacyCurrent = Number(execution?.current_step || 0);

  raw.forEach((node, i) => {
    if (!node) return;
    const newName = byName[node.name] ? node.name : LEGACY_MAP[node.name];
    if (!newName || !byName[newName]) return;
    if (Array.isArray(node.files) && node.files.length) {
      byName[newName].files = [...byName[newName].files, ...node.files];
    }
    const st = node.status || (i < legacyCurrent ? STEP_DONE : i === legacyCurrent ? STEP_ACTIVE : STEP_PENDING);
    byName[newName].status = mostAdvanced(byName[newName].status, st);
  });

  // Legado: se "Pagamento Recebido" (antigo "Concluído") já estava concluído,
  // marca "Solicitar Atestado" como concluído também (etapa nova sem equivalente).
  if (!hasNodeStatus && byName["Pagamento Recebido"].status === STEP_DONE) {
    byName["Solicitar Atestado"].status = STEP_DONE;
  }

  return TIMELINE_STEPS.map((name) => byName[name]);
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

export function needsAtestado(nodes) {
  const entregue = nodes.find((n) => n.name === "Entregue")?.status === STEP_DONE;
  const atestado = nodes.find((n) => n.name === "Solicitar Atestado")?.status === STEP_DONE;
  return entregue && !atestado;
}

// Status que exigem ação do usuário (para o KPI "Aguardando Ação").
export const ACTION_STAGES = new Set([
  "Comprar Mercadoria",
  "Preparar para Transporte",
  "Emitir NF",
  "Solicitar Atestado",
]);

// Fases agregadas para a barra de status (GROUP BY) na visão consolidada.
export const PHASE_GROUPS = [
  { key: "empenho", label: "Aguardando Empenho", color: "#F59E0B", steps: ["Aguardando Empenho", "Empenho Recebido"] },
  { key: "compra", label: "Comprar produtos", color: "#EF4444", steps: ["Comprar Mercadoria", "Aguardando Mercadoria", "Mercadoria Recebida"] },
  { key: "transporte", label: "Em Transporte", color: "#3B82F6", steps: ["Preparar para Transporte", "Emitir NF", "Em Transporte"] },
  { key: "entregue", label: "Entregues (Mês)", color: "#10B981", steps: ["Entregue", "Solicitar Atestado", "Pagamento Recebido"] },
];

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
