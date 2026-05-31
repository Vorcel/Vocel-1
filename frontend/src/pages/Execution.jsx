import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck, TrendingUp, Activity, Wallet, Filter, FileText, Calculator, FileCheck,
  Pencil, Clock, CheckCircle2, Circle, Paperclip, Save, FileX,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import { useData } from "@/context/DataContext";
import api, { fileUrl, formatApiError } from "@/lib/api";
import { brl } from "@/lib/calc";
import { TIMELINE_STEPS, statusStyle } from "@/lib/constants";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const fmtDate = (d) => (d ? (d.length === 10 ? d.split("-").reverse().join("/") : new Date(d).toLocaleDateString("pt-BR")) : "--");
const addDays = (dateStr, days) => {
  if (!dateStr) return "";
  const base = new Date((dateStr.length === 10 ? dateStr : dateStr.slice(0, 10)) + "T00:00:00");
  base.setDate(base.getDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
};

function KpiCard({ icon: Icon, label, value, accent, testid }) {
  return (
    <div data-testid={testid} className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className={cn("flex h-12 w-12 items-center justify-center rounded-lg", accent)}><Icon size={24} /></div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-mono-num truncate font-heading text-2xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function Execution() {
  const { executions, refreshExecutions, lists } = useData();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ q: "", modalidade: "", portal: "", status: "", from: "", to: "" });
  const [timeModal, setTimeModal] = useState(null); // execution being edited for delivery
  const [editModal, setEditModal] = useState(null);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    return executions.filter((e) => {
      if (filters.q && !e.objeto?.toLowerCase().includes(filters.q.toLowerCase())) return false;
      if (filters.modalidade && e.modalidade !== filters.modalidade) return false;
      if (filters.portal && e.portal !== filters.portal) return false;
      if (filters.status && e.status_atual !== filters.status) return false;
      if (filters.from && (e.data_cadastro || "") < filters.from) return false;
      if (filters.to && (e.data_cadastro || "") > filters.to) return false;
      return true;
    });
  }, [executions, filters]);

  useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered[0].bid_id);
  }, [filtered, selectedId]);

  const selected = executions.find((e) => e.bid_id === selectedId) || null;

  const kpis = useMemo(() => ({
    lucro_total: filtered.reduce((s, e) => s + Number(e.lucro_previsto || 0), 0),
    em_andamento: filtered.filter((e) => e.status_atual !== "Concluído").length,
    pagamentos_pendentes: filtered.filter((e) => e.pagamento_pendente).length,
  }), [filtered]);

  const activeFilters = ["modalidade", "portal", "status", "from", "to"].filter((k) => filters[k]).length;

  const updateExec = async (bidId, patch) => {
    try {
      await api.put(`/executions/${bidId}`, patch);
      await refreshExecutions();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const addTimelineFile = async (bidId, step, file) => {
    await api.post(`/executions/${bidId}/timeline/${step}/file`, { file });
    await refreshExecutions();
  };
  const removeTimelineFile = async (bidId, step, fileId) => {
    await api.delete(`/executions/${bidId}/timeline/${step}/file/${fileId}`);
    await refreshExecutions();
  };

  const stepStatus = (idx, current) => (idx < current ? "done" : idx === current ? "active" : "future");

  const empenhoFile = (e) => e?.timeline?.[0]?.files?.[0] || null;
  const allDocs = (e) => (e?.timeline || []).flatMap((s) => (s.files || []).map((f) => ({ ...f, step: s.name })));

  const donutData = selected
    ? [{ name: "Concluído", value: (selected.current_step || 0) + 1 }, { name: "Restante", value: TIMELINE_STEPS.length - ((selected.current_step || 0) + 1) }]
    : [];
  const progressPct = selected ? Math.round((((selected.current_step || 0) + 1) / TIMELINE_STEPS.length) * 100) : 0;

  return (
    <>
      <Header title="Execução & Pós-Venda" subtitle="Acompanhamento e lucratividade dos contratos ganhos" />
      <main className="space-y-6 p-6">
        {/* KPIs */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard testid="kpi-lucro" icon={TrendingUp} label="Lucro Total Estimado" value={brl(kpis.lucro_total)} accent="bg-emerald-100 text-emerald-600" />
          <KpiCard testid="kpi-andamento" icon={Activity} label="Licitações em Andamento" value={kpis.em_andamento} accent="bg-brand/10 text-brand" />
          <KpiCard testid="kpi-pagamentos" icon={Wallet} label="Pagamentos Pendentes" value={kpis.pagamentos_pendentes} accent="bg-amber-100 text-amber-600" />
        </section>

        {/* Master table */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold">Licitações Ganhas</h2>
            <Button variant="outline" onClick={() => setFilterOpen(true)} data-testid="exec-filter-open" className="relative">
              <Filter size={16} className="mr-2" /> Filtros
              {activeFilters > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{activeFilters}</span>}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {["Data", "Modalidade", "Portal", "Objeto", "Entrega", "Data Entrega", "Empenho", "Compra", "Lucro Previsto", "Status", "Ações"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-16 text-center">
                    <FileX size={40} className="mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Nenhuma licitação adjudicada ainda. Mude o status de uma licitação para <strong>Adjudicado</strong>.</p>
                  </td></tr>
                )}
                {filtered.map((e) => {
                  const s = statusStyle(e.status_atual);
                  const emp = empenhoFile(e);
                  return (
                    <tr key={e.bid_id} data-testid={`exec-row-${e.bid_id}`} onClick={() => setSelectedId(e.bid_id)}
                      className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40", selectedId === e.bid_id && "bg-brand/5")}>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(e.data_cadastro)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{e.modalidade}</td>
                      <td className="whitespace-nowrap px-3 py-3"><span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">{e.portal}</span></td>
                      <td className="px-3 py-3"><span className="block max-w-[220px] truncate font-medium text-foreground">{e.objeto}</span></td>
                      <td className="px-3 py-3">
                        <button data-testid={`exec-time-${e.bid_id}`} onClick={(ev) => { ev.stopPropagation(); setTimeModal(e); }} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs hover:bg-brand/10 hover:text-brand">
                          <Clock size={13} /> {e.tempo_entrega_dias || 0}d
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(e.data_entrega)}</td>
                      <td className="font-mono-num whitespace-nowrap px-3 py-3">{brl(e.valor_empenho)}</td>
                      <td className="font-mono-num whitespace-nowrap px-3 py-3 text-muted-foreground">{brl(e.valor_compra)}</td>
                      <td className="font-mono-num whitespace-nowrap px-3 py-3 font-bold text-emerald-600">{brl(e.lucro_previsto)}</td>
                      <td className="px-3 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1", s.bg, s.text, s.ring)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{e.status_atual}
                        </span>
                      </td>
                      <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-0.5">
                          <a href={e.termo_referencia ? fileUrl(e.termo_referencia.id) : undefined} target="_blank" rel="noreferrer"
                            className={cn("flex h-8 w-8 items-center justify-center rounded-md", e.termo_referencia ? "text-brand hover:bg-brand/10" : "pointer-events-none text-muted-foreground/30")} title="Doc Base">
                            <FileText size={16} />
                          </a>
                          <button data-testid={`exec-budget-${e.bid_id}`} onClick={() => navigate(`/orcamento/${e.bid_id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-brand hover:bg-brand/10" title="Orçamento"><Calculator size={16} /></button>
                          <a href={emp ? fileUrl(emp.id) : undefined} target="_blank" rel="noreferrer"
                            className={cn("flex h-8 w-8 items-center justify-center rounded-md", emp ? "text-emerald-600 hover:bg-emerald-50" : "pointer-events-none text-muted-foreground/30")} title="Empenho"><FileCheck size={16} /></a>
                          <button data-testid={`exec-edit-${e.bid_id}`} onClick={() => setEditModal(e)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar"><Pencil size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Detail panel */}
        {selected && (
          <section className="grid gap-6 lg:grid-cols-3" data-testid="exec-detail">
            {/* Timeline */}
            <div className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
              <h3 className="mb-1 font-heading text-base font-semibold">Gestão Detalhada</h3>
              <p className="mb-5 max-w-lg truncate text-sm text-muted-foreground">{selected.objeto}</p>
              <div className="space-y-1">
                {TIMELINE_STEPS.map((name, idx) => {
                  const st = stepStatus(idx, selected.current_step || 0);
                  const step = (selected.timeline || [])[idx] || { files: [] };
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <button
                          data-testid={`timeline-step-${idx}`}
                          onClick={() => updateExec(selected.bid_id, { current_step: idx })}
                          className="transition-transform hover:scale-110"
                        >
                          {st === "done" ? <CheckCircle2 size={22} className="text-emerald-500" />
                            : st === "active" ? <Circle size={22} className="fill-brand/20 text-brand" />
                            : <Circle size={22} className="text-muted-foreground/40" />}
                        </button>
                        {idx < TIMELINE_STEPS.length - 1 && <div className={cn("my-1 w-0.5 flex-1", idx < (selected.current_step || 0) ? "bg-emerald-500" : "bg-border")} />}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("text-sm font-medium", st === "active" ? "text-brand" : st === "done" ? "text-foreground" : "text-muted-foreground")}>{name}</span>
                          {(step.files || []).map((f) => (
                            <span key={f.id} className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs">
                              <Paperclip size={11} className="text-brand" />
                              <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="max-w-[120px] truncate hover:underline">{f.filename}</a>
                              <button onClick={() => removeTimelineFile(selected.bid_id, idx, f.id)} className="text-muted-foreground hover:text-alert">×</button>
                            </span>
                          ))}
                        </div>
                        <div className="mt-1.5 max-w-xs">
                          <InlineUpload bidId={selected.bid_id} step={idx} onUploaded={addTimelineFile} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Donut + summary */}
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="mb-2 font-heading text-base font-semibold">Progresso</h3>
                <div className="relative h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} innerRadius={55} outerRadius={75} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                        <Cell fill="#0C7B93" />
                        <Cell fill="hsl(var(--muted))" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-heading text-3xl font-bold text-foreground">{progressPct}%</span>
                    <span className="text-xs text-muted-foreground">concluído</span>
                  </div>
                </div>
                <p className="text-center text-sm font-medium text-brand">{selected.status_atual}</p>
              </div>

              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="mb-3 font-heading text-base font-semibold">Resumo do Contrato</h3>
                <ContractSummary execution={selected} onSave={(patch) => updateExec(selected.bid_id, patch)} />
              </div>
            </div>

            {/* Tabs */}
            <div className="rounded-xl border border-border bg-card p-6 lg:col-span-3">
              <Tabs defaultValue="visao">
                <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                  {[["visao", "Visão Geral"], ["docs", "Documentos"], ["produtos", "Produtos"], ["entregas", "Entregas"], ["nf", "Notas Fiscais"], ["atestados", "Atestados"], ["com", "Comunicações"], ["hist", "Histórico"]].map(([id, label]) => (
                    <TabsTrigger key={id} value={id} data-testid={`exec-tab-${id}`} className="data-[state=active]:bg-brand data-[state=active]:text-white">{label}</TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="visao" className="mt-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <InfoBox label="Valor do Empenho" value={brl(selected.valor_empenho)} />
                    <InfoBox label="Valor de Compra" value={brl(selected.valor_compra)} />
                    <InfoBox label="Lucro Previsto" value={brl(selected.lucro_previsto)} highlight />
                    <InfoBox label="Portal" value={selected.portal} />
                    <InfoBox label="Modalidade" value={selected.modalidade} />
                    <InfoBox label="Data de Entrega" value={fmtDate(selected.data_entrega)} />
                  </div>
                </TabsContent>
                <TabsContent value="docs" className="mt-4">
                  {allDocs(selected).length === 0 ? <Empty text="Nenhum documento anexado na timeline." /> : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {allDocs(selected).map((f) => (
                        <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-accent">
                          <FileText size={18} className="shrink-0 text-brand" />
                          <div className="min-w-0"><p className="truncate text-sm font-medium">{f.filename}</p><p className="truncate text-xs text-muted-foreground">{f.step}</p></div>
                        </a>
                      ))}
                    </div>
                  )}
                </TabsContent>
                {["produtos", "entregas", "nf", "atestados", "com", "hist"].map((id) => (
                  <TabsContent key={id} value={id} className="mt-4"><Empty text="Em breve — conteúdo desta aba será detalhado." /></TabsContent>
                ))}
              </Tabs>
            </div>
          </section>
        )}
      </main>

      {/* Filter sidebar */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="exec-filter-sidebar">
          <SheetHeader><SheetTitle className="font-heading">Filtros</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="space-y-1.5"><Label>Buscar objeto</Label><Input data-testid="exec-f-q" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>De</Label><Input type="date" data-testid="exec-f-from" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Até</Label><Input type="date" data-testid="exec-f-to" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} /></div>
            </div>
            <FilterSelect label="Modalidade" value={filters.modalidade} onChange={(v) => setFilter("modalidade", v)} options={lists.modalidades} testid="exec-f-mod" />
            <FilterSelect label="Portal" value={filters.portal} onChange={(v) => setFilter("portal", v)} options={lists.portais} testid="exec-f-portal" />
            <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} options={TIMELINE_STEPS} testid="exec-f-status" />
          </div>
          <SheetFooter className="mt-6 flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFilters({ q: "", modalidade: "", portal: "", status: "", from: "", to: "" })}>Limpar</Button>
            <Button className="flex-1 bg-brand hover:bg-brand-hover" onClick={() => setFilterOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delivery time modal */}
      <DeliveryModal execution={timeModal} onClose={() => setTimeModal(null)} onSave={updateExec} />
      {/* Edit modal */}
      <EditModal execution={editModal} statuses={TIMELINE_STEPS} onClose={() => setEditModal(null)} onSave={updateExec} />
    </>
  );
}

function FilterSelect({ label, value, onChange, options, testid }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger data-testid={testid}><SelectValue placeholder="Todos" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {(options || []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineUpload({ bidId, step, onUploaded }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button data-testid={`timeline-add-${step}`} onClick={() => setOpen(true)} className="text-xs font-medium text-brand hover:underline">+ Adicionar arquivo</button>;
  }
  return (
    <FileUpload testid={`timeline-upload-${step}`} accept=".pdf,image/*,.docx,.xlsx" value={null} compact
      onUploaded={(f) => { onUploaded(bidId, step, f); setOpen(false); }} />
  );
}

function InfoBox({ label, value, highlight }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-mono-num mt-1 text-lg font-semibold", highlight ? "text-emerald-600" : "text-foreground")}>{value}</p>
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function ContractSummary({ execution, onSave }) {
  const [text, setText] = useState(execution.resumo_contrato || "");
  const [pend, setPend] = useState(execution.pagamento_pendente);
  useEffect(() => { setText(execution.resumo_contrato || ""); setPend(execution.pagamento_pendente); }, [execution.bid_id]);
  return (
    <div className="space-y-3">
      <Textarea data-testid="resumo-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Notas do contrato..." />
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <Label className="cursor-pointer">Pagamento pendente</Label>
        <Switch data-testid="resumo-pend" checked={pend} onCheckedChange={setPend} />
      </div>
      <Button size="sm" data-testid="resumo-save" onClick={() => onSave({ resumo_contrato: text, pagamento_pendente: pend })} className="w-full bg-brand hover:bg-brand-hover">
        <Save size={14} className="mr-2" /> Salvar Resumo
      </Button>
    </div>
  );
}

function DeliveryModal({ execution, onClose, onSave }) {
  const [dias, setDias] = useState(30);
  useEffect(() => { if (execution) setDias(execution.tempo_entrega_dias || 30); }, [execution]);
  if (!execution) return null;
  const previewDate = addDays(execution.data_cadastro, dias);
  return (
    <Dialog open={!!execution} onOpenChange={onClose}>
      <DialogContent data-testid="delivery-modal">
        <DialogHeader><DialogTitle className="font-heading">Tempo para Entrega</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><Label>Prazo de entrega (dias)</Label>
            <Input type="number" data-testid="delivery-days" value={dias} onChange={(e) => setDias(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">Data prevista: <strong className="text-foreground">{fmtDate(previewDate)}</strong></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button data-testid="delivery-save" className="bg-brand hover:bg-brand-hover" onClick={() => { onSave(execution.bid_id, { tempo_entrega_dias: Number(dias), data_entrega: previewDate }); onClose(); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditModal({ execution, statuses, onClose, onSave }) {
  const [form, setForm] = useState({});
  useEffect(() => { if (execution) setForm({ valor_empenho: execution.valor_empenho, valor_compra: execution.valor_compra, lucro_previsto: execution.lucro_previsto, status_atual: execution.status_atual }); }, [execution]);
  if (!execution) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={!!execution} onOpenChange={onClose}>
      <DialogContent data-testid="exec-edit-modal">
        <DialogHeader><DialogTitle className="font-heading">Editar Contrato</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Valor do Empenho</Label><Input type="number" step="0.01" data-testid="edit-empenho" value={form.valor_empenho} onChange={(e) => set("valor_empenho", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Valor de Compra</Label><Input type="number" step="0.01" data-testid="edit-compra" value={form.valor_compra} onChange={(e) => set("valor_compra", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Lucro Previsto</Label><Input type="number" step="0.01" data-testid="edit-lucro" value={form.lucro_previsto} onChange={(e) => set("lucro_previsto", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Status</Label>
            <Select value={form.status_atual} onValueChange={(v) => set("status_atual", v)}>
              <SelectTrigger data-testid="edit-status"><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button data-testid="edit-save" className="bg-brand hover:bg-brand-hover" onClick={() => {
            onSave(execution.bid_id, { valor_empenho: Number(form.valor_empenho), valor_compra: Number(form.valor_compra), lucro_previsto: Number(form.lucro_previsto), status_atual: form.status_atual });
            onClose();
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
