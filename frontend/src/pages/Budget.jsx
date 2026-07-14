import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2, TrendingUp, Percent, Wallet, Pencil, Check, Cloud, CheckCircle2, EyeOff, Eye, ChevronDown, Layers, BadgePercent, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useColumnResize, ColResizer } from "@/components/table/resizable";
import api, { formatApiError } from "@/lib/api";
import { computeRow, computeLote, computeTotals, brl, pct, num } from "@/lib/calc";
import { smartTitleCase } from "@/lib/textcase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

let _rid = 0;
const newRow = (defaults) => ({
  _id: `r${Date.now()}_${_rid++}`,
  selecionado: true, lote: "1", item: "", produto: "", marca: "", fornecedor: "", site: "",
  valor_compra: "", qtd: "1", valor_venda: "", margem: String(defaults.margem ?? 30),
  icms: String(defaults.icms ?? 18), pis_cofins: String(defaults.pis_cofins ?? 9.25),
  outros_sem_imp: "0", outros_com_imp: "0", frete_receber: "0", frete_enviar: "0",
  mode: "margem",
});

// Column model — drives header, body, resizing, hide/show, keyboard nav.
const COLUMNS = [
  { key: "selecionar", label: "SELECIONAR", w: 70, type: "select", sticky: true, noHide: true },
  { key: "lote", label: "LOTE", w: 90, type: "lote" },
  { key: "item", label: "ITEM", w: 70, type: "text" },
  { key: "produto", label: "PRODUTO", w: 180, type: "text" },
  { key: "marca", label: "MARCA", w: 110, type: "text" },
  { key: "fornecedor", label: "FORNECEDOR", w: 130, type: "text" },
  { key: "site", label: "SITE", w: 120, type: "site" },
  { key: "valor_compra", label: "VALOR COMPRA", head: ["VALOR", "COMPRA"], w: 110, type: "currency" },
  { key: "qtd", label: "QTD", w: 70, type: "number" },
  { key: "valor_venda", label: "VALOR VENDA", head: ["VALOR", "VENDA"], w: 110, type: "venda" },
  { key: "margem", label: "MARGEM DESEJADA", head: ["MARGEM", "DESEJADA"], w: 110, type: "margem" },
  { key: "margem_real", label: "MARGEM REAL", head: ["MARGEM", "REAL"], w: 100, type: "calc_pct" },
  { key: "icms", label: "ICMS", w: 80, type: "percent" },
  { key: "pis_cofins", label: "PIS/COFINS", head: ["PIS/", "COFINS"], w: 90, type: "percent" },
  { key: "outros_sem_imp", label: "OUTROS S/ IMP.", head: ["OUTROS", "S/ IMP."], w: 100, type: "currency" },
  { key: "outros_com_imp", label: "OUTROS C/ IMP.", head: ["OUTROS", "C/ IMP."], w: 100, type: "currency" },
  { key: "frete_receber", label: "FRETE RECEBER", head: ["FRETE", "RECEBER"], w: 100, type: "currency" },
  { key: "frete_enviar", label: "FRETE ENVIAR", head: ["FRETE", "ENVIAR"], w: 100, type: "currency" },
  { key: "custo_base_unit", label: "CUSTO BASE UN.", head: ["CUSTO BASE", "UN."], w: 120, type: "calc_currency" },
  { key: "lucro_unit", label: "LUCRO UNIT.", head: ["LUCRO", "UNIT."], w: 110, type: "calc_currency", tint: "green", neg: true },
  { key: "valor_unidade", label: "VALOR DA UNIDADE", head: ["VALOR DA", "UNIDADE"], w: 120, type: "calc_currency", tint: "blue" },
  { key: "lucro_total", label: "LUCRO TOTAL", head: ["LUCRO", "TOTAL"], w: 110, type: "calc_currency", tint: "green", neg: true },
  { key: "valor_total", label: "VALOR TOTAL", head: ["VALOR", "TOTAL"], w: 110, type: "calc_currency", tint: "blue" },
];
const DEFAULT_WIDTHS = COLUMNS.map((c) => c.w);
const EDITABLE_TYPES = new Set(["text", "number", "currency", "percent", "venda", "margem"]);
const isCellEditable = (col) => EDITABLE_TYPES.has(col.type);

