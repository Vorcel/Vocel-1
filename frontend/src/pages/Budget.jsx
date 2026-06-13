import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2, DollarSign, TrendingUp, Percent, Wallet, Pencil, Check, Cloud, CheckCircle2, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useColumnResize, ColResizer } from "@/components/table/resizable";
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

// Column model — drives header, body, resizing, hide/show.
const COLUMNS = [
  { key: "selecionar", label: "SELECIONAR", w: 70, type: "select", sticky: true, noHide: true },
  { key: "item", label: "ITEM", w: 70, type: "text" },
  { key: "produto", label: "PRODUTO", w: 180, type: "text" },
  { key: "marca", label: "MARCA", w: 110, type: "text" },
  { key: "fornecedor", label: "FORNECEDOR", w: 130, type: "text" },
  { key: "site", label: "SITE", w: 120, type: "site" },
  { key: "valor_compra", label: "VALOR COMPRA", w: 120, type: "currency" },
  { key: "qtd", label: "QTD", w: 70, type: "number" },
  { key: "valor_venda", label: "VALOR VENDA", w: 120, type: "venda" },
  { key: "margem", label: "MARGEM DESEJADA", w: 140, type: "margem" },
  { key: "margem_real", label: "MARGEM REAL", w: 120, type: "calc_pct" },
  { key: "icms", label: "ICMS", w: 90, type: "percent" },
  { key: "pis_cofins", label: "PIS/COFINS", w: 110, type: "percent" },
  { key: "outros_sem_imp", label: "OUTROS S/ IMP.", w: 120, type: "currency" },
  { key: "outros_com_imp", label: "OUTROS C/ IMP.", w: 120, type: "currency" },
  { key: "frete_receber", label: "FRETE RECEBER", w: 120, type: "currency" },
  { key: "frete_enviar", label: "FRETE ENVIAR", w: 120, type: "currency" },
  { key: "custo_base_unit", label: "CUSTO BASE UN.", w: 120, type: "calc_currency" },
  { key: "imposto_unit", label: "IMPOSTO UN.", w: 110, type: "calc_currency" },
  { key: "lucro_unit", label: "LUCRO UN.", w: 110, type: "calc_currency", tint: "green" },
  { key: "valor_unidade", label: "VALOR UN.", w: 110, type: "calc_currency", tint: "blue" },
  { key: "valor_total", label: "VALOR TOTAL", w: 120, type: "calc_currency", tint: "blue" },
  { key: "lucro_total", label: "LUCRO TOTAL", w: 120, type: "calc_currency", tint: "green" },
];
const DEFAULT_WIDTHS = COLUMNS.map((c) => c.w);

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

// Excel-style editable cell: read-only formatted view that turns into an input
// on click. Commits on Enter/Blur, cancels on Escape.
function EditableCell({ value, type = "text", onCommit, align = "left", placeholder, readOnly, testid }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const start = () => { if (readOnly) return; setDraft(value ?? ""); setEditing(true); };
  const commit = () => { setEditing(false); onCommit(draft); };

  const right = align === "right";

  if (editing) {
    return (
      <input
        ref={ref}
        data-testid={testid}
        type={type === "text" ? "text" : "number"}
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        placeholder={placeholder}
        className={cn("no-spin w-full bg-transparent px-2 py-2 text-sm outline-none ring-2 ring-inset ring-brand/50",
          right && "text-right font-mono-num")}
      />
    );
  }

  let display = value;
  const empty = value === "" || value == null;
  if (type === "currency") display = empty ? "" : brl(value);
  else if (type === "percent") display = empty ? "" : pct(value);

  return (
    <div
      data-testid={testid ? `${testid}-view` : undefined}
      onClick={start}
      className={cn("min-h-[37px] truncate px-2 py-2 text-sm hover:bg-accent/40",
        right && "text-right font-mono-num", readOnly ? "cursor-default text-muted-foreground" : "cursor-text")}
    >
      {display !== "" && display != null ? display : <span className="text-muted-foreground/40">{placeholder}</span>}
    </div>
  );
}

// Dynamic, editable URL cell: clickable link (view) <-> input (edit via pencil).
function SiteCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const save = () => {
    let v = draft.trim();
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    onSave(v);
    setEditing(false);
  };

  if (!value || editing) {
    return (
      <div className="flex items-center gap-1 px-1">
        <input
          type="url" autoFocus={editing} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
          }}
          placeholder="https://..." data-testid="site-input"
          className="w-full bg-transparent py-2 text-sm outline-none focus:bg-accent/50"
        />
        <button type="button" onClick={save} title="Salvar link" data-testid="site-save"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
          <Check size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="group/site flex items-center gap-1 px-2">
      <a href={value} target="_blank" rel="noopener noreferrer" data-testid="site-link" title={value}
        style={{ fontFamily: "'Hanken Grotesk', sans-serif" }}
        className="truncate text-sm font-medium text-[#0000EE] hover:underline dark:text-blue-400">
        {value}
      </a>
      <button type="button" onClick={() => { setDraft(value || ""); setEditing(true); }} title="Editar link" data-testid="site-edit"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover/site:opacity-100">
        <Pencil size={13} />
      </button>
    </div>
  );
}

