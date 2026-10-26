import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, TrendingUp, Activity, FileText, Clock, Wallet,
  Plus, ShoppingCart, Package as PackageIcon, Receipt, Banknote, ClipboardCheck,
  ClipboardList, AlertTriangle, AlertCircle, Award, Hourglass, Boxes, CircleCheck,
  Pencil, Archive, ArrowLeft, ArrowUp, ArrowDown, Minus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FileX, Trash2, PackagePlus,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBar } from "@/components/bids/FilterBar";
import { AdvancedFilterSidebar } from "@/components/bids/AdvancedFilterSidebar";
import { DatePickerInput } from "@/components/DatePickerInput";
import { BidFormModal } from "@/components/bids/BidFormModal";
import { PortalModalidade } from "@/components/bids/PortalModalidade";
import { StatusBadge } from "@/components/StatusBadge";
import { AtestadoDropdown } from "@/components/execution/AtestadoDropdown";
import { TimelineProgressBar } from "@/components/execution/TimelineProgressBar";
import { DocumentHub } from "@/components/execution/DocumentHub";
import { usePropostaFlow } from "@/components/bids/PropostaFlow";
import { SortArrows } from "@/components/table/SortArrows";
import { StickyHorizontalScrollbar } from "@/components/table/StickyHorizontalScrollbar";
import { usePersistentSort } from "@/hooks/usePersistentSort";
import { usePersistentPageSize, PAGE_SIZE_OPTIONS } from "@/hooks/usePersistentPageSize";
import { useData } from "@/context/DataContext";
import { formatApiError } from "@/lib/api";
import { brl } from "@/lib/calc";
import { addDaysByType } from "@/lib/businessDays";
import { TIMELINE_STEPS } from "@/lib/constants";
import {
  doneCount, currentStage, isPaid, isPaymentPending, isLate, statusForIndex,
  atestadoOf, atestadoRank, isAtestadoPending, stageColor,
  ACTION_STAGES, PHASE_GROUPS, phaseOfStage, STEP_PENDING, STEP_ACTIVE, STEP_DONE,
} from "@/lib/execution";
import {
  hasRemessas, unitsOf, unitView, execView, defaultRemessaId, resumoLabel, comparar, quantidades,
  fmtUnidades, COMPARACAO_LABEL,
} from "@/lib/remessas";
import { matchesDigits } from "@/lib/search";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Filtros: mesmo formato/estado da Página Inicial (FilterBar + AdvancedFilterSidebar).
// `status` = fases da timeline (multi); `atestado` = campo independente; `data` = data da disputa.
const EMPTY_FILTERS = {
  objeto: "", pregao: "", uasg: "", orgao: "", data: { from: "", to: "" },
  portal: "", modalidade: "", status: [], atestado: "",
};
// Ícone por NOME de etapa (a ordem vem só de TIMELINE_STEPS — nada posicional).
const STEP_ICONS = {
  "Aguardando Empenho": FileText, "Empenho Recebido": ClipboardCheck, "Comprar Mercadoria": ShoppingCart,
  "Aguardando Mercadoria": Hourglass, "Mercadoria Recebida": PackageIcon, "Preparar para Transporte": Boxes,
  "Emitir NF": Receipt, "Em Transporte": Truck, "Entregue": CircleCheck,
  "Aguardando Pagamento": Wallet, "Pagamento Recebido": Banknote,
};
// Roxo da etapa ativa (ref 5).
const ACTIVE_PURPLE = "#7C3AED";

// Colunas da tabela de execução — `sort` = chave ordenável; `num` ordena numérico.
const EXEC_COLS = [
  { label: "Data", sort: "data", type: "text" },
  { label: "Portal / Modalidade", sort: "portal", type: "text" },
  { label: "Órgão", sort: "orgao", type: "text" },
  { label: "Objeto" },
  { label: "Entrega", sort: "entrega", type: "num" },
  { label: "Data Entrega", sort: "data_entrega", type: "text" },
  { label: "Empenho", sort: "empenho", type: "num" },
  { label: "Compra", sort: "compra", type: "num" },
  { label: "Lucro Previsto", sort: "lucro", type: "num" },
  { label: "Status", sort: "status", type: "num" },
  { label: "Progresso", sort: "progresso", type: "num" },
  { label: "Atestado", sort: "atestado", type: "num" },
  { label: "Ações" },
];

// Grupos da tabela (organização visual): separados pelo progresso REAL (progressOf),
// mesma regra da coluna/barra. Atestado não entra. Padrão: Em andamento aberto, Concluídas recolhido.
const GROUPS = [
  { key: "andamento", label: "Em andamento", defaultOpen: true, test: (p) => p < 100 },
  { key: "concluidas", label: "Concluídas", defaultOpen: false, test: (p) => p === 100 },
];
const FIRST_PAGES = { andamento: 1, concluidas: 1 };

// Largura visível do container de rolagem — usada para fixar (sticky) a barra do
// grupo e o rodapé de paginação na área visível quando a tabela é mais larga.
function useVisibleWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// Cartão das remessas: recuo externo (margem) e recuo total até o conteúdo da
// tabela interna (margem + padding) — usados para alinhar colunas. As bordas do
// cartão são `ring` (sombra), que não ocupam espaço: o recuo é exato em qualquer zoom.
const REM_OUT = 12;
const REM_INSET = REM_OUT + 12;

// Posição/largura de cada coluna da tabela principal (th[data-col]), relativas à
// própria tabela. Remedida quando a tabela muda de tamanho.
function useColumnGeometry(ref) {
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return undefined;
    const measure = () => {
      const ths = [...table.querySelectorAll("th[data-col]")].slice(0, EXEC_COLS.length);
      if (ths.length < EXEC_COLS.length) return;
      const base = table.getBoundingClientRect().left;
      const r2 = (n) => Math.round(n * 100) / 100;
      const lefts = ths.map((th) => r2(th.getBoundingClientRect().left - base));
      const widths = ths.map((th) => r2(th.getBoundingClientRect().width));
      // Recuo REAL da tabela do cartão (o zoom da tela arredonda bordas/paddings);
      // antes de existir um cartão aberto, vale o recuo teórico.
      const inner = table.querySelector("table[data-rem-table]");
      const inset = inner ? r2(inner.getBoundingClientRect().left - base) : REM_INSET;
      setGeo((prev) => (prev && prev.inset === inset && prev.lefts.join() === lefts.join() && prev.widths.join() === widths.join() ? prev : { lefts, widths, inset }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
  });
  return geo;
}

const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? (d.length === 10 ? d.split("-").reverse().join("/") : new Date(d).toLocaleDateString("pt-BR")) : "--");
const addDays = (dateStr, days) => {
  if (!dateStr) return "";
  const base = new Date((dateStr.length === 10 ? dateStr : dateStr.slice(0, 10)) + "T00:00:00");
  base.setDate(base.getDate() + Number(days || 0));
  return iso(base);
};
const pct = (cur, old) => {
  if (!old) return cur > 0 ? 100 : 0;
  return Math.round(((cur - old) / old) * 100);
};

// Janela de comparação: com filtro de data -> período vs período anterior de
// igual duração; sem filtro -> mês atual vs mês anterior.
function periodBounds(from, to) {
  if (from && to) {
    const d1 = new Date(from + "T00:00:00");
    const d2 = new Date(to + "T00:00:00");
    const dur = Math.round((d2 - d1) / 86400000) + 1;
    const pTo = new Date(d1); pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - dur + 1);
    return { cur: [from, to], prev: [iso(pFrom), iso(pTo)] };
  }
  const n = new Date();
  const cF = new Date(n.getFullYear(), n.getMonth(), 1);
  const cT = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  const pF = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  const pT = new Date(n.getFullYear(), n.getMonth(), 0);
  return { cur: [iso(cF), iso(cT)], prev: [iso(pF), iso(pT)] };
}
const inWindow = (d, [a, b]) => d >= a && d <= b;

