import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, TrendingUp, Activity, Filter, FileText, Calculator, Clock, Paperclip,
  Plus, ShoppingCart, Package as PackageIcon, Receipt, Banknote, ClipboardCheck,
  ClipboardList, AlertTriangle, AlertCircle, Award, Hourglass, Boxes, CircleCheck,
  Pencil, Archive, ArrowLeft, ArrowUp, ArrowDown, Minus, ChevronLeft, ChevronRight, FileX,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import { DateRangePicker } from "@/components/DateRangePicker";
import { BidFormModal } from "@/components/bids/BidFormModal";
import { useData } from "@/context/DataContext";
import api, { fileUrl, formatApiError } from "@/lib/api";
import { brl } from "@/lib/calc";
import { addDaysByType } from "@/lib/businessDays";
import { TIMELINE_STEPS, colorStyles } from "@/lib/constants";
import {
  normalizeTimeline, progressOf, doneCount, currentStage, isPaid, needsAtestado, isLate, statusForIndex,
  ACTION_STAGES, PHASE_GROUPS, phaseOfStage, STEP_PENDING, STEP_ACTIVE, STEP_DONE,
} from "@/lib/execution";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const EMPTY_FILTERS = { q: "", modalidade: "", portal: "", status: "", from: "", to: "" };
const STEP_ICONS = [FileText, ClipboardCheck, ShoppingCart, Hourglass, PackageIcon, Boxes, Receipt, Truck, CircleCheck, Award, Banknote];

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
const inWindow = (e, [a, b]) => { const d = e.data_cadastro || ""; return d >= a && d <= b; };

const stageColor = (stage) => {
  const g = PHASE_GROUPS.find((p) => p.key === phaseOfStage(stage));
  return g ? g.color : "#0C7B93";
};

