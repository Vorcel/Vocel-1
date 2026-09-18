import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, TrendingUp, Activity, FileText, Calculator, Clock, Paperclip, Wallet,
  Plus, ShoppingCart, Package as PackageIcon, Receipt, Banknote, ClipboardCheck,
  ClipboardList, AlertTriangle, AlertCircle, Award, Hourglass, Boxes, CircleCheck,
  Pencil, Archive, ArrowLeft, ArrowUp, ArrowDown, Minus, ChevronLeft, ChevronRight, ChevronDown, FileX,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import { FilterBar } from "@/components/bids/FilterBar";
import { AdvancedFilterSidebar } from "@/components/bids/AdvancedFilterSidebar";
import { DatePickerInput } from "@/components/DatePickerInput";
import { BidFormModal } from "@/components/bids/BidFormModal";
import { PortalModalidade } from "@/components/bids/PortalModalidade";
import { StatusBadge } from "@/components/StatusBadge";
import { AtestadoDropdown } from "@/components/execution/AtestadoDropdown";
import { TimelineProgressBar } from "@/components/execution/TimelineProgressBar";
import { SortArrows } from "@/components/table/SortArrows";
import { StickyHorizontalScrollbar } from "@/components/table/StickyHorizontalScrollbar";
import { usePersistentSort } from "@/hooks/usePersistentSort";
import { usePersistentPageSize, PAGE_SIZE_OPTIONS } from "@/hooks/usePersistentPageSize";
import { useData } from "@/context/DataContext";
import { fileUrl, formatApiError } from "@/lib/api";
import { brl } from "@/lib/calc";
import { addDaysByType } from "@/lib/businessDays";
import { TIMELINE_STEPS } from "@/lib/constants";
import {
  normalizeTimeline, progressOf, doneCount, currentStage, isPaid, isPaymentPending, isLate, statusForIndex,
  atestadoOf, atestadoRank, isAtestadoPending, stageColor,
  ACTION_STAGES, PHASE_GROUPS, phaseOfStage, STEP_PENDING, STEP_ACTIVE, STEP_DONE,
} from "@/lib/execution";
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
  const { executions, bids, refreshExecutions, changeStatus, updateExecution, prefs, saveExecutionGroup } = useData();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState(null); // null => Componente A (dashboard)
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [addWonOpen, setAddWonOpen] = useState(false);
  const [editBid, setEditBid] = useState(null);     // bid em edição rápida (lápis)
  const [encerrarTarget, setEncerrarTarget] = useState(null); // execução a encerrar (status -> Encerrado)
  const [docsTarget, setDocsTarget] = useState(null); // anexos base (ícone documento)
  const [timeModal, setTimeModal] = useState(null);   // editar prazo de entrega
  const [pages, setPages] = useState(FIRST_PAGES);   // página atual de cada grupo
  // Registros por página persistidos por usuário (backend); padrão 10.
  const [pageSize, setPageSize] = usePersistentPageSize("executions", 10);
  const tableScrollRef = useRef(null);
  const visibleWidth = useVisibleWidth(tableScrollRef);
  // Ordenação persistida por usuário; padrão = ordem do backend (created_at desc).
  const [sort, toggleSort] = usePersistentSort("executions", { key: null, dir: "asc" });

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const bidsById = useMemo(() => Object.fromEntries((bids || []).map((b) => [b.id, b])), [bids]);
  // Órgão vem da licitação vinculada (fonte de verdade); a execução guarda um espelho.
  const orgaoOf = (e) => (bidsById[e.bid_id]?.orgao ?? e.orgao ?? "").trim();
  const nodesById = useMemo(
    () => Object.fromEntries((executions || []).map((e) => [e.bid_id, normalizeTimeline(e)])),
    [executions]
  );

  // Dados da licitação vinculada (fonte atualizada); a execução guarda espelhos.
  const bidField = (e, k) => String(bidsById[e.bid_id]?.[k] ?? e[k] ?? "");
  const disputaOf = (e) => bidField(e, "data_disputa") || e.data_cadastro || "";
  const has = (v, q) => v.toLowerCase().includes(q.toLowerCase());

  // Conjunto base: filtros não-temporais (mesma semântica da Página Inicial —
  // texto parcial sem diferenciar maiúsculas; status = fases da timeline, multi).
  const baseSet = useMemo(() => (executions || []).filter((e) => {
    if (filters.objeto && !has(bidField(e, "objeto"), filters.objeto)) return false;
    if (filters.pregao && !has(bidField(e, "pregao"), filters.pregao)) return false;
    if (filters.uasg && !has(bidField(e, "uasg"), filters.uasg)) return false;
    if (filters.orgao && !has(orgaoOf(e), filters.orgao)) return false;
    if (filters.portal && bidField(e, "portal") !== filters.portal) return false;
    if (filters.modalidade && bidField(e, "modalidade") !== filters.modalidade) return false;
    if (filters.status.length && !filters.status.includes(currentStage(nodesById[e.bid_id] || []))) return false;
    if (filters.atestado && atestadoOf(e) !== filters.atestado) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [executions, filters.objeto, filters.pregao, filters.uasg, filters.orgao, filters.portal, filters.modalidade, filters.status, filters.atestado, nodesById, bidsById]);

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
    const nodes = nodesById[e.bid_id] || [];
    const bid = bidsById[e.bid_id];
    switch (key) {
      case "data": return e.data_cadastro || "";
      case "portal": return (bid?.portal ?? e.portal ?? "").toLowerCase();
      case "orgao": return orgaoOf(e).toLowerCase();
      case "entrega": return Number(e.tempo_entrega_dias || 0);
      case "data_entrega": return e.data_entrega || "";
      case "empenho": return Number(e.valor_empenho || 0);
      case "compra": return Number(e.valor_compra || 0);
      case "lucro": return Number(e.lucro_previsto || 0);
      case "status": return TIMELINE_STEPS.indexOf(currentStage(nodes));
      case "progresso": return progressOf(nodes);
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
    currentSet.forEach((e) => {
      const p = progressOf(nodesById[e.bid_id] || []);
      (GROUPS.find((g) => g.test(p)) || GROUPS[0]).key === "concluidas" ? out.concluidas.push(e) : out.andamento.push(e);
    });
    return { andamento: sortRows(out.andamento), concluidas: sortRows(out.concluidas) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSet, sort, nodesById, bidsById]);

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
      const nodes = nodesById[e.bid_id] || [];
      valor += Number(e.valor_empenho || 0);
      lucro += Number(e.lucro_previsto || 0);
      // Pagamentos Pendentes: só de "Empenho Recebido" (incl.) até antes de
      // "Pagamento Recebido" — exclui "Aguardando Empenho" e "Pagamento Recebido".
      if (isPaymentPending(nodes)) pagamentos += Number(e.valor_empenho || 0);
      if (e.data_entrega && e.data_entrega >= today && e.data_entrega <= in10) proximas += 1;
      progSum += progressOf(nodes);
      if (ACTION_STAGES.has(currentStage(nodes))) acao += 1;
      if (isAtestadoPending(e, nodes)) atestados += 1;
    });
    return {
      total: set.length, valor, lucro, pagamentos, proximas,
      progresso: set.length ? Math.round(progSum / set.length) : 0,
      acao, atestados,
    };
  }, [nodesById]);

  const kpiVal = useMemo(() => computeKpis(currentSet), [computeKpis, currentSet]);
  const kpiCur = useMemo(() => computeKpis(curWin), [computeKpis, curWin]);
  const kpiPrev = useMemo(() => computeKpis(prevWin), [computeKpis, prevWin]);

  const contratosAtivos = useMemo(
    () => currentSet.filter((e) => progressOf(nodesById[e.bid_id] || []) < 100).length,
    [currentSet, nodesById]
  );
  const atrasos = useMemo(
    () => currentSet.filter((e) => isLate(e, nodesById[e.bid_id] || [])).length,
    [currentSet, nodesById]
  );

  const phaseCounts = useMemo(() => {
    const counts = Object.fromEntries(PHASE_GROUPS.map((g) => [g.key, 0]));
    currentSet.forEach((e) => { counts[phaseOfStage(currentStage(nodesById[e.bid_id] || []))] += 1; });
    return counts;
  }, [currentSet, nodesById]);

  const selected = selectedId ? executions.find((e) => e.bid_id === selectedId) || null : null;
  const selectedNodes = selected ? nodesById[selected.bid_id] || [] : [];

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
  const filesOf = (execution) => (nodesById[execution.bid_id] || []).map((n) => n.files || []);
  const persistStep = async (execution, step, filesByIdx) => {
    const clamped = Math.max(0, Math.min(step, TIMELINE_STEPS.length));
    const nodes = TIMELINE_STEPS.map((name, i) => ({
      step: i, name, status: statusForIndex(i, clamped), files: filesByIdx[i] || [],
    }));
    // Otimista: a timeline muda na hora; o PUT roda em seguida e a execução é
    // substituída pela resposta do servidor (já enriquecida). Não recarrega a lista
    // inteira — era isso (2 idas ao backend em série) que causava o atraso em produção.
    try {
      await updateExecution(execution.bid_id, {
        timeline: nodes,
        current_step: Math.min(clamped, TIMELINE_STEPS.length - 1),
        status_atual: TIMELINE_STEPS[Math.min(clamped, TIMELINE_STEPS.length - 1)],
        pagamento_pendente: clamped < TIMELINE_STEPS.length,
      });
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  // Clicar numa etapa reposiciona o fluxo até ela; clicar na etapa atual conclui e avança.
  const moveTo = (execution, idx) => {
    const cs = doneCount(nodesById[execution.bid_id] || []);
    persistStep(execution, idx === cs ? idx + 1 : idx, filesOf(execution));
  };
  const addNodeFile = (execution, idx, file) => {
    const cs = doneCount(nodesById[execution.bid_id] || []);
    persistStep(execution, cs, filesOf(execution).map((arr, i) => (i === idx ? [...arr, file] : arr)));
  };
  const removeNodeFile = (execution, idx, fileId) => {
    const cs = doneCount(nodesById[execution.bid_id] || []);
    persistStep(execution, cs, filesOf(execution).map((arr, i) => (i === idx ? arr.filter((f) => f.id !== fileId) : arr)));
  };

  const updateDelivery = async (bidId, patch) => {
    try { await updateExecution(bidId, patch); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  // Atestado: salva na hora (autosave), independente da timeline — não move etapa.
  const updateAtestado = async (bidId, atestado) => {
    try { await updateExecution(bidId, { atestado }); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
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

  const baseDocs = (e) => {
    const bid = bidsById[e.bid_id];
    const docs = [];
    if (bid?.termo_referencia) docs.push({ ...bid.termo_referencia, tipo: "Termo de Referência" });
    (bid?.anexos || []).forEach((a) => docs.push({ ...a, tipo: "Anexo / Edital" }));
    return docs;
  };

  // Cabeçalho e linha da tabela — usados pelos DOIS grupos (uma única EXEC_COLS).
  const renderHeaderRow = () => (
    <tr className="border-b border-border bg-muted/50">
      {EXEC_COLS.map((col) => (
        <th key={col.label} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex select-none items-center">
            {col.label}
            {col.sort && <SortArrows active={sort.key === col.sort} dir={sort.dir} onClick={() => toggleSort(col.sort)} testid={`exec-sort-${col.sort}`} />}
          </span>
        </th>
      ))}
    </tr>
  );
  const renderRow = (e) => {
      const nodes = nodesById[e.bid_id] || [];
      const stage = currentStage(nodes);
      const progress = progressOf(nodes);
      const bid = bidsById[e.bid_id];
      const orgao = orgaoOf(e);
      const docs = baseDocs(e);
      return (
        <tr key={e.bid_id} data-testid={`exec-row-${e.bid_id}`}
          onClick={() => setSelectedId(e.bid_id)}
          className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40", selectedId === e.bid_id && "bg-brand/5")}>
          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(e.data_cadastro)}</td>
          {/* Portal / Modalidade — mesmo componente da Página Inicial */}
          <td className="px-3 py-3"><PortalModalidade portal={bid?.portal ?? e.portal} modalidade={bid?.modalidade ?? e.modalidade} className="max-w-[160px]" /></td>
          {/* Órgão — truncado com nome completo no tooltip; vazio = placeholder discreto */}
          <td className="px-3 py-3">
            {orgao
              ? <span className="block max-w-[180px] truncate text-foreground" title={orgao} data-testid={`exec-orgao-${e.bid_id}`}>{orgao}</span>
              : <span className="text-muted-foreground/50" data-testid={`exec-orgao-${e.bid_id}`}>—</span>}
          </td>
          <td className="px-3 py-3"><span className="block max-w-[220px] truncate font-medium text-foreground">{bid?.objeto ?? e.objeto}</span></td>
          <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
            <button data-testid={`exec-time-${e.bid_id}`} onClick={() => setTimeModal(e)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs hover:bg-brand/10 hover:text-brand">
              <Clock size={13} /> {e.tempo_entrega_dias || 0}d
            </button>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(e.data_entrega)}</td>
          <td className="font-mono-num whitespace-nowrap px-3 py-3">{brl(e.valor_empenho)}</td>
          <td className="font-mono-num whitespace-nowrap px-3 py-3 text-muted-foreground">{brl(e.valor_compra)}</td>
          <td className="font-mono-num whitespace-nowrap px-3 py-3 font-bold text-emerald-600">{brl(e.lucro_previsto)}</td>
          <td className="px-3 py-3">
            <StatusBadge color={stageColor(stage)}>{stage}</StatusBadge>
          </td>
          {/* Progresso — mesma regra da barra principal (progressOf) */}
          <td className="px-3 py-3">
            <div className="flex w-28 items-center gap-2" data-testid={`exec-progress-${e.bid_id}`}>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: PROGRESS_BLUE }} />
              </div>
              <span className="font-mono-num shrink-0 text-xs font-semibold" style={{ color: PROGRESS_BLUE }}>{progress}%</span>
            </div>
          </td>
          {/* Atestado — campo independente da timeline (não altera o progresso) */}
          <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
            <AtestadoDropdown execution={e} onChange={(v) => updateAtestado(e.bid_id, v)} />
          </td>
          <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center gap-0.5">
              <button data-testid={`exec-docs-${e.bid_id}`} onClick={() => setDocsTarget(e)}
                className={cn("flex h-8 w-8 items-center justify-center rounded-md", docs.length ? "text-brand hover:bg-brand/10" : "text-muted-foreground/30")}
                title="Documentos base (Termo de Referência / Edital)"><FileText size={16} /></button>
              <button data-testid={`exec-budget-${e.bid_id}`} onClick={() => navigate(`/orcamento/${e.bid_id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-brand hover:bg-brand/10" title="Abrir orçamento"><Calculator size={16} /></button>
              <button data-testid={`exec-edit-${e.bid_id}`} onClick={() => bid && setEditBid(bid)}
                className={cn("flex h-8 w-8 items-center justify-center rounded-md", bid ? "text-blue-600 hover:bg-blue-50" : "text-muted-foreground/30")} title="Editar licitação"><Pencil size={15} /></button>
              <button data-testid={`exec-encerrar-${e.bid_id}`} onClick={() => setEncerrarTarget(e)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" title="Encerrar execução"><Archive size={15} /></button>
            </div>
          </td>
        </tr>
      );
  };

  return (
    <>
      <Header title="Execução & Pós-Venda" subtitle="Acompanhamento e lucratividade dos contratos ganhos" />
      <main className="space-y-6 p-6">
        {/* ÁREA SUPERIOR DINÂMICA */}
        {selected ? (
          <DetailPanel
            execution={selected}
            bid={bidsById[selected.bid_id]}
            nodes={selectedNodes}
            onBack={() => setSelectedId(null)}
            onMove={(idx) => moveTo(selected, idx)}
            onAddFile={(idx, file) => addNodeFile(selected, idx, file)}
            onRemoveFile={(idx, fileId) => removeNodeFile(selected, idx, fileId)}
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
              <table className="w-full text-sm">
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
                            {info.rows.map(renderRow)}
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

      {/* Documentos base */}
      <Dialog open={!!docsTarget} onOpenChange={(o) => !o && setDocsTarget(null)}>
        <DialogContent data-testid="exec-docs-modal">
          <DialogHeader>
            <DialogTitle className="font-heading">Documentos da Licitação</DialogTitle>
            <DialogDescription>Anexos cadastrados na abertura (Termo de Referência e Edital).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {docsTarget && baseDocs(docsTarget).length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento base anexado.</p>}
            {docsTarget && baseDocs(docsTarget).map((d, i) => (
              <a key={d.id || i} href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-accent">
                <FileText size={18} className="shrink-0 text-brand" />
                <div className="min-w-0"><p className="truncate text-sm font-medium">{d.filename}</p><p className="truncate text-xs text-muted-foreground">{d.tipo}</p></div>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>

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
      <BidFormModal open={!!editBid} editing={editBid} onOpenChange={(o) => !o && setEditBid(null)} withOrgao />
      <BidFormModal open={addWonOpen} onOpenChange={setAddWonOpen} wonMode withOrgao onCreated={(bid) => bid?.id && setSelectedId(bid.id)} />
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
function DetailPanel({ execution, bid, nodes, onBack, onMove, onAddFile, onRemoveFile }) {
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
              <div className="mt-1.5 flex w-full flex-col items-center gap-1">
                {(node.files || []).map((f) => (
                  <span key={f.id} className="flex w-full max-w-full items-center gap-1 rounded-md bg-accent px-1 py-0.5 text-[9px]">
                    <Paperclip size={9} className="shrink-0 text-brand" />
                    <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.filename}</a>
                    <button onClick={() => onRemoveFile(idx, f.id)} className="shrink-0 text-muted-foreground hover:text-alert">×</button>
                  </span>
                ))}
                <InlineUpload step={idx} onUploaded={(file) => onAddFile(idx, file)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra de progresso principal (ref 1): ~70% da largura, centralizada, degradê +
          marcador. Consome o MESMO `progress` calculado acima — nada de lógica nova. */}
      <TimelineProgressBar className="mt-6" progress={progress} done={Math.min(currentStep, nodes.length)} total={nodes.length} />
    </section>
  );
}

/* ============================ AUXILIARES ============================ */
function InlineUpload({ step, onUploaded }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button data-testid={`timeline-add-${step}`} onClick={() => setOpen(true)} className="text-[10px] font-medium text-brand hover:underline">+ Adicionar arquivo</button>;
  }
  return (
    <FileUpload testid={`timeline-upload-${step}`} accept=".pdf,image/*,.docx,.xlsx" value={null} compact
      onUploaded={(f) => { onUploaded(f); setOpen(false); }} />
  );
}

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
        <DialogHeader><DialogTitle className="font-heading">Prazo de Entrega</DialogTitle></DialogHeader>
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
              onSave(execution.bid_id, {
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
