// Remessas da Execução & Pós-Venda — regras de exibição/consolidação (puras).
//
// Uma licitação continua sendo UMA linha; as remessas são as unidades
// operacionais dela (timeline, prazo, atestado, documentos e orçamento próprios).
// Enquanto a execução não tem remessas, ela própria é exibida como "Remessa 1"
// (unidade virtual): nada muda no banco até o usuário criar a primeira remessa nova.
//
// Valores: o backend já devolve `valor_original` (orçamento adjudicado) e, com
// remessas, `valor_empenho` / `valor_compra` / `lucro_previsto` = SOMA das remessas.
// Original e remessas são indicadores diferentes e nunca são somados entre si.
import { TIMELINE_STEPS } from "@/lib/constants";
import { normalizeTimeline, progressOf, currentStage } from "@/lib/execution";

export const hasRemessas = (e) => Array.isArray(e?.remessas) && e.remessas.length > 0;

// Unidades operacionais da execução, na ordem: remessas reais ou a própria
// execução como "Remessa 1" (virtual, `id: null`).
export function unitsOf(e) {
  if (!e) return [];
  if (hasRemessas(e)) return e.remessas.map((r) => ({ ...r, bid_id: e.bid_id, virtual: false }));
  return [{ ...e, id: null, numero: 1, nome: "Remessa 1", resumo: e.resumo_original, virtual: true }];
}

export function unitView(u) {
  const nodes = normalizeTimeline(u);
  return { unit: u, nodes, stage: currentStage(nodes), progress: progressOf(nodes) };
}

const stageIdx = (stage) => TIMELINE_STEPS.indexOf(stage);

// Visão consolidada da LICITAÇÃO (linha principal).
// - Sem remessas: exatamente a lógica de sempre (timeline da execução).
// - Com remessas:
//   * concluída (100%) só quando TODAS as remessas chegaram a "Pagamento Recebido";
//     uma remessa reaberta devolve a licitação para "Em andamento" na hora;
//   * progresso = média PONDERADA pelo empenho de cada remessa (o que representa
//     o fornecimento real) — média simples se nenhuma tiver valor — limitada a 99%
//     enquanto houver remessa pendente;
//   * etapa/status = a da remessa MENOS avançada ainda em andamento (onde a
//     licitação de fato está); `rep` é essa remessa (prazo exibido na linha).
export function execView(e) {
  const units = unitsOf(e).map(unitView);
  if (!hasRemessas(e)) {
    const v = units[0];
    return { units, nodes: v.nodes, stage: v.stage, progress: v.progress, rep: v };
  }
  const done = units.every((v) => v.progress === 100);
  const total = units.reduce((s, v) => s + Math.max(0, Number(v.unit.valor_empenho) || 0), 0);
  const avg = total > 0
    ? units.reduce((s, v) => s + v.progress * Math.max(0, Number(v.unit.valor_empenho) || 0), 0) / total
    : units.reduce((s, v) => s + v.progress, 0) / units.length;
  const pendentes = units.filter((v) => v.progress < 100);
  const rep = pendentes.length
    ? pendentes.reduce((a, b) => (stageIdx(b.stage) < stageIdx(a.stage) ? b : a))
    : units[units.length - 1];
  return {
    units,
    nodes: rep.nodes,
    stage: done ? TIMELINE_STEPS[TIMELINE_STEPS.length - 1] : rep.stage,
    progress: done ? 100 : Math.min(99, Math.round(avg)),
    rep,
  };
}

// Remessa selecionada por padrão ao abrir a licitação: a primeira ainda em
// andamento; se todas concluídas, a última. Sem remessas: null (a execução).
export function defaultRemessaId(e) {
  if (!hasRemessas(e)) return null;
  const pend = e.remessas.find((r) => progressOf(normalizeTimeline(r)) < 100);
  return (pend || e.remessas[e.remessas.length - 1]).id;
}

const fmtQtdNum = (q) => Number(q || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
export const fmtUnidades = (q) => `${fmtQtdNum(q)} ${Math.abs(Number(q || 0)) === 1 ? "unidade" : "unidades"}`;

// "Telefone IP - 10 unidades" / "Telefone IP + 2 itens - 30 unidades".
export function resumoLabel(resumo) {
  if (!resumo || !resumo.produto) return "Sem itens selecionados no orçamento";
  const extra = resumo.itens > 1 ? ` + ${resumo.itens - 1} ${resumo.itens - 1 === 1 ? "item" : "itens"}` : "";
  return `${resumo.produto}${extra} - ${fmtUnidades(resumo.qtd)}`;
}

// Diferença entre o executado (remessas) e o original, sem sinal negativo na tela:
// abaixo -> "Saldo restante", igual -> "Totalmente distribuído", acima -> "Excedente".
export function comparar(original, executado, tolerancia = 0.005) {
  const diff = Number(executado || 0) - Number(original || 0);
  if (Math.abs(diff) <= tolerancia) return { tipo: "igual", valor: 0 };
  return diff < 0 ? { tipo: "saldo", valor: -diff } : { tipo: "excedente", valor: diff };
}

export const COMPARACAO_LABEL = { saldo: "Saldo restante", igual: "Totalmente distribuído", excedente: "Excedente" };

// Quantidade total das remessas x quantidade do orçamento original.
export function quantidades(e) {
  const original = Number(e?.resumo_original?.qtd || 0);
  const remessas = (e?.remessas || []).reduce((s, r) => s + Number(r?.resumo?.qtd || 0), 0);
  return { original, remessas, ...comparar(original, remessas, 0.0001) };
}
