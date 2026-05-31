import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Save, Trash2, Loader2, DollarSign, TrendingUp, Percent, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import api, { formatApiError } from "@/lib/api";
import { computeRow, computeTotals, brl, pct, num } from "@/lib/calc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

let _rid = 0;
const newRow = (defaults) => ({
  _id: `r${Date.now()}_${_rid++}`,
  selecionado: true, item: "", produto: "", marca: "", fornecedor: "", site: "",
  valor_compra: "", qtd: "1", valor_venda: "", margem: "30",
  icms: String(defaults.icms ?? 18), pis_cofins: String(defaults.pis_cofins ?? 9.25),
  outros_sem_imp: "0", outros_com_imp: "0", frete_receber: "0", frete_enviar: "0",
  mode: "margem",
});

const HEADERS = [
  "SELECIONAR", "ITEM", "PRODUTO", "MARCA", "FORNECEDOR", "SITE", "VALOR COMPRA", "QTD",
  "VALOR VENDA", "MARGEM %", "ICMS %", "PIS/COFINS %", "OUTROS S/ IMP.", "OUTROS C/ IMP.",
  "FRETE RECEBER", "FRETE ENVIAR", "CUSTO BASE UN.", "LUCRO UN.", "VALOR UN.", "VALOR TOTAL", "LUCRO TOTAL",
];