// Card individual de uma "camada" de lote — cores fiéis à referência.
function LoteStatCard({ variant, label, value, icon: Icon, testid }) {
  const styles = {
    id: "bg-[#EEF2F8] border-transparent text-[#1A1A1A] dark:bg-slate-800",
    blue: "bg-[#2563EB] border-transparent text-white",
    green: "bg-[#E8F8EF] border-transparent text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    orange: "bg-[#FFF4E8] border-transparent text-orange-600 dark:bg-orange-950/40 dark:text-orange-300",
    white: "bg-card border-border text-foreground",
  };
  const labelCls = variant === "blue" ? "text-white/80" : "text-current opacity-70";
  return (
    <div data-testid={testid} className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 shadow-sm", styles[variant])}>
      {Icon && (
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", variant === "blue" ? "bg-white/20" : "bg-black/5")}>
          <Icon size={16} />
        </div>
      )}
      <div className="min-w-0">
        <p className={cn("text-[10px] font-bold uppercase leading-tight tracking-wider", labelCls)}>{label}</p>
        <p className="font-mono-num truncate font-heading text-base font-bold leading-tight">{value}</p>
      </div>
    </div>
  );
}

// Camada (linha) de 5 cartões para um lote.
function LoteLayer({ data }) {
  return (
    <div data-testid={`lote-layer-${data.lote}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <LoteStatCard testid={`lote-id-${data.lote}`} variant="id" label="Lote" value={`Lote ${data.lote}`} />
      <LoteStatCard testid={`lote-valor-${data.lote}`} variant="blue" label="Valor Total" value={brl(data.valor_total)} icon={TrendingUp} />
      <LoteStatCard testid={`lote-lucro-${data.lote}`} variant="green" label="Lucro do Lote" value={brl(data.lucro)} icon={BadgePercent} />
      <LoteStatCard testid={`lote-margem-${data.lote}`} variant="orange" label="Margem do Lote" value={pct(data.margem)} icon={Percent} />
      <LoteStatCard testid={`lote-investido-${data.lote}`} variant="white" label="Valor Investido" value={brl(data.investido)} icon={Wallet} />
    </div>
  );
}

// Célula de Lote: dropdown numérico (1-5 + custom) com máscara "Lote N".
function LoteCell({ value, options, onChange, onAddOption }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const cur = num(value) || 1;

  const add = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) { onAddOption(n); onChange(n); setOpen(false); }
    setDraft(""); setAdding(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="lote-trigger" className="flex h-[37px] w-full items-center justify-between px-2 text-sm hover:bg-accent/40">
          <span className="font-medium">Lote {cur}</span>
          <ChevronDown size={13} className="text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-32 p-1" data-testid="lote-menu">
        <div className="max-h-48 overflow-y-auto">
          {options.map((o) => (
            <button key={o} type="button" data-testid={`lote-opt-${o}`} onClick={() => { onChange(o); setOpen(false); }}
              className={cn("flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent", o === cur && "bg-accent font-semibold")}>
              Lote {o}
            </button>
          ))}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          {adding ? (
            <div className="flex items-center gap-1 px-1">
              <input
                autoFocus type="number" min="1" value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
                data-testid="lote-add-input" placeholder="Nº"
                className="no-spin w-full rounded border border-input bg-transparent px-1.5 py-1 text-sm outline-none focus:ring-1 focus:ring-brand"
              />
              <button type="button" onClick={add} data-testid="lote-add-confirm" className="text-emerald-600"><Check size={15} /></button>
            </div>
          ) : (
            <button type="button" data-testid="lote-add" onClick={() => setAdding(true)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-brand hover:bg-accent">
              <Plus size={14} /> Adicionar
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Excel-style editable cell: read-only formatted view that turns into an input
// on click. Commits on Enter/Tab (and advances) or Blur. Cancels on Escape.
function EditableCell({ value, type = "text", onCommit, align = "left", placeholder, readOnly, testid, shouldFocus, onAdvance }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (shouldFocus && !readOnly) { setDraft(value ?? ""); setEditing(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFocus]);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const start = () => { if (readOnly) return; setDraft(value ?? ""); setEditing(true); };
  // Texto livre recebe Smart Title Case; tipos técnicos (currency/percent/number) ficam intactos.
  const commit = (advance) => { setEditing(false); onCommit(type === "text" ? smartTitleCase(draft) : draft); if (advance && onAdvance) onAdvance(); };

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
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(true); }
          else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
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

// Indicator shown on a header edge when adjacent columns are hidden.
function HiddenIndicator({ cols, onReveal, side = "left" }) {
  return (
    <span
      data-testid="hidden-col-indicator"
      title={`Colunas ocultas: ${cols.map((c) => c.label).join(", ")} — duplo clique para reexibir`}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onReveal(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onReveal(); }}
      className={cn("absolute top-0 z-30 flex h-full w-2.5 cursor-pointer items-center justify-center bg-blue-500/80 hover:bg-blue-600",
        side === "left" ? "left-0" : "right-0")}
    >
      <span className="flex gap-[2px]">
        <span className="block h-3 w-[1.5px] bg-white" />
        <span className="block h-3 w-[1.5px] bg-white" />
      </span>
    </span>
  );
}

function tdBg(col, r, c) {
  if (col.type === "venda") return r.mode === "venda" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30";
  if (col.type === "margem") return r.mode === "margem" ? "bg-yellow-200/70 dark:bg-yellow-900/40" : "bg-yellow-50 dark:bg-yellow-950/30";
  if (col.neg && c[col.key] < 0) return "bg-[#FCE8E6] dark:bg-red-950/40";
  if (col.tint === "green") return "bg-emerald-50 dark:bg-emerald-950/40";
  if (col.tint === "blue") return "bg-blue-50 dark:bg-blue-950/40";
  return "";
}

// Linha arrastável (drag-and-drop) — usa a alça (grip) na coluna de ações.
// Reordena apenas a posição de exibição; não toca em nenhum cálculo.
function SortableRow({ r, c, visible, renderCell, selectedCols, onRequestDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r._id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 30 } : null),
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-testid={`erp-row-${r._id}`}
      className={cn(
        "border-b border-border",
        r.selecionado ? "bg-card" : "bg-muted/30",
        isDragging && "shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
      )}
    >
      {visible.map(({ c: col, i }) => (
        <td key={col.key}
          className={cn("border-r border-border",
            col.sticky ? "sticky left-0 z-10 bg-inherit px-3 py-2" : "p-0",
            tdBg(col, r, c),
            selectedCols.has(i) && "!bg-[#E8F0FE] dark:!bg-blue-950/40")}>
          {col.type === "select" ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid={`erp-drag-${r._id}`}
                {...attributes}
                {...listeners}
                style={{ touchAction: "none" }}
                title="Arraste para reordenar a linha"
                className="flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical size={14} />
              </button>
              {renderCell(col, r, c)}
            </div>
          ) : (
            renderCell(col, r, c)
          )}
        </td>
      ))}
      <td className="sticky right-0 z-10 bg-card px-2 py-2">
        <button type="button" data-testid={`erp-remove-${r._id}`} onClick={() => onRequestDelete(r._id)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-alert/10 hover:text-alert">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

export default function Budget() {
  const { bidId } = useParams();
  const navigate = useNavigate();
  const [bid, setBid] = useState(null);
  const [rows, setRows] = useState([]);
  const [defaults, setDefaults] = useState({ icms: 18, pis_cofins: 9.25, margem: 30 });
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved

  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("erp_hidden") || "[]")); } catch { return new Set(); }
  });
  const [selectedCols, setSelectedCols] = useState(() => new Set());
  const [ctx, setCtx] = useState(null); // { x, y, idx, targets }
  const [focusCell, setFocusCell] = useState(null); // { rowId, colKey }
  const [loteOptions, setLoteOptions] = useState([1, 2, 3, 4, 5]);
  // Filtro de lote por visibilidade (marcado = visível). Persistido por orçamento no localStorage.
  const [hiddenLotes, setHiddenLotes] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`erp_lote_hidden_${bidId}`) || "[]")); } catch { return new Set(); }
  });
  const [pendingDelete, setPendingDelete] = useState(null); // id da linha a excluir

  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const dragStartVis = useRef(null);
  const draggingRef = useRef(false);

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

  const { widths: ew, startResize: eResize } = useColumnResize("erp_widths_v4", DEFAULT_WIDTHS);

  // Opções de lote = 1..5 ∪ customizados ∪ lotes presentes nas linhas.
  const allLoteOptions = useMemo(() => {
    const s = new Set(loteOptions);
    rows.forEach((r) => s.add(num(r.lote) || 1));
    return [...s].sort((a, b) => a - b);
  }, [loteOptions, rows]);

  // Lotes presentes nas linhas (cada um gera um card).
  const lotesPresentes = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => s.add(num(r.lote) || 1));
    return [...s].sort((a, b) => a - b);
  }, [rows]);
  // Filtro = visibilidade. Visível = presente e NÃO ocultado. Lote novo nasce visível.
  const visibleLotes = useMemo(() => lotesPresentes.filter((l) => !hiddenLotes.has(l)), [lotesPresentes, hiddenLotes]);
  const loteLayers = useMemo(() => visibleLotes.map((l) => computeLote(rows, l)), [rows, visibleLotes]);
  // Quantos lotes presentes estão ocultos no momento (para badge/ação "mostrar todos").
  const hiddenCount = lotesPresentes.filter((l) => hiddenLotes.has(l)).length;

  // A tabela mostra SEMPRE todas as linhas. O filtro "Filtrar por Lote" afeta apenas
  // os cards/resumos superiores (via visibleLotes), nunca as linhas da tabela.
  const displayRows = rows;

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

  // Persiste o filtro de lote (cards) por orçamento, para sobreviver à saída/retorno da página.
  useEffect(() => {
    try { localStorage.setItem(`erp_lote_hidden_${bidId}`, JSON.stringify([...hiddenLotes])); } catch { /* ignore */ }
  }, [hiddenLotes, bidId]);

  const markDirty = () => { dirtyRef.current = true; };
  const updateRow = (id, patch) => { markDirty(); setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r))); };
  const onVenda = (id, v) => updateRow(id, { valor_venda: v, margem: "", mode: v === "" || num(v) === 0 ? "margem" : "venda" });
  const onMargem = (id, v) => updateRow(id, { margem: v, valor_venda: "", mode: "margem" });
  const addRow = () => { markDirty(); setRows((p) => [...p, newRow(defaults)]); };
  const removeRow = (id) => { markDirty(); setRows((p) => p.filter((r) => r._id !== id)); };
  const addLoteOption = (n) => setLoteOptions((p) => (p.includes(n) ? p : [...p, n]));
  const toggleLoteFilter = (l) => setHiddenLotes((prev) => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const showAllLotes = () => setHiddenLotes(new Set());
  const confirmDelete = () => { if (pendingDelete) removeRow(pendingDelete); setPendingDelete(null); };

  // Drag-and-drop (reordenação de linhas) — mouse + touch + teclado.
  // PointerSensor com pequena distância evita arraste acidental ao clicar na alça.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    markDirty();
    setRows((prev) => {
      const from = prev.findIndex((r) => r._id === active.id);
      const to = prev.findIndex((r) => r._id === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  };

  // Keyboard nav: advance focus to next editable cell (right; wraps to next row).
  const advanceFocus = (rowId, colKey) => {
    const cols = COLUMNS.filter((c) => !hidden.has(c.key));
    const rowIdx = rows.findIndex((r) => r._id === rowId);
    if (rowIdx < 0) return;
    const startIdx = cols.findIndex((c) => c.key === colKey);
    for (let k = startIdx + 1; k < cols.length; k++) {
      if (isCellEditable(cols[k])) { setFocusCell({ rowId, colKey: cols[k].key }); return; }
    }
    for (let ri = rowIdx + 1; ri < rows.length; ri++) {
      for (let k = 0; k < cols.length; k++) {
        if (isCellEditable(cols[k])) { setFocusCell({ rowId: rows[ri]._id, colKey: cols[k].key }); return; }
      }
    }
    setFocusCell(null);
  };

  // Hide/show persistence
  const persistHidden = (s) => { try { localStorage.setItem("erp_hidden", JSON.stringify([...s])); } catch { /* ignore */ } };
  const hideCols = (targets) => {
    setHidden((p) => { const n = new Set(p); targets.forEach((ti) => { if (!COLUMNS[ti].noHide) n.add(COLUMNS[ti].key); }); persistHidden(n); return n; });
    setSelectedCols(new Set());
    setCtx(null);
  };
  const revealCols = (cols) => setHidden((p) => { const n = new Set(p); cols.forEach((c) => n.delete(c.key)); persistHidden(n); return n; });
  const showAll = () => { setHidden(() => { persistHidden(new Set()); return new Set(); }); setCtx(null); };

  // Column selection: drag-select + Ctrl/Shift click
  const onThMouseDown = (vpos, i, e) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedCols((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
      return;
    }
    dragStartVis.current = vpos;
    draggingRef.current = true;
    setSelectedCols(new Set([i]));
    const onUp = () => { draggingRef.current = false; dragStartVis.current = null; document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mouseup", onUp);
  };
  const onThEnter = (vpos, vis) => {
    if (!draggingRef.current || dragStartVis.current == null) return;
    const a = Math.min(dragStartVis.current, vpos), b = Math.max(dragStartVis.current, vpos);
    const n = new Set();
    for (let k = a; k <= b; k++) n.add(vis[k].i);
    setSelectedCols(n);
  };
  const onHeaderCtx = (idx, e) => {
    e.preventDefault();
    const targets = selectedCols.has(idx) && selectedCols.size > 1 ? [...selectedCols] : [idx];
    setCtx({ x: e.clientX, y: e.clientY, idx, targets });
  };

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctx]);

  // Click-outside: desmarca a seleção de colunas ao clicar fora de um cabeçalho
  // (inclui clicar numa célula da tabela para iniciar edição).
  useEffect(() => {
    if (selectedCols.size === 0) return;
    const handler = (e) => {
      if (e.target.closest && e.target.closest("th")) return; // mantém ao interagir com headers
      if (draggingRef.current) return; // não interromper um arraste em andamento
      setSelectedCols(new Set());
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectedCols]);

  const visible = COLUMNS.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.key));
  const totalW = visible.reduce((a, { i }) => a + ew[i], 0) + 52;
  const hiddenList = COLUMNS.filter((c) => hidden.has(c.key));
  const selArr = [...selectedCols];

  // Hidden columns located immediately to the left of a visible column position.
  const hiddenBefore = (vpos) => {
    const curI = visible[vpos].i;
    const prevI = vpos === 0 ? -1 : visible[vpos - 1].i;
    const arr = [];
    for (let k = prevI + 1; k < curI; k++) if (hidden.has(COLUMNS[k].key)) arr.push(COLUMNS[k]);
    return arr;
  };
  // Trailing hidden columns after the last visible one.
  const trailingHidden = (() => {
    if (visible.length === 0) return [];
    const lastI = visible[visible.length - 1].i;
    const arr = [];
    for (let k = lastI + 1; k < COLUMNS.length; k++) if (hidden.has(COLUMNS[k].key)) arr.push(COLUMNS[k]);
    return arr;
  })();

  function renderCell(col, r, c) {
    const tid = `erp-${col.key}-${r._id}`;
    const focus = focusCell?.rowId === r._id && focusCell?.colKey === col.key;
    const adv = () => advanceFocus(r._id, col.key);
    switch (col.type) {
      case "select":
        return <Checkbox data-testid={`erp-select-${r._id}`} checked={r.selecionado} onCheckedChange={(v) => updateRow(r._id, { selecionado: !!v })} />;
      case "lote":
        return <LoteCell value={r.lote} options={allLoteOptions} onChange={(n) => updateRow(r._id, { lote: String(n) })} onAddOption={addLoteOption} />;
      case "site":
        return <SiteCell value={r.site} onSave={(v) => updateRow(r._id, { site: v })} />;
      case "text":
        return <EditableCell value={r[col.key]} type="text" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} shouldFocus={focus} onAdvance={adv} />;
      case "number":
        return <EditableCell value={r[col.key]} type="number" align="right" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} shouldFocus={focus} onAdvance={adv} />;
      case "currency":
        return <EditableCell value={r[col.key]} type="currency" align="right" placeholder="R$ 0,00" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} shouldFocus={focus} onAdvance={adv} />;
      case "percent":
        return <EditableCell value={r[col.key]} type="percent" align="right" placeholder="%" onCommit={(v) => updateRow(r._id, { [col.key]: v })} testid={tid} shouldFocus={focus} onAdvance={adv} />;
      case "venda":
        return <EditableCell value={r.valor_venda} type="currency" align="right" placeholder="R$" onCommit={(v) => onVenda(r._id, v)} testid={`erp-venda-${r._id}`} shouldFocus={focus} onAdvance={adv} />;
      case "margem":
        return <EditableCell value={r.margem} type="percent" align="right" placeholder="%" onCommit={(v) => onMargem(r._id, v)} testid={`erp-margem-${r._id}`} shouldFocus={focus} onAdvance={adv} />;
      case "calc_pct":
        return <div className="px-2 py-2 text-right font-mono-num text-sm font-medium text-emerald-700 dark:text-emerald-300">{pct(c[col.key])}</div>;
      case "calc_currency": {
        const val = c[col.key];
        const neg = col.neg && val < 0;
        const cls = neg ? "text-[#D93025] dark:text-red-400 font-semibold"
          : col.tint === "green" ? "text-emerald-700 dark:text-emerald-300 font-semibold"
          : col.tint === "blue" ? "text-blue-700 dark:text-blue-300 font-semibold" : "text-muted-foreground";
        return <div className={cn("px-2 py-2 text-right font-mono-num text-sm whitespace-nowrap", cls)}>{brl(val)}</div>;
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="lote-filter-trigger">
                <Layers size={15} className="mr-1.5" /> Filtrar por Lote{hiddenCount > 0 ? ` (${hiddenCount} oculto${hiddenCount > 1 ? "s" : ""})` : ""}
                <ChevronDown size={14} className="ml-1.5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1" data-testid="lote-filter-menu">
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Marcado = visível</p>
              <div className="max-h-60 overflow-y-auto">
                {lotesPresentes.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">Nenhum lote ainda.</p>
                ) : (
                  lotesPresentes.map((l) => (
                    <button key={l} type="button" data-testid={`lote-filter-opt-${l}`} onClick={() => toggleLoteFilter(l)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <Checkbox checked={!hiddenLotes.has(l)} className="pointer-events-none" />
                      Lote {l}
                    </button>
                  ))
                )}
              </div>
              {hiddenCount > 0 && (
                <button type="button" data-testid="lote-filter-clear" onClick={showAllLotes}
                  className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border px-2 py-1.5 text-left text-sm text-brand hover:bg-accent">
                  Mostrar todos os lotes
                </button>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="outline" data-testid="budget-add-row" onClick={addRow}><Plus size={16} className="mr-1.5" /> Linha</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {/* Camadas de cartões por lote (apenas linhas marcadas + do lote) */}
        <div className="max-h-[42%] shrink-0 space-y-3 overflow-y-auto pr-1" data-testid="lote-layers">
          {loteLayers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Marque itens e selecione um lote para ver os totais.</p>
          ) : (
            loteLayers.map((l) => <LoteLayer key={l.lote} data={l} />)
          )}
        </div>

        {/* Spreadsheet */}
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <table className="rt-fixed border-collapse text-sm" style={{ width: totalW }}>
            <colgroup>
              {visible.map(({ i }) => <col key={i} style={{ width: ew[i] }} />)}
              <col style={{ width: 52 }} />
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted">
                {visible.map(({ c: col, i }, vpos) => {
                  const before = hiddenBefore(vpos);
                  const isLast = vpos === visible.length - 1;
                  return (
                    <th key={col.key}
                      data-testid={`erp-th-${col.key}`}
                      onMouseDown={(e) => onThMouseDown(vpos, i, e)}
                      onMouseEnter={() => onThEnter(vpos, visible)}
                      onContextMenu={(e) => onHeaderCtx(i, e)}
                      title="Arraste p/ selecionar colunas · Ctrl+clique p/ multi-seleção · botão direito p/ ocultar"
                      className={cn(
                        "select-none border-b border-r border-border px-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
                        col.sticky && "sticky left-0 z-30 bg-muted",
                        selectedCols.has(i) && "!bg-[#E8F0FE] ring-1 ring-inset ring-blue-400 dark:!bg-blue-950/50"
                      )}>
                      {before.length > 0 && <HiddenIndicator cols={before} onReveal={() => revealCols(before)} side="left" />}
                      {isLast && trailingHidden.length > 0 && <HiddenIndicator cols={trailingHidden} onReveal={() => revealCols(trailingHidden)} side="right" />}
                      {col.head ? col.head.map((ln, k) => <span key={k} className="block leading-tight">{ln}</span>) : col.label}
                      <ColResizer onMouseDown={eResize(i, selArr.length > 1 ? selArr : null)} />
                    </th>
                  );
                })}
                <th className="sticky right-0 z-30 border-b border-border bg-muted px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={visible.length + 1} className="px-4 py-16 text-center text-muted-foreground">
                  Nenhum item. Clique em <strong>Linha</strong> para adicionar.
                </td></tr>
              )}
              <SortableContext items={displayRows.map((r) => r._id)} strategy={verticalListSortingStrategy}>
                {displayRows.map((r) => (
                  <SortableRow
                    key={r._id}
                    r={r}
                    c={computeRow(r)}
                    visible={visible}
                    renderCell={renderCell}
                    selectedCols={selectedCols}
                    onRequestDelete={setPendingDelete}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
          </DndContext>
        </div>
      </div>

      {/* Header context menu — hide / show columns */}
      {ctx && (
        <div
          data-testid="col-context-menu"
          style={{ top: ctx.y, left: ctx.x }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[210px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
          {ctx.targets.some((ti) => !COLUMNS[ti].noHide) && (
            <button data-testid="ctx-hide-col" onClick={() => hideCols(ctx.targets)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent">
              <EyeOff size={15} />
              {ctx.targets.length > 1 ? `Ocultar Colunas (${ctx.targets.filter((ti) => !COLUMNS[ti].noHide).length})` : `Ocultar “${COLUMNS[ctx.idx].label}”`}
            </button>
          )}
          {hiddenList.length > 0 && (
            <>
              <div className="my-1 border-t border-border" />
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reexibir coluna</p>
              {hiddenList.map((col) => (
                <button key={col.key} data-testid={`ctx-show-${col.key}`} onClick={() => { revealCols([col]); setCtx(null); }}
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

      {/* Confirmação de exclusão de linha */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent data-testid="erp-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta linha?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta linha? Esta ação não poderá ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="erp-delete-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction data-testid="erp-delete-confirm" onClick={confirmDelete} className="bg-alert text-white hover:bg-alert/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
