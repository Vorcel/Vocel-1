import { TIMELINE_STEPS, ATESTADO_DEFAULT } from "@/lib/constants";
import {
  normalizeTimeline, progressOf, doneCount, currentStage, isPaymentPending,
  atestadoOf, atestadoRank, isAtestadoPending, ACTION_STAGES, PHASE_GROUPS,
  STEP_PENDING, STEP_ACTIVE, STEP_DONE,
} from "@/lib/execution";

// Timeline antiga (11 etapas, com "Solicitar Atestado") no modelo sequencial.
const OLD_11 = [
  "Aguardando Empenho", "Empenho Recebido", "Comprar Mercadoria", "Aguardando Mercadoria",
  "Mercadoria Recebida", "Preparar para Transporte", "Emitir NF", "Em Transporte",
  "Entregue", "Solicitar Atestado", "Pagamento Recebido",
];
const legacy11 = (current, extra = {}) => ({
  current_step: current,
  timeline: OLD_11.map((name, i) => ({
    step: i, name, files: [],
    status: i < current ? STEP_DONE : i === current ? STEP_ACTIVE : STEP_PENDING,
    ...(extra[name] || {}),
  })),
});

test("timeline oficial tem exatamente 11 etapas, com Aguardando Pagamento e sem Solicitar Atestado", () => {
  expect(TIMELINE_STEPS).toHaveLength(11);
  expect(TIMELINE_STEPS).not.toContain("Solicitar Atestado");
  expect(TIMELINE_STEPS[8]).toBe("Entregue");
  expect(TIMELINE_STEPS[9]).toBe("Aguardando Pagamento");
  expect(TIMELINE_STEPS[10]).toBe("Pagamento Recebido");
});

test("nenhum agregado depende da etapa removida", () => {
  expect(ACTION_STAGES.has("Solicitar Atestado")).toBe(false);
  PHASE_GROUPS.forEach((g) => expect(g.steps).not.toContain("Solicitar Atestado"));
});

test("progresso usa 11 etapas: 5 concluídas = 45%", () => {
  const nodes = normalizeTimeline(legacy11(5));
  expect(nodes).toHaveLength(11);
  expect(doneCount(nodes)).toBe(5);
  expect(progressOf(nodes)).toBe(45);
  expect(currentStage(nodes)).toBe("Preparar para Transporte");
});

test("Aguardando Pagamento: penúltima, < 100%, pagamento pendente; só Pagamento Recebido = 100%", () => {
  const at = (cur) => normalizeTimeline({ timeline: TIMELINE_STEPS.map((name, i) => ({ step: i, name, status: i < cur ? STEP_DONE : i === cur ? STEP_ACTIVE : STEP_PENDING })) });
  const ap = at(9);
  expect(currentStage(ap)).toBe("Aguardando Pagamento");
  expect(progressOf(ap)).toBe(82);
  expect(isPaymentPending(ap)).toBe(true);
  const pr = at(10);
  expect(currentStage(pr)).toBe("Pagamento Recebido");
  expect(progressOf(pr)).toBe(91);
  const done = at(11);
  expect(progressOf(done)).toBe(100);
  expect(isPaymentPending(done)).toBe(false);
});

test("legado de 10 etapas (sem Aguardando Pagamento): em Entregue fica em Entregue; em Pagamento Recebido fica lá; 100% continua 100%", () => {
  const OLD10 = TIMELINE_STEPS.filter((n) => n !== "Aguardando Pagamento");
  const at = (cur) => normalizeTimeline({ timeline: OLD10.map((name, i) => ({ step: i, name, status: i < cur ? STEP_DONE : i === cur ? STEP_ACTIVE : STEP_PENDING })) });
  expect(currentStage(at(8))).toBe("Entregue");
  expect(progressOf(at(8))).toBe(73);
  expect(currentStage(at(9))).toBe("Pagamento Recebido");   // não cai para Aguardando Pagamento
  expect(progressOf(at(9))).toBe(91);
  expect(progressOf(at(10))).toBe(100);
});

test("legado parado em Solicitar Atestado -> fica em Entregue (73%), arquivos migram", () => {
  const file = { id: "f1", filename: "atestado.pdf" };
  const nodes = normalizeTimeline(legacy11(9, { "Solicitar Atestado": { files: [file] } }));
  expect(nodes).toHaveLength(11);
  expect(currentStage(nodes)).toBe("Entregue");
  expect(nodes[8].status).toBe(STEP_ACTIVE);
  expect(nodes[9].status).toBe(STEP_PENDING);
  expect(nodes[10].status).toBe(STEP_PENDING);
  expect(doneCount(nodes)).toBe(8);
  expect(progressOf(nodes)).toBe(73);
  expect(nodes[8].files).toEqual([file]);
});

test("legado com Solicitar Atestado concluído e pagamento em andamento -> Pagamento Recebido, 91%", () => {
  const nodes = normalizeTimeline(legacy11(10));
  expect(currentStage(nodes)).toBe("Pagamento Recebido");
  expect(progressOf(nodes)).toBe(91);
});

test("legado 100% (tudo concluído, inclusive Solicitar Atestado) continua 100%", () => {
  const nodes = normalizeTimeline(legacy11(11));
  expect(doneCount(nodes)).toBe(11);
  expect(progressOf(nodes)).toBe(100);
  expect(isPaymentPending(nodes)).toBe(false);
});

test("timeline original (10 etapas antigas, sem status por nó) continua funcionando", () => {
  const OLD_10 = ["Aguardando Empenho", "Empenho Recebido", "Pedido de Compra", "Aguardando Mercadoria",
    "Mercadoria Recebida", "Faturamento / NF", "Expedição", "Em Transporte", "Entregue", "Concluído"];
  const nodes = normalizeTimeline({ current_step: 3, timeline: OLD_10.map((name, i) => ({ step: i, name })) });
  expect(nodes).toHaveLength(11);
  expect(doneCount(nodes)).toBe(3);
  expect(currentStage(nodes)).toBe("Aguardando Mercadoria");
});

test("atestado: default retrocompatível, ordenação e independência do progresso", () => {
  expect(atestadoOf({})).toBe(ATESTADO_DEFAULT);
  expect(atestadoOf({ atestado: "qualquer coisa" })).toBe("Não solicitado");
  expect(atestadoRank({ atestado: "Não solicitado" })).toBe(0);
  expect(atestadoRank({ atestado: "Solicitado" })).toBe(1);
  expect(atestadoRank({ atestado: "Recebido" })).toBe(2);

  // Pagamento recebido (100%) + Não solicitado é válido: progresso não muda.
  const done = normalizeTimeline(legacy11(11));
  expect(progressOf(done)).toBe(100);
  expect(atestadoOf({ ...legacy11(11), atestado: "Não solicitado" })).toBe("Não solicitado");
});

test("card Solicitar Atestados: pendente = != Recebido, a partir de Entregue concluído", () => {
  const entregue = normalizeTimeline(legacy11(10));      // Entregue concluído (pagamento em andamento)
  const antes = normalizeTimeline(legacy11(7));          // Em Transporte
  expect(isAtestadoPending({ atestado: "Não solicitado" }, entregue)).toBe(true);
  expect(isAtestadoPending({ atestado: "Solicitado" }, entregue)).toBe(true);
  expect(isAtestadoPending({ atestado: "Recebido" }, entregue)).toBe(false);
  expect(isAtestadoPending({}, entregue)).toBe(true);    // registro antigo sem campo
  expect(isAtestadoPending({ atestado: "Não solicitado" }, antes)).toBe(false);
});