export default function Execution() {
  const { executions, bids, refreshExecutions, changeStatus, lists } = useData();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState(null); // null => Componente A (dashboard)
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [addWonOpen, setAddWonOpen] = useState(false);
  const [editBid, setEditBid] = useState(null);     // bid em edição rápida (lápis)
  const [encerrarTarget, setEncerrarTarget] = useState(null); // execução a encerrar (status -> Encerrado)
  const [docsTarget, setDocsTarget] = useState(null); // anexos base (ícone documento)
  const [timeModal, setTimeModal] = useState(null);   // editar prazo de entrega
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const bidsById = useMemo(() => Object.fromEntries((bids || []).map((b) => [b.id, b])), [bids]);
  const nodesById = useMemo(
    () => Object.fromEntries((executions || []).map((e) => [e.bid_id, normalizeTimeline(e)])),
    [executions]
  );

  // Conjunto base: filtros não-temporais (busca/modalidade/portal/status).
  const baseSet = useMemo(() => (executions || []).filter((e) => {
    if (filters.q && !e.objeto?.toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.modalidade && e.modalidade !== filters.modalidade) return false;
    if (filters.portal && e.portal !== filters.portal) return false;
    if (filters.status && currentStage(nodesById[e.bid_id] || []) !== filters.status) return false;
    return true;
  }), [executions, filters.q, filters.modalidade, filters.portal, filters.status, nodesById]);

  // Conjunto atual exibido (aplica intervalo de datas, se houver).
  const currentSet = useMemo(() => baseSet.filter((e) => {
    if (filters.from && (e.data_cadastro || "") < filters.from) return false;
    if (filters.to && (e.data_cadastro || "") > filters.to) return false;
    return true;
  }), [baseSet, filters.from, filters.to]);

  const bounds = useMemo(() => periodBounds(filters.from, filters.to), [filters.from, filters.to]);
  const curWin = useMemo(() => baseSet.filter((e) => inWindow(e, bounds.cur)), [baseSet, bounds]);
  const prevWin = useMemo(() => baseSet.filter((e) => inWindow(e, bounds.prev)), [baseSet, bounds]);

  const computeKpis = useMemo(() => (set) => {
    const today = todayIso();
    const in10 = addDays(today, 10);
    let valor = 0, lucro = 0, pagamentos = 0, proximas = 0, progSum = 0, acao = 0, atestados = 0;
    set.forEach((e) => {
      const nodes = nodesById[e.bid_id] || [];
      valor += Number(e.valor_empenho || 0);
      lucro += Number(e.lucro_previsto || 0);
      if (!isPaid(nodes)) pagamentos += Number(e.valor_empenho || 0);
      if (e.data_entrega && e.data_entrega >= today && e.data_entrega <= in10) proximas += 1;
      progSum += progressOf(nodes);
      if (ACTION_STAGES.has(currentStage(nodes))) acao += 1;
      if (needsAtestado(nodes)) atestados += 1;
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

  const activeFilters = ["modalidade", "portal", "status", "from", "to"].filter((k) => filters[k]).length;

  // Ao abrir a página, recarrega as execuções para refletir alterações feitas no
  // orçamento (Empenho/Compra/Lucro são agregados do orçamento no backend).
  useEffect(() => { refreshExecutions(); }, [refreshExecutions]);

  // Paginação
  useEffect(() => { setPage(1); }, [filters, pageSize]);
  const totalPages = Math.max(1, Math.ceil(currentSet.length / pageSize));
  const pageRows = currentSet.slice((page - 1) * pageSize, page * pageSize);
  const rangeStart = currentSet.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, currentSet.length);

  // Grava a timeline de forma SEQUENCIAL (fluxo cronológico): a partir da etapa
  // atual, anteriores=Concluído, atual=Em Andamento, posteriores=Pendente.
  // Nunca deixa etapa futura concluída com etapa anterior pendente.
  const filesOf = (execution) => (nodesById[execution.bid_id] || []).map((n) => n.files || []);
  const persistStep = async (execution, step, filesByIdx) => {
    const clamped = Math.max(0, Math.min(step, TIMELINE_STEPS.length));
    const nodes = TIMELINE_STEPS.map((name, i) => ({
      step: i, name, status: statusForIndex(i, clamped), files: filesByIdx[i] || [],
    }));
    try {
      await api.put(`/executions/${execution.bid_id}`, {
        timeline: nodes,
        current_step: Math.min(clamped, TIMELINE_STEPS.length - 1),
        status_atual: TIMELINE_STEPS[Math.min(clamped, TIMELINE_STEPS.length - 1)],
        pagamento_pendente: clamped < TIMELINE_STEPS.length,
      });
      await refreshExecutions();
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
    try { await api.put(`/executions/${bidId}`, patch); await refreshExecutions(); }
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

  return (
    <>
      <Header title="Execução & Pós-Venda" subtitle="Acompanhamento e lucratividade dos contratos ganhos" />
      <main className="space-y-6 p-6">
        {/* ÁREA SUPERIOR DINÂMICA */}
        {selected ? (
          <DetailPanel
            execution={selected}
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
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-heading text-lg font-semibold">Licitações Ganhas</h2>
              <p className="text-xs text-muted-foreground">Clique numa linha para ver os detalhes e acompanhar o andamento.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button data-testid="exec-add-won" onClick={() => setAddWonOpen(true)} className="bg-brand hover:bg-brand-hover">
                <Plus size={16} className="mr-2" /> Adicionar Licitação Ganha
              </Button>
              <DateRangePicker
                value={{ from: filters.from, to: filters.to }}
                onChange={(r) => setFilters((f) => ({ ...f, from: r.from, to: r.to }))}
                testid="exec-quick-date"
                className="w-48 sm:w-56"
              />
              <Button variant="outline" onClick={() => setFilterOpen(true)} data-testid="exec-filter-open" className="relative">
                <Filter size={16} className="mr-2" /> Filtros
                {activeFilters > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{activeFilters}</span>}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Data", "Modalidade", "Portal", "Objeto", "Entrega", "Data Entrega", "Empenho", "Compra", "Lucro Previsto", "Status", "Ações"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentSet.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-16 text-center">
                      <FileX size={40} className="mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-muted-foreground">Nenhuma licitação adjudicada ainda. Mude o status de uma licitação para <strong>Adjudicado</strong>.</p>
                    </td></tr>
                  )}
                  {pageRows.map((e) => {
                    const nodes = nodesById[e.bid_id] || [];
                    const stage = currentStage(nodes);
                    const s = colorStyles(stageColor(stage));
                    const bid = bidsById[e.bid_id];
                    const docs = baseDocs(e);
                    return (
                      <tr key={e.bid_id} data-testid={`exec-row-${e.bid_id}`}
                        onClick={() => setSelectedId(e.bid_id)}
                        className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40", selectedId === e.bid_id && "bg-brand/5")}>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(e.data_cadastro)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{e.modalidade}</td>
                        <td className="whitespace-nowrap px-3 py-3"><span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">{e.portal}</span></td>
                        <td className="px-3 py-3"><span className="block max-w-[220px] truncate font-medium text-foreground">{e.objeto}</span></td>
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
                          <span style={s.badge} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold">
                            <span className="h-1.5 w-1.5 rounded-full" style={s.dot} />{stage}
                          </span>
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
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {currentSet.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
                <span>{rangeStart}-{rangeEnd} de {currentSet.length} registros</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span>Por página</span>
                    <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                      <SelectTrigger className="h-7 w-16" data-testid="exec-page-size"><SelectValue /></SelectTrigger>
                      <SelectContent>{[5, 10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button data-testid="exec-page-prev" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40 hover:bg-accent"><ChevronLeft size={15} /></button>
                    <span className="px-1 font-medium text-foreground">{page} / {totalPages}</span>
                    <button data-testid="exec-page-next" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40 hover:bg-accent"><ChevronRight size={15} /></button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Filtros */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="exec-filter-sidebar">
          <SheetHeader><SheetTitle className="font-heading">Filtros</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="space-y-1.5"><Label>Buscar objeto</Label><Input data-testid="exec-f-q" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Período (Data de Cadastro)</Label>
              <DateRangePicker value={{ from: filters.from, to: filters.to }} onChange={(r) => setFilters((f) => ({ ...f, from: r.from, to: r.to }))} testid="exec-f-date" className="w-full" />
              <p className="text-[11px] text-muted-foreground">As tendências comparam este período com o período anterior de igual duração.</p>
            </div>
            <FilterSelect label="Modalidade" value={filters.modalidade} onChange={(v) => setFilter("modalidade", v)} options={lists.modalidades} testid="exec-f-mod" />
            <FilterSelect label="Portal" value={filters.portal} onChange={(v) => setFilter("portal", v)} options={lists.portais} testid="exec-f-portal" />
            <FilterSelect label="Fase atual" value={filters.status} onChange={(v) => setFilter("status", v)} options={TIMELINE_STEPS} testid="exec-f-status" />
          </div>
          <SheetFooter className="mt-6 flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar</Button>
            <Button className="flex-1 bg-brand hover:bg-brand-hover" onClick={() => setFilterOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
      <BidFormModal open={!!editBid} editing={editBid} onOpenChange={(o) => !o && setEditBid(null)} />
      <BidFormModal open={addWonOpen} onOpenChange={setAddWonOpen} wonMode onCreated={(bid) => bid?.id && setSelectedId(bid.id)} />
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
function DetailPanel({ execution, nodes, onBack, onMove, onAddFile, onRemoveFile }) {
  // Fluxo cronológico: uma única referência (etapa atual) deriva todos os status.
  const currentStep = doneCount(nodes);                 // nº de etapas concluídas
  const stage = currentStage(nodes);
  const progress = Math.round((Math.min(currentStep, nodes.length) / nodes.length) * 100);
  const paid = isPaid(nodes);
  const s = colorStyles(stageColor(stage));

  return (
    <section data-testid="exec-detail" className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} data-testid="exec-back" className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand">
            <ArrowLeft size={13} /> Voltar para a visão consolidada
          </button>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Licitação Selecionada</p>
          <h2 data-testid="exec-detail-title" className="font-heading text-xl font-bold tracking-tight text-foreground">{execution.objeto}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Portal: {execution.portal} · Modalidade: {execution.modalidade} · ID: {execution.bid_id?.slice(-6)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={s.badge} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full" style={s.dot} />{stage}
          </span>
          {!paid && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert/10 px-3 py-1 text-xs font-semibold text-alert">
              <AlertTriangle size={13} /> Pagamento Pendente
            </span>
          )}
        </div>
      </div>

      {/* Stepper 11 etapas — fluxo sequencial. Sem overflow para os círculos
          (ring/anel) não serem cortados; flex-1 evita scroll horizontal. */}
      <div className="flex w-full items-start pt-2">
        {nodes.map((node, idx) => {
          const Icon = STEP_ICONS[idx] || CircleCheck;
          const st = statusForIndex(idx, currentStep);   // status derivado da etapa atual
          const prevDone = idx <= currentStep && idx > 0; // trecho à esquerda concluído
          const thisDone = idx < currentStep;             // trecho à direita concluído
          return (
            <div key={idx} className="flex min-w-0 flex-1 flex-col items-center px-0.5">
              <div className="relative flex h-12 w-full items-center justify-center">
                {idx > 0 && <span className={cn("absolute left-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2", prevDone ? "bg-emerald-500" : "bg-border")} />}
                {idx < nodes.length - 1 && <span className={cn("absolute right-0 top-1/2 h-0.5 w-1/2 -translate-y-1/2", thisDone ? "bg-emerald-500" : "bg-border")} />}
                <button
                  data-testid={`timeline-step-${idx}`}
                  onClick={() => onMove(idx)}
                  title={`${node.name} — ${st} (clique para mover o fluxo até aqui)`}
                  className={cn(
                    "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110",
                    st === STEP_DONE ? "bg-emerald-500 text-white"
                      : st === STEP_ACTIVE ? "bg-card text-brand ring-2 ring-brand ring-offset-2 ring-offset-card"
                        : "bg-muted text-muted-foreground/50"
                  )}
                ><Icon size={16} /></button>
              </div>
              <span className={cn("mt-1.5 text-center text-[10px] font-semibold leading-tight", st === STEP_PENDING ? "text-muted-foreground" : "text-foreground")}>{node.name}</span>
              <span className={cn("mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                st === STEP_DONE ? "bg-emerald-100 text-emerald-700" : st === STEP_ACTIVE ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground")}>
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

      {/* Barra de progresso (modelo 2): larga, azul, % à direita, sem título */}
      <div className="mt-6">
        <div className="mb-1.5 flex justify-end">
          <span className="text-xs text-muted-foreground">{Math.min(currentStep, nodes.length)} de {nodes.length} etapas concluídas</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
            <div data-testid="exec-progress-bar" className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: PROGRESS_BLUE }} />
          </div>
          <span className="font-heading text-base font-bold" style={{ color: PROGRESS_BLUE }}>{progress}%</span>
        </div>
      </div>
    </section>
  );
}

/* ============================ AUXILIARES ============================ */
function FilterSelect({ label, value, onChange, options, testid }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger data-testid={testid}><SelectValue placeholder="Todos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {(options || []).map((o) => {
            const v = typeof o === "string" ? o : o.nome;
            return <SelectItem key={v} value={v}>{v}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

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
  useEffect(() => {
    if (execution) {
      setDias(execution.tempo_entrega_dias || 30);
      setTipo(execution.prazo_entrega_tipo || "corridos");
    }
  }, [execution]);
  if (!execution) return null;
  // Recalcula automaticamente conforme dias e tipo; base = data de cadastro (preservada).
  const previewDate = addDaysByType(execution.data_cadastro, dias, tipo);
  return (
    <Dialog open={!!execution} onOpenChange={onClose}>
      <DialogContent data-testid="delivery-modal">
        <DialogHeader><DialogTitle className="font-heading">Prazo de Entrega</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Prazo de entrega (dias)</Label>
              <Input type="number" min="0" data-testid="delivery-days" value={dias} onChange={(e) => setDias(e.target.value)} />
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
            {tipo === "uteis" ? "Conta apenas dias úteis (ignora sábados, domingos e feriados nacionais)." : "Soma dias corridos diretamente à data de cadastro."}
          </p>
          <p className="text-sm text-muted-foreground">Data prevista: <strong className="text-foreground">{fmtDate(previewDate)}</strong></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button data-testid="delivery-save" className="bg-brand hover:bg-brand-hover"
            onClick={() => { onSave(execution.bid_id, { tempo_entrega_dias: Number(dias), prazo_entrega_tipo: tipo, data_entrega: previewDate }); onClose(); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