function tdBg(col, r) {
  if (col.type === "venda") return r.mode === "venda" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30";
  if (col.type === "margem") return r.mode === "margem" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30";
  if (col.tint === "green") return "bg-emerald-50 dark:bg-emerald-950/40";
  if (col.tint === "blue") return "bg-blue-50 dark:bg-blue-950/40";
  return "";
}

export default function Budget() {
  const { bidId } = useParams();
  const navigate = useNavigate();
  const [bid, setBid] = useState(null);
  const [rows, setRows] = useState([]);
  const [defaults, setDefaults] = useState({ icms: 18, pis_cofins: 9.25 });
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved

  // Hide/show columns + multi-select for bulk resize
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("erp_hidden") || "[]")); } catch { return new Set(); }
  });
  const [selectedCols, setSelectedCols] = useState(() => new Set());
  const [ctx, setCtx] = useState(null); // { x, y, idx }

  const dirtyRef = useRef(false);
  const timerRef = useRef(null);

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
  const { widths: ew, startResize: eResize } = useColumnResize("erp_widths_v2", DEFAULT_WIDTHS);

  // Auto-save (debounced full-budget) — fires only after user edits.
  useEffect(() => {
    if (loading || !dirtyRef.current) return;
    setSaveState("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const payload = {
          rows: rows.map((r) => ({ ...r, ...computeRow(r) })),
          summary: computeTotals(rows),
        };
        await api.put(`/bids/${bidId}/budget`, payload);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1600);
      } catch (e) {
        setSaveState("idle");
        toast.error(formatApiError(e.response?.data?.detail));
      }
    }, 1000);
    return () => clearTimeout(timerRef.current);
  }, [rows, loading, bidId]);

  const markDirty = () => { dirtyRef.current = true; };
  const updateRow = (id, patch) => { markDirty(); setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r))); };
  const onVenda = (id, v) => updateRow(id, { valor_venda: v, margem: "", mode: v === "" || num(v) === 0 ? "margem" : "venda" });
  const onMargem = (id, v) => updateRow(id, { margem: v, valor_venda: "", mode: "margem" });
  const addRow = () => { markDirty(); setRows((p) => [...p, newRow(defaults)]); };
  const removeRow = (id) => { markDirty(); setRows((p) => p.filter((r) => r._id !== id)); };

  // Hide/show persistence
  const persistHidden = (s) => { try { localStorage.setItem("erp_hidden", JSON.stringify([...s])); } catch { /* ignore */ } };
  const hideCol = (idx) => { setHidden((p) => { const n = new Set(p); n.add(COLUMNS[idx].key); persistHidden(n); return n; }); setCtx(null); };
  const showCol = (key) => { setHidden((p) => { const n = new Set(p); n.delete(key); persistHidden(n); return n; }); };
  const showAll = () => { setHidden(() => { persistHidden(new Set()); return new Set(); }); setCtx(null); };

  const onHeaderClick = (idx, e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedCols((p) => { const n = new Set(p); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
    } else {
      setSelectedCols(new Set());
    }
  };
  const onHeaderCtx = (idx, e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, idx }); };

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctx]);

  const visible = COLUMNS.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.key));
  const totalW = visible.reduce((a, { i }) => a + ew[i], 0) + 52;
  const hiddenList = COLUMNS.filter((c) => hidden.has(c.key));
  const selArr = [...selectedCols];

  function renderCell(col, r, c) {
    const tid = `erp-${col.key}-${r._id}`;
    switch (col.type) {
      case "select":
        return <Checkbox data-testid={`erp-select-${r._id}`} checked={r.selecionado} onCheckedChange={(v) => updateRow(r._id, { selecionado: !!v })} />;
      case "site":
        return <SiteCell value={r.site} onSave={(v) => updateRow(r._id, { site: v })} />;
      case "text":
        return <EditableCell value={r[col.key]} type="text" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} />;
      case "number":
        return <EditableCell value={r[col.key]} type="number" align="right" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} />;
      case "currency":
        return <EditableCell value={r[col.key]} type="currency" align="right" placeholder="R$ 0,00" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} />;
      case "percent":
        return <EditableCell value={r[col.key]} type="percent" align="right" placeholder="%" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} />;
      case "venda":
        return <EditableCell value={r.valor_venda} type="currency" align="right" placeholder="R$" onCommit={(v) => onVenda(r._id, v)} testid={`erp-venda-${r._id}`} />;
      case "margem":
        return <EditableCell value={r.mode === "venda" ? c.markup.toFixed(1) : r.margem} type="percent" align="right" placeholder="%" readOnly={r.mode === "venda"} onCommit={(v) => onMargem(r._id, v)} testid={`erp-margem-${r._id}`} />;
      case "calc_pct":
        return <div className="px-2 py-2 text-right font-mono-num text-sm font-medium text-amber-600 dark:text-amber-400">{pct(c[col.key])}</div>;
      case "calc_currency": {
        const cls = col.tint === "green" ? "text-emerald-700 dark:text-emerald-300 font-semibold"
          : col.tint === "blue" ? "text-blue-700 dark:text-blue-300 font-semibold" : "text-muted-foreground";
        return <div className={cn("px-2 py-2 text-right font-mono-num text-sm whitespace-nowrap", cls)}>{brl(c[col.key])}</div>;
      }
      default: return null;
    }
  }

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
        <div className="flex items-center gap-3">
          <div data-testid="budget-save-state" className="flex min-w-[92px] items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {saveState === "saving" && (<><Loader2 size={13} className="animate-spin" /> Salvando…</>)}
            {saveState === "saved" && (<><CheckCircle2 size={13} className="text-emerald-600" /> Salvo</>)}
            {saveState === "idle" && (<><Cloud size={13} /> Salvo na nuvem</>)}
          </div>
          {hiddenList.length > 0 && (
            <Button variant="outline" size="sm" data-testid="budget-show-all" onClick={showAll}>
              <Eye size={15} className="mr-1.5" /> Reexibir ({hiddenList.length})
            </Button>
          )}
          <Button variant="outline" data-testid="budget-add-row" onClick={addRow}><Plus size={16} className="mr-1.5" /> Linha</Button>
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
          <table className="rt-fixed border-collapse text-sm" style={{ width: totalW }}>
            <colgroup>
              {visible.map(({ i }) => <col key={i} style={{ width: ew[i] }} />)}
              <col style={{ width: 52 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted">
                {visible.map(({ c: col, i }) => (
                  <th key={col.key}
                    data-testid={`erp-th-${col.key}`}
                    onClick={(e) => onHeaderClick(i, e)}
                    onContextMenu={(e) => onHeaderCtx(i, e)}
                    title="Clique com Ctrl/Shift p/ selecionar · botão direito p/ ocultar"
                    className={cn(
                      "select-none border-b border-r border-border px-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
                      col.sticky && "sticky left-0 z-30 bg-muted",
                      selectedCols.has(i) && "bg-brand/15 ring-1 ring-inset ring-brand/40"
                    )}>
                    {col.label}
                    <ColResizer onMouseDown={eResize(i, selArr.length > 1 ? selArr : null)} />
                  </th>
                ))}
                <th className="sticky right-0 z-30 border-b border-border bg-muted px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={visible.length + 1} className="px-4 py-16 text-center text-muted-foreground">
                  Nenhum item. Clique em <strong>Linha</strong> para adicionar.
                </td></tr>
              )}
              {rows.map((r) => {
                const c = computeRow(r);
                return (
                  <tr key={r._id} data-testid={`erp-row-${r._id}`} className={cn("border-b border-border", r.selecionado ? "bg-card" : "bg-muted/30")}>
                    {visible.map(({ c: col, i }) => (
                      <td key={col.key}
                        className={cn("border-r border-border",
                          col.sticky ? "sticky left-0 z-10 bg-inherit px-3 py-2" : "p-0",
                          tdBg(col, r))}>
                        {renderCell(col, r, c)}
                      </td>
                    ))}
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

      {/* Header context menu — hide / show columns */}
      {ctx && (
        <div
          data-testid="col-context-menu"
          style={{ top: ctx.y, left: ctx.x }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
          {!COLUMNS[ctx.idx].noHide && (
            <button data-testid="ctx-hide-col" onClick={() => hideCol(ctx.idx)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent">
              <EyeOff size={15} /> Ocultar “{COLUMNS[ctx.idx].label}”
            </button>
          )}
          {hiddenList.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reexibir coluna</p>
              {hiddenList.map((col) => (
                <button key={col.key} data-testid={`ctx-show-${col.key}`} onClick={() => showCol(col.key)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent">
                  <Eye size={15} /> {col.label}
                </button>
              ))}
              <button data-testid="ctx-show-all" onClick={showAll}
                className="mt-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-brand hover:bg-accent">
                <Eye size={15} /> Reexibir todas
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