function GlobalCard({ icon: Icon, label, value, accent, testid }) {
  return (
    <div data-testid={testid} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", accent)}><Icon size={22} /></div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-mono-num truncate font-heading text-xl font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-transparent px-2 py-2 text-sm outline-none focus:bg-accent/50";

export default function Budget() {
  const { bidId } = useParams();
  const navigate = useNavigate();
  const [bid, setBid] = useState(null);
  const [rows, setRows] = useState([]);
  const [defaults, setDefaults] = useState({ icms: 18, pis_cofins: 9.25 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/bids/${bidId}/budget`);
        setBid(data.bid);
        setDefaults(data.defaults);
        setRows((data.rows || []).map((r, i) => ({ _id: `s${i}`, mode: r.valor_venda ? "venda" : "margem", ...r })));
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail));
      } finally { setLoading(false); }
    })();
  }, [bidId]);

  const totals = useMemo(() => computeTotals(rows), [rows]);

  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const onVenda = (id, v) => updateRow(id, { valor_venda: v, margem: "", mode: v === "" || v === "0" ? "margem" : "venda" });
  const onMargem = (id, v) => updateRow(id, { margem: v, valor_venda: "", mode: "margem" });

  const addRow = () => setRows((p) => [...p, newRow(defaults)]);
  const removeRow = (id) => setRows((p) => p.filter((r) => r._id !== id));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        rows: rows.map((r) => {
          const c = computeRow(r);
          return { ...r, ...c };
        }),
        summary: totals,
      };
      await api.put(`/bids/${bidId}/budget`, payload);
      toast.success("Orçamento salvo e sincronizado");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand" /></div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/70 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" data-testid="budget-back" onClick={() => navigate(-1)}><ArrowLeft size={18} /></Button>
          <div>
            <h1 className="font-heading text-lg font-semibold tracking-tight">Orçamento & Precificação</h1>
            <p className="max-w-md truncate text-xs text-muted-foreground">{bid?.objeto}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" data-testid="budget-add-row" onClick={addRow}><Plus size={16} className="mr-1.5" /> Linha</Button>
          <Button data-testid="budget-save" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save size={16} className="mr-1.5" />} Salvar
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden p-6">
        {/* Global totals */}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GlobalCard testid="total-custo" icon={DollarSign} label="Custo Global" value={brl(totals.custo_global)} accent="bg-slate-200 text-slate-700" />
          <GlobalCard testid="total-proposta" icon={Wallet} label="Valor Total da Proposta" value={brl(totals.valor_total)} accent="bg-brand/10 text-brand" />
          <GlobalCard testid="total-lucro" icon={TrendingUp} label="Lucro Líquido Global" value={brl(totals.lucro_global)} accent="bg-emerald-100 text-emerald-600" />
          <GlobalCard testid="total-margem" icon={Percent} label="Margem Média Global" value={pct(totals.margem_media)} accent="bg-amber-100 text-amber-600" />
        </div>

        {/* Spreadsheet */}
        <div className="h-[calc(100%-7rem)] overflow-auto rounded-xl border border-border bg-card">
          <table className="min-w-[2400px] border-collapse text-sm">
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted">
                {HEADERS.map((h, i) => (
                  <th key={h} className={cn(
                    "whitespace-nowrap border-b border-r border-border px-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
                    i === 0 && "sticky left-0 z-30 bg-muted"
                  )}>{h}</th>
                ))}
                <th className="sticky right-0 z-30 border-b border-border bg-muted px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={HEADERS.length + 1} className="px-4 py-16 text-center text-muted-foreground">
                  Nenhum item. Clique em <strong>Linha</strong> para adicionar.
                </td></tr>
              )}
              {rows.map((r) => {
                const c = computeRow(r);
                return (
                  <tr key={r._id} data-testid={`erp-row-${r._id}`} className={cn("border-b border-border", r.selecionado ? "bg-card" : "bg-muted/30")}>
                    {/* 1 SELECIONAR */}
                    <td className="sticky left-0 z-10 border-r border-border bg-inherit px-3 py-2">
                      <Checkbox data-testid={`erp-select-${r._id}`} checked={r.selecionado} onCheckedChange={(v) => updateRow(r._id, { selecionado: !!v })} />
                    </td>
                    {/* 2-6 text */}
                    <td className="border-r border-border"><input data-testid={`erp-item-${r._id}`} className={inputCls} value={r.item} onChange={(e) => updateRow(r._id, { item: e.target.value })} /></td>
                    <td className="border-r border-border"><input className={cn(inputCls, "min-w-[160px]")} value={r.produto} onChange={(e) => updateRow(r._id, { produto: e.target.value })} placeholder="Produto" /></td>
                    <td className="border-r border-border"><input className={inputCls} value={r.marca} onChange={(e) => updateRow(r._id, { marca: e.target.value })} /></td>
                    <td className="border-r border-border"><input className={inputCls} value={r.fornecedor} onChange={(e) => updateRow(r._id, { fornecedor: e.target.value })} /></td>
                    <td className="border-r border-border"><input className={inputCls} value={r.site} onChange={(e) => updateRow(r._id, { site: e.target.value })} /></td>
                    {/* 7 valor compra */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={inputCls} value={r.valor_compra} onChange={(e) => updateRow(r._id, { valor_compra: e.target.value })} /></td>
                    {/* 8 qtd */}
                    <td className="border-r border-border"><input type="number" className={cn(inputCls, "w-16")} value={r.qtd} onChange={(e) => updateRow(r._id, { qtd: e.target.value })} /></td>
                    {/* 9 valor venda (yellow) */}
                    <td className={cn("border-r border-border transition-colors", r.mode === "venda" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30")}>
                      <input type="number" step="0.01" data-testid={`erp-venda-${r._id}`} className={inputCls} value={r.valor_venda ?? ""} onChange={(e) => onVenda(r._id, e.target.value)} placeholder="R$" />
                    </td>
                    {/* 10 margem (yellow) */}
                    <td className={cn("border-r border-border transition-colors", r.mode === "margem" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30")}>
                      <input type="number" step="0.01" data-testid={`erp-margem-${r._id}`} className={inputCls} value={r.mode === "venda" ? c.margem_calc.toFixed(1) : (r.margem ?? "")} onChange={(e) => onMargem(r._id, e.target.value)} placeholder="%" readOnly={r.mode === "venda"} />
                    </td>
                    {/* 11 icms */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={cn(inputCls, "w-16")} value={r.icms} onChange={(e) => updateRow(r._id, { icms: e.target.value })} /></td>
                    {/* 12 pis */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={cn(inputCls, "w-20")} value={r.pis_cofins} onChange={(e) => updateRow(r._id, { pis_cofins: e.target.value })} /></td>
                    {/* 13 outros sem */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={inputCls} value={r.outros_sem_imp} onChange={(e) => updateRow(r._id, { outros_sem_imp: e.target.value })} /></td>
                    {/* 14 outros com */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={inputCls} value={r.outros_com_imp} onChange={(e) => updateRow(r._id, { outros_com_imp: e.target.value })} /></td>
                    {/* 15 frete receber */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={inputCls} value={r.frete_receber} onChange={(e) => updateRow(r._id, { frete_receber: e.target.value })} /></td>
                    {/* 16 frete enviar */}
                    <td className="border-r border-border"><input type="number" step="0.01" className={inputCls} value={r.frete_enviar} onChange={(e) => updateRow(r._id, { frete_enviar: e.target.value })} /></td>
                    {/* 17 custo base unit */}
                    <td className="font-mono-num whitespace-nowrap border-r border-border px-2 py-2 text-muted-foreground">{brl(c.custo_base_unit)}</td>
                    {/* 18 lucro unit (green) */}
                    <td className="font-mono-num whitespace-nowrap border-r border-border bg-emerald-50 px-2 py-2 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{brl(c.lucro_unit)}</td>
                    {/* 19 valor unidade (blue) */}
                    <td className="font-mono-num whitespace-nowrap border-r border-border bg-blue-50 px-2 py-2 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{brl(c.valor_unidade)}</td>
                    {/* 20 valor total (blue) */}
                    <td className="font-mono-num whitespace-nowrap border-r border-border bg-blue-50 px-2 py-2 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{brl(c.valor_total)}</td>
                    {/* 21 lucro total (green) */}
                    <td className="font-mono-num whitespace-nowrap bg-emerald-50 px-2 py-2 font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{brl(c.lucro_total)}</td>
                    {/* remove */}
                    <td className="sticky right-0 z-10 bg-card px-2 py-2">
                      <button data-testid={`erp-remove-${r._id}`} onClick={() => removeRow(r._id)} className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-alert/10 hover:text-alert"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