export default function Execution() {
  const { executions, bids, refreshExecutions, changeStatus, updateExecution, prefs, saveExecutionGroup,
    addExecutionDoc, removeExecutionDoc, addBidAnexo, removeBidAnexo,
    createRemessa, updateRemessa, deleteRemessa, addRemessaDoc, removeRemessaDoc } = useData();
  const navigate = useNavigate();
  // Proposta: o MESMO fluxo (upload / leitura rápida / substituição) de Todas
  // as Licitações, sobre o mesmo documento da licitação.
  const { abrirProposta, propostaModals } = usePropostaFlow();

  const [selectedId, setSelectedId] = useState(null); // null => Componente A (dashboard)
  // Remessa ativa da licitação selecionada (undefined = a padrão; null = a própria
  // execução, enquanto ela não tem remessas).
  const [selectedRemessaId, setSelectedRemessaId] = useState(undefined);
  const [expanded, setExpanded] = useState(() => new Set());   // licitações com as remessas abertas
  const [novaRemessa, setNovaRemessa] = useState(null);         // execução onde criar a remessa
  const [excluirRemessa, setExcluirRemessa] = useState(null);   // { execution, unit }
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [addWonOpen, setAddWonOpen] = useState(false);
  const [editBid, setEditBid] = useState(null);     // bid em edição rápida (lápis)
  const [encerrarTarget, setEncerrarTarget] = useState(null); // execução a encerrar (status -> Encerrado)
  const [timeModal, setTimeModal] = useState(null);   // editar prazo de entrega
  const [pages, setPages] = useState(FIRST_PAGES);   // página atual de cada grupo
  // Registros por página persistidos por usuário (backend); padrão 10.
  const [pageSize, setPageSize] = usePersistentPageSize("executions", 10);
  const tableScrollRef = useRef(null);
  const visibleWidth = useVisibleWidth(tableScrollRef);
  const tableRef = useRef(null);
  const colGeo = useColumnGeometry(tableRef);
  // Ordenação persistida por usuário; padrão = ordem do backend (created_at desc).
  const [sort, toggleSort] = usePersistentSort("executions", { key: null, dir: "asc" });

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const bidsById = useMemo(() => Object.fromEntries((bids || []).map((b) => [b.id, b])), [bids]);
  // Órgão vem da licitação vinculada (fonte de verdade); a execução guarda um espelho.
  const orgaoOf = (e) => (bidsById[e.bid_id]?.orgao ?? e.orgao ?? "").trim();
  // Visão de cada licitação: unidades (remessas, ou a execução como Remessa 1) +
  // consolidado da linha principal (etapa, progresso). Regras em lib/remessas.js.
  const viewsById = useMemo(
    () => Object.fromEntries((executions || []).map((e) => [e.bid_id, execView(e)])),
    [executions]
  );
  const viewOf = (e) => viewsById[e.bid_id] || execView(e);

  // Dados da licitação vinculada (fonte atualizada); a execução guarda espelhos.
  const bidField = (e, k) => String(bidsById[e.bid_id]?.[k] ?? e[k] ?? "");
  const disputaOf = (e) => bidField(e, "data_disputa") || e.data_cadastro || "";
  const has = (v, q) => v.toLowerCase().includes(q.toLowerCase());

  // Conjunto base: filtros não-temporais (mesma semântica da Página Inicial —
  // texto parcial sem diferenciar maiúsculas; status = fases da timeline, multi).
  const baseSet = useMemo(() => (executions || []).filter((e) => {
    if (filters.objeto && !has(bidField(e, "objeto"), filters.objeto)) return false;
    if (filters.pregao && !matchesDigits(bidField(e, "pregao"), filters.pregao)) return false;  // só dígitos (lib/search.js)
    if (filters.uasg && !matchesDigits(bidField(e, "uasg"), filters.uasg)) return false;
    if (filters.orgao && !has(orgaoOf(e), filters.orgao)) return false;
    if (filters.portal && bidField(e, "portal") !== filters.portal) return false;
    if (filters.modalidade && bidField(e, "modalidade") !== filters.modalidade) return false;
    // Status e Atestado: a licitação aparece se a própria linha OU alguma remessa bater.
    if (filters.status.length && !viewOf(e).units.some((u) => filters.status.includes(u.stage))) return false;
    if (filters.atestado && atestadoOf(e) !== filters.atestado && !unitsOf(e).some((u) => atestadoOf(u) === filters.atestado)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [executions, filters.objeto, filters.pregao, filters.uasg, filters.orgao, filters.portal, filters.modalidade, filters.status, filters.atestado, viewsById, bidsById]);

  // Conjunto atual exibido (aplica o período — data da disputa da licitação, como na Página Inicial).
  const currentSet = useMemo(() => baseSet.filter((e) => {
    const { from, to } = filters.data || {};
    if (!from && !to) return true;
    const d = disputaOf(e);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [baseSet, filters.data, bidsById]);

  // Ordenação aplicada sobre o conjunto já filtrado (respeita busca/filtros/datas).
  // Datas/textos como string (vazios ao fim); numéricas comparadas como número.
  const sortValue = (e, key) => {
    const view = viewOf(e);
    const bid = bidsById[e.bid_id];
    switch (key) {
      case "data": return e.data_cadastro || "";
      case "portal": return (bid?.portal ?? e.portal ?? "").toLowerCase();
      case "orgao": return orgaoOf(e).toLowerCase();
      case "entrega": return Number(view.rep.unit.tempo_entrega_dias || 0);
      case "data_entrega": return view.rep.unit.data_entrega || "";
      case "empenho": return Number(e.valor_empenho || 0);
      case "compra": return Number(e.valor_compra || 0);
      case "lucro": return Number(e.lucro_previsto || 0);
      case "status": return TIMELINE_STEPS.indexOf(view.stage);
      case "progresso": return view.progress;
      case "atestado": return atestadoRank(e);
      default: return "";
    }
  };
  const sortRows = (list) => {
    if (!sort.key) return list;
    const col = EXEC_COLS.find((c) => c.sort === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (col?.type === "num") return dir * (va - vb);
      const ea = !va, eb = !vb;
      if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
      return dir * String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
    });
  };
  // 1) separa por progresso real  2) (já filtrado)  3) ordena DENTRO de cada grupo.
  const grouped = useMemo(() => {
    const out = { andamento: [], concluidas: [] };
    // Com remessas, 100% só quando TODAS chegaram a Pagamento Recebido (execView).
    currentSet.forEach((e) => {
      const p = viewOf(e).progress;
      (GROUPS.find((g) => g.test(p)) || GROUPS[0]).key === "concluidas" ? out.concluidas.push(e) : out.andamento.push(e);
    });
    return { andamento: sortRows(out.andamento), concluidas: sortRows(out.concluidas) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSet, sort, viewsById, bidsById]);

  const bounds = useMemo(() => periodBounds(filters.data?.from, filters.data?.to), [filters.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const curWin = useMemo(() => baseSet.filter((e) => inWindow(disputaOf(e), bounds.cur)), [baseSet, bounds, bidsById]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevWin = useMemo(() => baseSet.filter((e) => inWindow(disputaOf(e), bounds.prev)), [baseSet, bounds, bidsById]);

  const computeKpis = useMemo(() => (set) => {
    const today = todayIso();
    const in10 = addDays(today, 10);
    let valor = 0, lucro = 0, pagamentos = 0, proximas = 0, progSum = 0, acao = 0, atestados = 0;
    set.forEach((e) => {
      const view = viewOf(e);
      // Valor Total de Contratos = valor ORIGINAL (adjudicado). Lucro = operacional
      // (soma das remessas quando houver; senão o do orçamento, como sempre).
      valor += Number(e.valor_original ?? e.valor_empenho ?? 0);
      lucro += Number(e.lucro_previsto || 0);
      progSum += view.progress;
      if (view.units.some((u) => ACTION_STAGES.has(u.stage))) acao += 1;
      // Prazos, pagamentos e atestados são por unidade operacional (remessa).
      view.units.forEach(({ unit: u, nodes }) => {
        // Pagamentos Pendentes: só de "Empenho Recebido" (incl.) até antes de
        // "Pagamento Recebido" — exclui "Aguardando Empenho" e "Pagamento Recebido".
        if (isPaymentPending(nodes)) pagamentos += Number(u.valor_empenho || 0);
        if (u.data_entrega && u.data_entrega >= today && u.data_entrega <= in10) proximas += 1;
        if (isAtestadoPending(u, nodes)) atestados += 1;
      });
    });
    return {
      total: set.length, valor, lucro, pagamentos, proximas,
      progresso: set.length ? Math.round(progSum / set.length) : 0,
      acao, atestados,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewsById]);

  const kpiVal = useMemo(() => computeKpis(currentSet), [computeKpis, currentSet]);
  const kpiCur = useMemo(() => computeKpis(curWin), [computeKpis, curWin]);
  const kpiPrev = useMemo(() => computeKpis(prevWin), [computeKpis, prevWin]);

  /* eslint-disable react-hooks/exhaustive-deps */
  const contratosAtivos = useMemo(
    () => currentSet.filter((e) => viewOf(e).progress < 100).length,
    [currentSet, viewsById]
  );
  const atrasos = useMemo(
    () => currentSet.filter((e) => viewOf(e).units.some((u) => isLate(u.unit, u.nodes))).length,
    [currentSet, viewsById]
  );

  const phaseCounts = useMemo(() => {
    const counts = Object.fromEntries(PHASE_GROUPS.map((g) => [g.key, 0]));
    currentSet.forEach((e) => { counts[phaseOfStage(viewOf(e).stage)] += 1; });
    return counts;
  }, [currentSet, viewsById]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const selected = selectedId ? executions.find((e) => e.bid_id === selectedId) || null : null;
  // Unidade exibida na área superior: a remessa ativa (ou a execução sem remessas).
  const selectedUnitId = selected
    ? (hasRemessas(selected)
      ? (selected.remessas.some((r) => r.id === selectedRemessaId) ? selectedRemessaId : defaultRemessaId(selected))
      : null)
    : undefined;
  const selectedView = selected ? viewOf(selected).units.find((v) => (v.unit.id ?? null) === selectedUnitId) || null : null;

  const selectBid = (bidId) => { setSelectedId(bidId); setSelectedRemessaId(undefined); };
  const selectRemessa = (bidId, remessaId) => { setSelectedId(bidId); setSelectedRemessaId(remessaId ?? null); };
  const toggleExpand = (bidId) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(bidId)) next.delete(bidId); else next.add(bidId);
    return next;
  });
  const orcamentoPath = (unit) => (unit.virtual || !unit.id ? `/orcamento/${unit.bid_id}` : `/orcamento/${unit.bid_id}/remessa/${unit.id}`);

  const activeAdvanced = (filters.portal ? 1 : 0) + (filters.modalidade ? 1 : 0) + filters.status.length + (filters.atestado ? 1 : 0);
  // Opções de Status do painel = etapas da timeline (TIMELINE_STEPS), com as cores das fases.
  const stageOptions = useMemo(() => TIMELINE_STEPS.map((name) => ({ nome: name, cor: stageColor(name) })), []);

  // Ao abrir a página, recarrega as execuções para refletir alterações feitas no
  // orçamento (Empenho/Compra/Lucro são agregados do orçamento no backend).
  useEffect(() => { refreshExecutions(); }, [refreshExecutions]);

  // Paginação — independente por grupo, com a MESMA preferência "Por página".
  useEffect(() => { setPages(FIRST_PAGES); }, [filters, pageSize, sort]);
  const pageInfo = (key) => {
    const list = grouped[key];
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages[key] || 1, totalPages);   // nunca aponta para página inexistente
    return {
      total, totalPages, page,
      rows: list.slice((page - 1) * pageSize, page * pageSize),
      rangeStart: total === 0 ? 0 : (page - 1) * pageSize + 1,
      rangeEnd: Math.min(page * pageSize, total),
      setPage: (fn) => setPages((prev) => ({ ...prev, [key]: Math.max(1, Math.min(totalPages, typeof fn === "function" ? fn(page) : fn)) })),
    };
  };
  // Aberto/recolhido por grupo — preferência do usuário (backend), com padrão por grupo.
  const isGroupOpen = (g) => prefs?.execution_groups?.[g.key] ?? g.defaultOpen;
  const toggleGroup = (g) => saveExecutionGroup(g.key, !isGroupOpen(g));

  // Grava a timeline de forma SEQUENCIAL (fluxo cronológico): a partir da etapa
  // atual, anteriores=Concluído, atual=Em Andamento, posteriores=Pendente.
  // Nunca deixa etapa futura concluída com etapa anterior pendente.
  // Unidade = remessa (grava só nela) ou a própria execução (sem remessas).
  const saveUnit = (unit, patch) => (unit.virtual || !unit.id
    ? updateExecution(unit.bid_id, patch)
    : updateRemessa(unit.bid_id, unit.id, patch));
  const filesOf = (unit) => unitView(unit).nodes.map((n) => n.files || []);
  const persistStep = async (unit, step, filesByIdx) => {
    const clamped = Math.max(0, Math.min(step, TIMELINE_STEPS.length));
    const nodes = TIMELINE_STEPS.map((name, i) => ({
      step: i, name, status: statusForIndex(i, clamped), files: filesByIdx[i] || [],
    }));
    // Otimista: a timeline muda na hora; o PUT roda em seguida e a execução é
    // substituída pela resposta do servidor (já enriquecida). Não recarrega a lista
    // inteira — era isso (2 idas ao backend em série) que causava o atraso em produção.
    try {
      await saveUnit(unit, {
        timeline: nodes,
        current_step: Math.min(clamped, TIMELINE_STEPS.length - 1),
        status_atual: TIMELINE_STEPS[Math.min(clamped, TIMELINE_STEPS.length - 1)],
        pagamento_pendente: clamped < TIMELINE_STEPS.length,
      });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  // Clicar numa etapa reposiciona o fluxo até ela; clicar na etapa atual conclui e avança.
  const moveTo = (unit, idx) => {
    const cs = doneCount(unitView(unit).nodes);
    persistStep(unit, idx === cs ? idx + 1 : idx, filesOf(unit));
  };
  // Anexos antigos (enviados no modelo por etapa): continuam exatamente onde
  // estão — a única operação que sobrou é removê-los pela lista de "Outros".
  const removeNodeFile = (unit, idx, fileId) => {
    const cs = doneCount(unitView(unit).nodes);
    persistStep(unit, cs, filesOf(unit).map((arr, i) => (i === idx ? arr.filter((f) => f.id !== fileId) : arr)));
  };

  const updateDelivery = async (unit, patch) => {
    try { await saveUnit(unit, patch); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // Atestado: salva na hora (autosave), independente da timeline — não move etapa.
  // A linha da licitação tem o seu; cada remessa tem o próprio.
  const updateAtestado = async (unit, atestado) => {
    try { await saveUnit(unit, { atestado }); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // Nova remessa: o backend copia o orçamento escolhido e devolve a execução.
  const criarRemessa = async (base) => {
    const e = novaRemessa;
    if (!e) return;
    try {
      const ex = await createRemessa(e.bid_id, base);
      const nova = ex.remessas[ex.remessas.length - 1];
      setExpanded((prev) => new Set(prev).add(e.bid_id));
      selectRemessa(e.bid_id, nova.id);
      toast.success(`${nova.nome} criada`);
      setNovaRemessa(null);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };
  const confirmExcluirRemessa = async () => {
    const alvo = excluirRemessa;
    if (!alvo) return;
    try {
      await deleteRemessa(alvo.execution.bid_id, alvo.unit.id);
      if (selectedRemessaId === alvo.unit.id) setSelectedRemessaId(undefined);
      toast.success(`${alvo.unit.nome} excluída`);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setExcluirRemessa(null);
  };

  // Encerrar execução: muda o status da licitação original para "Encerrado".
  // A lógica existente (_sync_execution) remove a execução da página; nada é apagado.
  const confirmEncerrar = async () => {
    if (!encerrarTarget) return;
    try {
      await changeStatus(encerrarTarget.bid_id, "Encerrado");
      if (selectedId === encerrarTarget.bid_id) setSelectedId(null);
      toast.success("Execução encerrada — licitação movida para Encerrado");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    setEncerrarTarget(null);
  };

  // Cabeçalho e linha da tabela — usados pelos DOIS grupos (uma única EXEC_COLS).
  const renderHeaderRow = () => (
    <tr className="border-b border-border bg-muted/50">
      {EXEC_COLS.map((col) => (
        <th key={col.label} data-col={EXEC_COLS.indexOf(col)} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex select-none items-center">
            {col.label}
            {col.sort && <SortArrows active={sort.key === col.sort} dir={sort.dir} onClick={() => toggleSort(col.sort)} testid={`exec-sort-${col.sort}`} />}
          </span>
        </th>
      ))}
    </tr>
  );
  // Células operacionais (Entrega → Ações): UMA definição usada pela linha da
  // licitação e pelas linhas de remessa — mesmas colunas da tabela, então os
  // eixos (Empenho, Compra, Lucro, Status, Progresso, Atestado, Ações) coincidem.
  const stop = (ev) => ev.stopPropagation();
  const opsCells = ({ prazo, dataEntrega, empenho, compra, lucro, lucroTitle, stage, progress, progressTestid, atestado, acoes }) => [
    <td key="entrega" className="px-3 py-3" onClick={stop}>{prazo}</td>,
    <td key="data" className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(dataEntrega)}</td>,
    <td key="empenho" className="font-mono-num whitespace-nowrap px-3 py-3">{brl(empenho)}</td>,
    <td key="compra" className="font-mono-num whitespace-nowrap px-3 py-3 text-muted-foreground">{brl(compra)}</td>,
    <td key="lucro" className="font-mono-num whitespace-nowrap px-3 py-3 font-bold text-emerald-600" title={lucroTitle}>{brl(lucro)}</td>,
    <td key="status" className="px-3 py-3"><StatusBadge color={stageColor(stage)}>{stage}</StatusBadge></td>,
    // Progresso — mesma regra da barra principal
    <td key="progresso" className="px-3 py-3">
      <div className="flex w-28 items-center gap-2" data-testid={progressTestid}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: PROGRESS_BLUE }} />
        </div>
        <span className="font-mono-num shrink-0 text-xs font-semibold" style={{ color: PROGRESS_BLUE }}>{progress}%</span>
      </div>
    </td>,
    // Atestado — campo independente da timeline (não altera o progresso)
    <td key="atestado" className="px-3 py-3" onClick={stop}>{atestado}</td>,
    <td key="acoes" className="px-3 py-3" onClick={stop}><div className="flex items-center gap-0.5">{acoes}</div></td>,
  ];
  const prazoPill = (unit, testid, onClick, title) => {
    const cls = "inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs";
    const content = <><Clock size={13} /> {unit.tempo_entrega_dias || 0}d</>;
    return onClick
      ? <button data-testid={testid} onClick={onClick} title={title} className={cn(cls, "hover:bg-brand/10 hover:text-brand")}>{content}</button>
      : <span data-testid={testid} title={title} className={cls}>{content}</span>;
  };

  const renderRow = (e) => {
      const view = viewOf(e);
      const comRemessas = hasRemessas(e);
      const bid = bidsById[e.bid_id];
      const orgao = orgaoOf(e);
      const open = expanded.has(e.bid_id);
      const repUnit = view.rep.unit;
      const lucroOriginal = Number(e.lucro_original ?? e.lucro_previsto ?? 0);
      return (
        <tr key={e.bid_id} data-testid={`exec-row-${e.bid_id}`}
          onClick={() => selectBid(e.bid_id)}
          className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40", selectedId === e.bid_id && "bg-brand/5")}>
          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {/* Seta de expandir só existe quando a licitação TEM remessas; sem elas,
                  um espaço do mesmo tamanho mantém as datas alinhadas. */}
              {comRemessas ? (
                <button type="button" data-testid={`exec-expand-chevron-${e.bid_id}`} aria-expanded={open}
                  onClick={(ev) => { ev.stopPropagation(); toggleExpand(e.bid_id); }}
                  title={open ? "Recolher remessas" : "Ver remessas"}
                  className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
              ) : <span className="-ml-1.5 h-6 w-6" aria-hidden />}
              {fmtDate(e.data_cadastro)}
            </span>
          </td>
          {/* Portal / Modalidade — mesmo componente da Página Inicial */}
          <td className="px-3 py-3"><PortalModalidade portal={bid?.portal ?? e.portal} modalidade={bid?.modalidade ?? e.modalidade} className="max-w-[160px]" /></td>
          {/* Órgão — truncado com nome completo no tooltip; vazio = placeholder discreto */}
          <td className="px-3 py-3">
            {orgao
              ? <span className="block max-w-[180px] truncate text-foreground" title={orgao} data-testid={`exec-orgao-${e.bid_id}`}>{orgao}</span>
              : <span className="text-muted-foreground/50" data-testid={`exec-orgao-${e.bid_id}`}>—</span>}
          </td>
          <td className="px-3 py-3"><span className="block max-w-[220px] truncate font-medium text-foreground">{bid?.objeto ?? e.objeto}</span></td>
          {opsCells({
            // Com remessas, o prazo exibido é o da remessa em andamento (editado na linha dela).
            prazo: comRemessas
              ? prazoPill(repUnit, `exec-time-${e.bid_id}`, null, `Prazo da ${repUnit.nome} — ajuste na linha da remessa`)
              : prazoPill(e, `exec-time-${e.bid_id}`, () => setTimeModal(unitsOf(e)[0])),
            dataEntrega: repUnit.data_entrega,
            empenho: e.valor_empenho,
            compra: e.valor_compra,
            lucro: e.lucro_previsto,
            lucroTitle: comRemessas ? `Lucro atualizado (soma das remessas). Lucro previsto original: ${brl(lucroOriginal)}` : undefined,
            stage: view.stage,
            progress: view.progress,
            progressTestid: `exec-progress-${e.bid_id}`,
            atestado: <AtestadoDropdown execution={e} onChange={(v) => updateAtestado({ ...e, virtual: true }, v)} />,
            acoes: (
              <>
                <button data-testid={`exec-edit-${e.bid_id}`} onClick={() => bid && setEditBid(bid)}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-md", bid ? "text-blue-600 hover:bg-blue-50" : "text-muted-foreground/30")} title="Editar licitação"><Pencil size={15} /></button>
                <button data-testid={`exec-encerrar-${e.bid_id}`} onClick={() => setEncerrarTarget(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" title="Encerrar execução"><Archive size={15} /></button>
                {/* Nova remessa (abre a confirmação); a seta só aparece depois que existem remessas */}
                <button data-testid={`exec-add-remessa-${e.bid_id}`} onClick={() => setNovaRemessa(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50" title="Nova remessa"><PackagePlus size={16} /></button>
                {comRemessas && (
                  <button data-testid={`exec-expand-${e.bid_id}`} onClick={() => toggleExpand(e.bid_id)} aria-expanded={open}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title={open ? "Recolher remessas" : "Ver remessas"}>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </>
            ),
          })}
        </tr>
      );
  };

  // Área expandida da licitação (REF 4 / REF 5): cartão destacado (fundo azulado,
  // borda arredondada) com o título "Remessas", "+ Nova Remessa" e uma tabela
  // branca própria. As larguras dessa tabela vêm da MEDIÇÃO das colunas da tabela
  // principal (useColumnGeometry): Entrega, Data Entrega, Empenho, Compra, Lucro,
  // Status, Progresso, Atestado e Ações ficam exatamente nos mesmos eixos.
  const renderRemessas = (e) => {
    const view = viewOf(e);
    const g = colGeo;
    // Colunas internas: "Remessa" ocupa Data→Objeto (menos o recuo do cartão),
    // as demais repetem as larguras medidas; Ações desconta o recuo da direita.
    const cols = g ? [g.lefts[4] - g.inset, ...g.widths.slice(4, 12), g.widths[12] - REM_INSET] : null;
    const head = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
    return (
      <tr key={`${e.bid_id}-remessas`} data-testid={`exec-remessas-${e.bid_id}`} className="border-b border-border">
        <td colSpan={EXEC_COLS.length} className="p-0">
          {/* largura intrínseca zero: o cartão nunca alarga as colunas da tabela principal */}
          <div style={{ width: 0, minWidth: "100%" }}>
            <div className="rounded-xl bg-[#F3F6FB] p-3 ring-1 ring-[#E3E9F2] dark:bg-slate-900/50 dark:ring-slate-700"
              style={{ margin: `0 ${REM_OUT}px ${REM_OUT}px` }}>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pt-0.5">
                <span className="flex items-center gap-2.5 font-heading text-base font-semibold text-foreground">
                  <Truck size={22} className="text-[#2563EB]" strokeWidth={2} />
                  Remessas
                </span>
                <RemessasResumo execution={e} />
                <Button size="sm" data-testid={`exec-nova-remessa-${e.bid_id}`} onClick={() => setNovaRemessa(e)}
                  className="ml-auto h-9 bg-[#16A34A] px-4 font-semibold text-white hover:bg-[#15803D]">
                  <Plus size={16} className="mr-1.5" /> Nova Remessa
                </Button>
              </div>
              <div className="relative overflow-hidden rounded-lg bg-card ring-1 ring-[#E3E9F2] dark:ring-slate-700">
                <table data-rem-table className={cn("text-sm", cols && "table-fixed")} style={{ width: cols ? cols.reduce((x, y) => x + y, 0) : "100%" }}>
                  {cols && <colgroup>{cols.map((w, i) => <col key={i} style={{ width: Math.max(0, w) }} />)}</colgroup>}
                  <thead>
                    <tr className="border-b border-[#E3E9F2] dark:border-slate-700">
                      <th className={cn(head, "pl-[60px]")}>Remessa</th>
                      {EXEC_COLS.slice(4).map((col) => <th key={col.label} className={head}>{col.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {view.units.map((v) => {
                      const u = v.unit;
                      const k = u.id || "virtual";
                      const active = selectedId === e.bid_id && (u.id ?? null) === selectedUnitId;
                      const podeExcluir = !u.virtual && e.remessas.length > 1;
                      return (
                        <tr key={`${e.bid_id}-r-${k}`} data-testid={`exec-remessa-row-${e.bid_id}-${u.numero}`} data-active={active ? "1" : "0"}
                          onClick={() => selectRemessa(e.bid_id, u.id)}
                          className={cn("cursor-pointer border-b border-[#E3E9F2] transition-colors last:border-0 dark:border-slate-700",
                            active ? "bg-[#EEF4FF] dark:bg-blue-950/40" : "hover:bg-accent/50")}>
                          <td className="py-2.5 pl-3 pr-3" style={active ? { boxShadow: `inset 3px 0 0 ${PROGRESS_BLUE}` } : undefined}>
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80"><Truck size={17} /></span>
                              <span className="min-w-0 leading-tight" title={`${u.nome}: ${resumoLabel(u.resumo)}`} data-testid={`exec-remessa-label-${e.bid_id}-${u.numero}`}>
                                <span className="block truncate font-bold text-foreground">{u.nome}</span>
                                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{resumoLabel(u.resumo)}</span>
                              </span>
                            </div>
                          </td>
                          {opsCells({
                            prazo: prazoPill(u, `exec-remessa-time-${e.bid_id}-${u.numero}`, () => setTimeModal(u), `Prazo de entrega da ${u.nome}`),
                            dataEntrega: u.data_entrega,
                            empenho: u.valor_empenho,
                            compra: u.valor_compra,
                            lucro: u.lucro_previsto,
                            stage: v.stage,
                            progress: v.progress,
                            progressTestid: `exec-remessa-progress-${e.bid_id}-${u.numero}`,
                            atestado: <AtestadoDropdown execution={u} testKey={`${e.bid_id}-r${u.numero}`} onChange={(val) => updateAtestado(u, val)} />,
                            acoes: (
                              <>
                                <button data-testid={`exec-remessa-orcamento-${e.bid_id}-${u.numero}`} onClick={() => navigate(orcamentoPath(u))}
                                  className="flex h-8 w-8 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50" title={`Abrir orçamento da ${u.nome}`}><Pencil size={15} /></button>
                                <button data-testid={`exec-remessa-excluir-${e.bid_id}-${u.numero}`} disabled={!podeExcluir}
                                  onClick={() => podeExcluir && setExcluirRemessa({ execution: e, unit: u })}
                                  title={podeExcluir ? `Excluir ${u.nome}` : "A licitação precisa manter ao menos uma remessa"}
                                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"><Trash2 size={15} /></button>
                              </>
                            ),
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  };
  const renderRowGroup = (e) => (
    <Fragment key={e.bid_id}>
      {renderRow(e)}
      {expanded.has(e.bid_id) && hasRemessas(e) && renderRemessas(e)}
    </Fragment>
  );

  return (
    <>
      <Header title="Execução & Pós-Venda" subtitle="Acompanhamento e lucratividade dos contratos ganhos" />
      <main className="space-y-6 p-6">
        {/* ÁREA SUPERIOR DINÂMICA */}
        {selected && selectedView ? (
          <DetailPanel
            execution={selected}
            unit={selectedView.unit}
            bid={bidsById[selected.bid_id]}
            nodes={selectedView.nodes}
            orcamentoPath={selectedView.unit.virtual ? undefined : orcamentoPath(selectedView.unit)}
            onBack={() => setSelectedId(null)}
            onMove={(idx) => moveTo(selectedView.unit, idx)}
            // Hub de documentos — cada porta usa a fonte de verdade já existente;
            // Nota de Empenho / Nota Fiscal / Outros são da remessa ativa.
            onUploadDoc={(categoria, file) => (selectedView.unit.virtual
              ? addExecutionDoc(selected.bid_id, categoria, file)
              : addRemessaDoc(selected.bid_id, selectedView.unit.id, categoria, file))}
            onRemoveDoc={(categoria, fileId) => (selectedView.unit.virtual
              ? removeExecutionDoc(selected.bid_id, categoria, fileId)
              : removeRemessaDoc(selected.bid_id, selectedView.unit.id, categoria, fileId))}
            onAddEdital={(file) => addBidAnexo(selected.bid_id, file)}
            onRemoveEdital={(fileId) => removeBidAnexo(selected.bid_id, fileId)}
            onRemoveLegacyFile={(idx, fileId) => removeNodeFile(selectedView.unit, idx, fileId)}
            onProposta={abrirProposta}
          />
        ) : (
          <Dashboard
            kpiVal={kpiVal} kpiCur={kpiCur} kpiPrev={kpiPrev}
            ativos={contratosAtivos} atrasos={atrasos} phaseCounts={phaseCounts}
          />
        )}

        {/* ÁREA INFERIOR: TABELA (sempre visível) */}
        <section>
          <div className="mb-3">
            <h2 className="font-heading text-lg font-semibold">Licitações Ganhas</h2>
            <p className="text-xs text-muted-foreground">Clique numa linha para ver os detalhes e acompanhar o andamento.</p>
          </div>
          {/* Filtros rápidos — mesmo padrão da Página Inicial (sem favorito/proposta, com Órgão) */}
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <Button data-testid="exec-add-won" onClick={() => setAddWonOpen(true)} className="shrink-0 bg-brand hover:bg-brand-hover">
              <Plus size={16} className="mr-2" /> Adicionar Licitação Ganha
            </Button>
            <div className="flex-1">
              <FilterBar filters={filters} setFilter={setFilter} onOpenAdvanced={() => setFilterOpen(true)}
                activeAdvanced={activeAdvanced} showFavorite={false} showProposal={false} showOrgao />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div ref={tableScrollRef} className="overflow-x-auto">
              <table ref={tableRef} className="w-full text-sm">
                {(executions || []).length === 0 ? (
                  <tbody>
                    <tr><td colSpan={EXEC_COLS.length} className="px-4 py-16 text-center">
                      <FileX size={40} className="mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-muted-foreground">Nenhuma licitação adjudicada ainda. Mude o status de uma licitação para <strong>Adjudicado</strong>.</p>
                    </td></tr>
                  </tbody>
                ) : GROUPS.map((g) => {
                  const open = isGroupOpen(g);
                  const info = pageInfo(g.key);
                  const sticky = { position: "sticky", left: 0, width: visibleWidth || undefined };
                  return (
                    <Fragment key={g.key}>
                      {/* Barra do grupo — linha inteira azul (mesmo azul da barra de progresso),
                          clicável, com contador do resultado filtrado */}
                      <tbody>
                        <tr className="border-b border-border" style={{ backgroundColor: PROGRESS_BLUE }}>
                          <td colSpan={EXEC_COLS.length} className="p-0">
                            <button type="button" data-testid={`exec-group-${g.key}`} aria-expanded={open} onClick={() => toggleGroup(g)}
                              style={sticky}
                              className="flex items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/10">
                              {open ? <ChevronDown size={14} className="text-white/80" /> : <ChevronRight size={14} className="text-white/80" />}
                              {g.label}
                              <span className="font-semibold text-white/80" data-testid={`exec-group-count-${g.key}`}>({info.total})</span>
                            </button>
                          </td>
                        </tr>
                      </tbody>
                      {open && (
                        <>
                          {/* Cabeçalho completo repetido em cada grupo (mesma EXEC_COLS) */}
                          <tbody>{renderHeaderRow()}</tbody>
                          <tbody data-testid={`exec-group-rows-${g.key}`}>
                            {info.total === 0 && (
                              <tr><td colSpan={EXEC_COLS.length} className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhuma execução neste grupo.</td></tr>
                            )}
                            {info.rows.map(renderRowGroup)}
                          </tbody>
                          {info.total > 0 && (
                            <tbody>
                              <tr className="border-b border-border">
                                <td colSpan={EXEC_COLS.length} className="p-0">
                                  <div style={sticky} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-xs text-muted-foreground">
                                    <span>{info.rangeStart}-{info.rangeEnd} de {info.total} registros</span>
                                    <div className="flex items-center gap-3">
                                      <div className="flex items-center gap-1.5">
                                        <span>Por página</span>
                                        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                                          <SelectTrigger className="h-7 w-16" data-testid={`exec-page-size-${g.key}`}><SelectValue /></SelectTrigger>
                                          <SelectContent>{PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                                        </Select>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button data-testid={`exec-page-prev-${g.key}`} disabled={info.page <= 1} onClick={() => info.setPage((p) => p - 1)}
                                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40 hover:bg-accent"><ChevronLeft size={15} /></button>
                                        <span className="px-1 font-medium text-foreground">{info.page} / {info.totalPages}</span>
                                        <button data-testid={`exec-page-next-${g.key}`} disabled={info.page >= info.totalPages} onClick={() => info.setPage((p) => p + 1)}
                                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40 hover:bg-accent"><ChevronRight size={15} /></button>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </table>
            </div>
          </div>
          <StickyHorizontalScrollbar targetRef={tableScrollRef} />
        </section>
      </main>

      {/* Filtros Avançados — mesmo painel da Página Inicial, configurado para a Execução:
          sem Nº dos Itens / Proposta / Favoritos; com Órgão e Atestado; Status = fases da timeline. */}
      <AdvancedFilterSidebar
        open={filterOpen} onOpenChange={setFilterOpen}
        filters={filters} setFilter={setFilter} onClear={() => setFilters(EMPTY_FILTERS)}
        description="Refine os resultados das execuções e contratos ganhos"
        statusOptions={stageOptions}
        showItens={false} showProposta={false} showFavoritos={false}
        showOrgao showAtestado
      />

      {/* Encerrar execução com confirmação (não exclui nada) */}
      <Dialog open={!!encerrarTarget} onOpenChange={(o) => !o && setEncerrarTarget(null)}>
        <DialogContent data-testid="exec-encerrar-modal">
          <DialogHeader>
            <DialogTitle className="font-heading">Encerrar execução</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja encerrar esta execução? A licitação será movida para o status <strong>Encerrado</strong> e deixará de aparecer na página Execução & Pós-Venda. A licitação continuará disponível em Todas as Licitações.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEncerrarTarget(null)} data-testid="exec-encerrar-cancel">Cancelar</Button>
            <Button onClick={confirmEncerrar} data-testid="exec-encerrar-confirm" className="bg-brand hover:bg-brand-hover">Encerrar execução</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeliveryModal execution={timeModal} onClose={() => setTimeModal(null)} onSave={updateDelivery} />
      <NovaRemessaModal execution={novaRemessa} onClose={() => setNovaRemessa(null)} onCreate={criarRemessa} />
      <ConfirmDialog
        open={!!excluirRemessa} onOpenChange={(o) => !o && setExcluirRemessa(null)}
        title={`Excluir ${excluirRemessa?.unit.nome || "remessa"}?`}
        description="A remessa sai desta licitação (timeline, documentos e orçamento dela deixam de aparecer). Os dados ficam guardados no sistema. As outras remessas e o orçamento original não mudam."
        confirmLabel="Excluir remessa" onConfirm={confirmExcluirRemessa} testid="exec-remessa-excluir-modal"
      />
      <BidFormModal open={!!editBid} editing={editBid} onOpenChange={(o) => !o && setEditBid(null)} withOrgao />
      <BidFormModal open={addWonOpen} onOpenChange={setAddWonOpen} wonMode withOrgao onCreated={(bid) => bid?.id && setSelectedId(bid.id)} />
      {propostaModals}
    </>
  );
}

/* ============================ COMPONENTE A ============================ */
function Dashboard({ kpiVal, kpiCur, kpiPrev, ativos, atrasos, phaseCounts }) {
  // Indicador de tendência apenas nos 3 primeiros (trend: true); os demais sem tendência.
  const cards = [
    { key: "total", label: "Total de Licitações", icon: ClipboardList, accent: "bg-brand/10 text-brand", value: kpiVal.total, trend: true },
    { key: "valor", label: "Valor Total de Contratos", icon: Banknote, accent: "bg-emerald-100 text-emerald-600", value: brl(kpiVal.valor), trend: true },
    { key: "lucro", label: "Lucro Previsto Total", icon: TrendingUp, accent: "bg-emerald-100 text-emerald-600", value: brl(kpiVal.lucro), trend: true },
    { key: "pagamentos", label: "Pagamentos Pendentes", icon: AlertTriangle, accent: "bg-red-100 text-red-600", value: brl(kpiVal.pagamentos) },
    { key: "proximas", label: "Próximas Entregas", icon: Truck, accent: "bg-sky-100 text-sky-600", value: kpiVal.proximas, sub: "nos próximos 10 dias" },
    { key: "progresso", label: "Progresso Médio", icon: Activity, accent: "bg-violet-100 text-violet-600", value: `${kpiVal.progresso}%` },
    { key: "acao", label: "Aguardando Ação", icon: AlertCircle, accent: "bg-amber-100 text-amber-600", value: kpiVal.acao },
    { key: "atestados", label: "Solicitar Atestados", icon: Award, accent: "bg-indigo-100 text-indigo-600", value: kpiVal.atestados, sub: "pendentes" },
  ];
  const total = PHASE_GROUPS.reduce((s, g) => s + (phaseCounts[g.key] || 0), 0);

  return (
    <section data-testid="exec-dashboard" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Resumo Geral de Execução</p>
          <h2 className="font-heading text-xl font-bold">Visão Consolidada de Contratos</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />{ativos} Contratos Ativos
          </span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
            atrasos > 0 ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border bg-muted text-muted-foreground")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", atrasos > 0 ? "bg-amber-500" : "bg-muted-foreground")} />{atrasos} Atrasos Identificados
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.key} {...c} trend={c.trend ? pct(kpiCur[c.key], kpiPrev[c.key]) : null} />
        ))}
      </div>

      {/* Barra de status agregada — 4 blocos independentes (modelo 1) */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
        {PHASE_GROUPS.map((g) => {
          const c = phaseCounts[g.key] || 0;
          const w = total ? (c / total) * 100 : 0;
          return (
            <div key={g.key} data-testid={`phase-${g.key}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-foreground">{g.label}</span>
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c} contratos</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, backgroundColor: g.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, accent, trend, invert, sub, key: _k }) {
  const showTrend = trend !== null && trend !== undefined;
  const good = invert ? trend < 0 : trend > 0;
  const TrendIcon = trend > 0 ? ArrowUp : trend < 0 ? ArrowDown : Minus;
  const trendColor = trend === 0 ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-600";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", accent)}><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-mono-num truncate font-heading text-lg font-bold leading-tight text-foreground">{value}</p>
        {showTrend ? (
          <p className={cn("flex items-center gap-0.5 text-[10px] font-semibold", trendColor)}>
            <TrendIcon size={11} />{trend > 0 ? "+" : ""}{trend}% <span className="font-normal text-muted-foreground">vs. anterior</span>
          </p>
        ) : sub ? <p className="truncate text-[10px] text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

/* ============================ COMPONENTE B ============================ */
const PROGRESS_BLUE = "#2563EB";
function DetailPanel({ execution, unit, bid, nodes, orcamentoPath, onBack, onMove, onUploadDoc, onRemoveDoc, onAddEdital, onRemoveEdital, onRemoveLegacyFile, onProposta }) {
  // `nodes`/`unit` = remessa ativa (ou a própria execução, sem remessas).
  const comRemessas = hasRemessas(execution);
  // Fluxo cronológico: uma única referência (etapa atual) deriva todos os status.
  const currentStep = doneCount(nodes);                 // nº de etapas concluídas
  const stage = currentStage(nodes);
  const progress = Math.round((Math.min(currentStep, nodes.length) / nodes.length) * 100);
  const paid = isPaid(nodes);

  return (
    <section data-testid="exec-detail" className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} data-testid="exec-back" className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand">
            <ArrowLeft size={13} /> Voltar para a visão consolidada
          </button>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Licitação Selecionada</p>
          <h2 data-testid="exec-detail-title" className="font-heading text-xl font-bold tracking-tight text-foreground">{bid?.objeto ?? execution.objeto}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Portal: {bid?.portal ?? execution.portal} · Modalidade: {bid?.modalidade ?? execution.modalidade} · ID: {execution.bid_id?.slice(-6)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {comRemessas && (
            <span data-testid="exec-detail-remessa" className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-bold text-brand">
              <Truck size={13} /> {unit.nome}
            </span>
          )}
          <StatusBadge color={stageColor(stage)} className="px-3">{stage}</StatusBadge>
          {!paid && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert/10 px-3 py-1 text-xs font-semibold text-alert">
              <AlertTriangle size={13} /> Pagamento Pendente
            </span>
          )}
        </div>
      </div>

      {/* Stepper — TODAS as etapas de TIMELINE_STEPS numa única linha (flex-1 por
          etapa, sem larguras fixas e sem overflow-x). Visual ref 5: concluídas verdes,
          atual roxa (anel + glow via box-shadow, sem ocupar espaço), futuras cinza. */}
      <div className="flex w-full items-start pt-2">
        {nodes.map((node, idx) => {
          const Icon = STEP_ICONS[node.name] || CircleCheck;
          const st = statusForIndex(idx, currentStep);   // status derivado da etapa atual
          const isActive = st === STEP_ACTIVE;
          // Conector: trechos concluídos verdes; o trecho que CHEGA à etapa atual é roxo
          // (saída do nó anterior em degradê verde→roxo); o restante cinza.
          const leftClass = idx === currentStep ? "bg-[#7C3AED]" : idx < currentStep ? "bg-emerald-500" : "bg-border";
          const rightStyle = idx === currentStep - 1 ? { background: "linear-gradient(90deg, #10B981, #7C3AED)" } : undefined;
          const rightClass = idx < currentStep - 1 ? "bg-emerald-500" : idx >= currentStep ? "bg-border" : "";
          return (
            <div key={idx} className="flex min-w-0 flex-1 flex-col items-center px-0.5">
              <div className="relative flex h-12 w-full items-center justify-center">
                {idx > 0 && <span className={cn("absolute left-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2", leftClass)} />}
                {idx < nodes.length - 1 && <span className={cn("absolute right-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2", rightClass)} style={rightStyle} />}
                <button
                  data-testid={`timeline-step-${idx}`}
                  data-state={st}
                  onClick={() => onMove(idx)}
                  title={`${node.name} — ${st} (clique para mover o fluxo até aqui)`}
                  className={cn(
                    "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110",
                    st === STEP_DONE ? "bg-emerald-500 text-white"
                      : isActive ? "text-white"
                        : "bg-muted text-muted-foreground/50"
                  )}
                  style={isActive ? {
                    backgroundColor: ACTIVE_PURPLE,
                    // anel branco + contorno roxo + glow lilás — só sombra, não empurra os vizinhos
                    boxShadow: "0 0 0 3px #fff, 0 0 0 5px #7C3AED, 0 0 0 10px rgba(124,58,237,0.12), 0 0 18px 4px rgba(124,58,237,0.35)",
                  } : undefined}
                ><Icon size={16} /></button>
              </div>
              <span className={cn("mt-1.5 max-w-full text-balance text-center text-[10px] font-semibold leading-tight", st === STEP_PENDING ? "text-muted-foreground" : "text-foreground")}>{node.name}</span>
              <span className={cn("mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                st === STEP_DONE ? "bg-emerald-100 text-emerald-700" : isActive ? "bg-[#EDE9FE] text-[#6D28D9]" : "bg-muted text-muted-foreground")}>
                {st}
              </span>
            </div>
          );
        })}
      </div>

      {/* Hub central de documentos (ref 2) — entre a timeline e a barra. Os
          documentos deixam de ser vinculados a etapas e passam a ser por TIPO. */}
      <DocumentHub
        execution={unit}
        bid={bid}
        orcamentoPath={orcamentoPath}
        onUploadDoc={onUploadDoc}
        onRemoveDoc={onRemoveDoc}
        onAddEdital={onAddEdital}
        onRemoveEdital={onRemoveEdital}
        onRemoveLegacyFile={onRemoveLegacyFile}
        onProposta={onProposta}
      />

      {/* Barra de progresso principal (ref 1): ~70% da largura, centralizada, degradê +
          marcador. Consome o MESMO `progress` calculado acima — nada de lógica nova. */}
      <TimelineProgressBar className="mt-6" progress={progress} done={Math.min(currentStep, nodes.length)} total={nodes.length} />

      {/* Original (adjudicado) x execução real (remessas) — nunca somados entre si. */}
      {comRemessas && <ComparativoRemessas execution={execution} />}
    </section>
  );
}

/* ============================ REMESSAS ============================ */
// Destaque de saldo/excedente: excedente em laranja (alerta, sem bloquear),
// saldo discreto, igual neutro.
const DIFF_STYLE = {
  saldo: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  igual: "border-border bg-muted text-muted-foreground",
  excedente: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
};
function DiffChip({ cmp, unidades, testid }) {
  const txt = cmp.tipo === "igual"
    ? COMPARACAO_LABEL.igual
    : `${COMPARACAO_LABEL[cmp.tipo]}: ${unidades ? fmtUnidades(cmp.valor) : brl(cmp.valor)}`;
  return (
    <span data-testid={testid} data-tipo={cmp.tipo} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", DIFF_STYLE[cmp.tipo])}>
      {cmp.tipo === "excedente" && <AlertTriangle size={11} />}{txt}
    </span>
  );
}

// Faixa compacta da área expandida: valor e quantidade, original x remessas.
function RemessasResumo({ execution: e }) {
  const valor = comparar(e.valor_original, e.valor_empenho);
  const qtd = quantidades(e);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid={`exec-remessas-resumo-${e.bid_id}`}>
      <span>Original <strong className="font-mono-num text-foreground">{brl(e.valor_original)}</strong></span>
      <span>Remessas <strong className="font-mono-num text-foreground">{brl(e.valor_empenho)}</strong></span>
      <DiffChip cmp={valor} testid={`exec-remessas-diff-valor-${e.bid_id}`} />
      <span className="hidden h-3 w-px bg-border sm:inline-block" />
      <span>{fmtUnidades(qtd.original)} no original · {fmtUnidades(qtd.remessas)} nas remessas</span>
      <DiffChip cmp={qtd} unidades testid={`exec-remessas-diff-qtd-${e.bid_id}`} />
    </div>
  );
}

// Painel superior: o que foi adjudicado x o que está sendo executado.
function ComparativoRemessas({ execution: e }) {
  const valor = comparar(e.valor_original, e.valor_empenho);
  const qtd = quantidades(e);
  const difLucro = Number(e.lucro_previsto || 0) - Number(e.lucro_original || 0);
  const item = (label, value, extra, testid) => (
    <div className="min-w-0" data-testid={testid}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono-num truncate text-sm font-bold text-foreground">{value}</p>
      {extra}
    </div>
  );
  return (
    <div data-testid="exec-comparativo" className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      {item("Valor original (adjudicado)", brl(e.valor_original), null, "exec-cmp-original")}
      {item("Empenhado nas remessas", brl(e.valor_empenho), <DiffChip cmp={valor} testid="exec-cmp-diff-valor" />, "exec-cmp-empenhado")}
      {item("Compra total", brl(e.valor_compra), null, "exec-cmp-compra")}
      {item("Lucro previsto original", brl(e.lucro_original), null, "exec-cmp-lucro-original")}
      {item("Lucro atualizado", brl(e.lucro_previsto),
        Math.abs(difLucro) > 0.005 && (
          <span className={cn("text-[11px] font-semibold", difLucro < 0 ? "text-red-600" : "text-emerald-600")}>
            {difLucro < 0 ? "−" : "+"} {brl(Math.abs(difLucro))} vs. original
          </span>
        ), "exec-cmp-lucro")}
      {item("Quantidade", `${fmtUnidades(qtd.remessas)} / ${fmtUnidades(qtd.original)}`, <DiffChip cmp={qtd} unidades testid="exec-cmp-diff-qtd" />, "exec-cmp-qtd")}
    </div>
  );
}

function NovaRemessaModal({ execution, onClose, onCreate }) {
  const [base, setBase] = useState("original");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (execution) { setBase("original"); setBusy(false); } }, [execution]);
  if (!execution) return null;
  const comRemessas = hasRemessas(execution);
  const anterior = comRemessas ? execution.remessas[execution.remessas.length - 1] : null;
  const criar = async () => { setBusy(true); try { await onCreate(comRemessas ? base : "original"); } finally { setBusy(false); } };
  return (
    <Dialog open={!!execution} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="nova-remessa-modal">
        <DialogHeader>
          <DialogTitle className="font-heading">Criar nova remessa</DialogTitle>
          <DialogDescription>
            Deseja criar uma nova remessa para esta licitação? A nova remessa terá seu próprio orçamento operacional, valores, documentos, timeline, progresso e status, sem alterar as remessas já existentes.
          </DialogDescription>
        </DialogHeader>
        {!comRemessas && (
          <p data-testid="nova-remessa-primeira" className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            O andamento atual desta licitação (timeline, documentos, atestado e prazo) passa a ser a <strong className="text-foreground">Remessa 1</strong> — nada é perdido — e será criada a <strong className="text-foreground">Remessa 2</strong> a partir do orçamento original.
          </p>
        )}
        {comRemessas && (
          <div className="space-y-2 py-1">
            <p className="text-sm font-medium">Base do orçamento da nova remessa</p>
            <RadioGroup value={base} onValueChange={setBase} className="gap-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 hover:bg-accent/50">
                <RadioGroupItem value="original" data-testid="nova-remessa-base-original" className="mt-0.5" />
                <span className="text-sm"><strong>Usar orçamento original como base</strong><span className="block text-xs text-muted-foreground">Cópia do orçamento que ganhou a licitação.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 hover:bg-accent/50">
                <RadioGroupItem value="anterior" data-testid="nova-remessa-base-anterior" className="mt-0.5" />
                <span className="text-sm"><strong>Copiar orçamento da remessa anterior</strong><span className="block text-xs text-muted-foreground">Cópia do orçamento da {anterior?.nome}.</span></span>
              </label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">A cópia é feita agora; depois disso a nova remessa é independente.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="nova-remessa-cancel">Cancelar</Button>
          <Button onClick={criar} disabled={busy} data-testid="nova-remessa-confirm" className="bg-emerald-600 text-white hover:bg-emerald-700">
            {busy ? "Criando…" : "Criar Remessa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ AUXILIARES ============================ */
function DeliveryModal({ execution, onClose, onSave }) {
  const [dias, setDias] = useState(30);
  const [tipo, setTipo] = useState("corridos");
  const [refDate, setRefDate] = useState("");
  useEffect(() => {
    if (execution) {
      setDias(execution.tempo_entrega_dias || 30);
      setTipo(execution.prazo_entrega_tipo || "corridos");
      // Data de referência salva; registros antigos usam a base anterior (data de cadastro).
      setRefDate((execution.data_referencia_entrega || execution.data_cadastro || todayIso()).slice(0, 10));
    }
  }, [execution]);
  if (!execution) return null;
  const diasNum = Number(dias);
  const diasValid = Number.isFinite(diasNum) && diasNum > 0;
  // Recalcula em tempo real: Data prevista = Data de referência + prazo (corridos/úteis).
  const previewDate = refDate && diasValid ? addDaysByType(refDate, diasNum, tipo) : "";
  const canSave = !!refDate && diasValid && !!tipo;
  return (
    <Dialog open={!!execution} onOpenChange={onClose}>
      <DialogContent data-testid="delivery-modal">
        <DialogHeader><DialogTitle className="font-heading">Prazo de Entrega{execution.virtual === false ? ` — ${execution.nome}` : ""}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Data de referência</Label>
            <DatePickerInput value={refDate} onChange={setRefDate} testid="delivery-ref-date" invalid={!refDate} />
            {!refDate && <p className="text-xs text-alert">Informe uma data válida (DD/MM/AAAA).</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Prazo de entrega (dias)</Label>
              <Input type="number" min="1" data-testid="delivery-days" value={dias} onChange={(e) => setDias(e.target.value)}
                className={cn(!diasValid && "border-alert focus-visible:ring-alert")} />
              {!diasValid && <p className="text-xs text-alert">Informe um prazo maior que zero.</p>}
            </div>
            <div className="space-y-1.5"><Label>Tipo de contagem</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger data-testid="delivery-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corridos">Dias corridos</SelectItem>
                  <SelectItem value="uteis">Dias úteis</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {tipo === "uteis"
              ? "Conta somente dias úteis a partir da data de referência, desconsiderando sábados, domingos e feriados."
              : "Soma os dias corridos à data de referência informada."}
          </p>
          <p className="text-sm text-muted-foreground">Data prevista: <strong className="text-foreground">{fmtDate(previewDate)}</strong></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button data-testid="delivery-save" className="bg-brand hover:bg-brand-hover" disabled={!canSave}
            onClick={() => {
              onSave(execution, {
                data_referencia_entrega: refDate,
                tempo_entrega_dias: diasNum,
                prazo_entrega_tipo: tipo,
                data_entrega: previewDate,
              });
              onClose();
            }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
