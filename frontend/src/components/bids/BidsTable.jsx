import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, FileText, Calculator, Pencil, Trash2, FileX, ChevronUp, ChevronDown } from "lucide-react";
import { StatusDropdown } from "@/components/bids/StatusDropdown";
import { ObservacaoTags } from "@/components/bids/ObservacaoTags";
import { useColumnResize, ColResizer } from "@/components/table/resizable";
import { useData } from "@/context/DataContext";
import { fileUrl } from "@/lib/api";
import { colorStyles, findColor, hexToRgba, tagColorAt } from "@/lib/constants";
import { cn } from "@/lib/utils";

const fmtDate = (d) => {
  if (!d) return "--";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// Ordem (Req #5): Modalidade > Portal > Itens; Observação ao lado de Objeto.
const COLS = [
  { label: "Data / Hora", key: "data_disputa", type: "date", w: 110 },
  { label: "★", key: null, w: 52 },
  { label: "Modalidade", key: "modalidade", type: "text", w: 150 },
  { label: "Portal", key: "portal", type: "text", w: 150 },
  { label: "Itens", key: null, w: 130 },
  { label: "Objeto", key: "objeto", type: "text", w: 260 },
  { label: "Observação", key: null, w: 230 },
  { label: "Pregão / UASG", key: "pregao", type: "text", w: 140 },
  { label: "Status", key: "status", type: "text", w: 160 },
  { label: "PDF", key: null, w: 72 },
  { label: "Orçamento", key: null, w: 96 },
  { label: "Ações", key: null, w: 96 },
];

const SortArrows = ({ active, dir }) => (
  <span className="ml-1 inline-flex flex-col leading-[0]">
    <ChevronUp size={10} className={cn(active && dir === "asc" ? "text-foreground" : "text-muted-foreground/40")} />
    <ChevronDown size={10} className={cn("-mt-0.5", active && dir === "desc" ? "text-foreground" : "text-muted-foreground/40")} />
  </span>
);

export const BidsTable = ({ bids, onEdit, onDelete }) => {
  const { toggleFavorite, updateObservacoes, lists } = useData();
  const navigate = useNavigate();
  const { widths, startResize, total } = useColumnResize(
    "bidstable_widths_v2",
    COLS.map((c) => c.w)
  );
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  const toggleSort = (col) => {
    if (!col.key) return;
    setSort((s) => (s.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" }));
  };

  const sorted = useMemo(() => {
    if (!sort.key) return bids;
    const col = COLS.find((c) => c.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (b) =>
      col.key === "data_disputa" ? `${b.data_disputa || ""}T${b.hora || ""}` : (b[col.key] ?? "").toString();
    return [...bids].sort((a, b) => dir * val(a).localeCompare(val(b), "pt-BR", { numeric: true, sensitivity: "base" }));
  }, [bids, sort]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="rt-fixed border-collapse text-sm" style={{ width: total }}>
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {COLS.map((col, i) => (
              <th
                key={col.label}
                data-testid={col.key ? `bid-th-${col.key}` : undefined}
                onClick={() => toggleSort(col)}
                className={cn(
                  "px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                  col.key && "cursor-pointer select-none hover:text-foreground"
                )}
              >
                <span className="inline-flex items-center">
                  {col.label}
                  {col.key && <SortArrows active={sort.key === col.key} dir={sort.dir} />}
                </span>
                {i < COLS.length - 1 && <ColResizer onMouseDown={startResize(i)} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLS.length} className="px-4 py-16 text-center">
                <FileX size={40} className="mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">Nenhuma licitação encontrada</p>
              </td>
            </tr>
          )}
          {sorted.map((b) => (
            <tr key={b.id} data-testid={`bid-row-${b.id}`} className="group border-b border-border transition-colors last:border-0 hover:bg-[#F8F9FA] dark:hover:bg-accent/40">
              {/* 1. Data / Hora */}
              <td className="whitespace-nowrap px-3 py-3">
                <div className="font-medium text-foreground">{fmtDate(b.data_disputa)}</div>
                <div className="font-mono-num text-xs text-muted-foreground">{b.hora || "--:--"}</div>
              </td>
              {/* 2. Favorito */}
              <td className="px-3 py-3">
                <button data-testid={`bid-star-${b.id}`} onClick={() => toggleFavorite(b.id, !b.favorito)} className="transition-transform hover:scale-125">
                  <Star size={18} className={cn(b.favorito ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} />
                </button>
              </td>
              {/* 3. Modalidade */}
              <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{b.modalidade}</td>
              {/* 4. Portal */}
              <td className="whitespace-nowrap px-3 py-3">
                <span style={colorStyles(findColor(lists.portais, b.portal)).badgeDark} className="rounded-full border px-2.5 py-1 text-xs font-semibold">{b.portal}</span>
              </td>
              {/* 5. Itens (cores pastel alternadas, texto escuro) */}
              <td className="px-3 py-3">
                <div className="flex max-w-[150px] flex-wrap gap-1">
                  {(b.itens_list || []).map((it, i) => (
                    <span key={i} style={{ backgroundColor: hexToRgba(tagColorAt(i), 0.18) }} className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-[#141d23]">
                      {it}
                    </span>
                  ))}
                </div>
              </td>
              {/* 6. Objeto */}
              <td className="px-3 py-3">
                <span className="block max-w-[260px] truncate font-medium text-foreground">{b.objeto}</span>
              </td>
              {/* 7. Observação (tags) */}
              <td className="px-3 py-3">
                <ObservacaoTags testid={`bid-obs-${b.id}`} value={b.observacoes || []} onChange={(arr) => updateObservacoes(b.id, arr)} />
              </td>
              {/* 8. Pregão / UASG */}
              <td className="whitespace-nowrap px-3 py-3">
                <div className="font-mono-num text-foreground">{b.pregao || "--"}</div>
                <div className="font-mono-num text-xs text-muted-foreground">{b.uasg || "--"}</div>
              </td>
              {/* 9. Status */}
              <td className="px-3 py-3"><StatusDropdown bid={b} /></td>
              {/* 10. PDF */}
              <td className="px-3 py-3">
                {b.termo_referencia ? (
                  <a href={fileUrl(b.termo_referencia.id)} target="_blank" rel="noreferrer" data-testid={`bid-pdf-${b.id}`} className="flex h-8 w-8 items-center justify-center rounded-md text-alert hover:bg-alert/10">
                    <FileText size={18} />
                  </a>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/30"><FileText size={18} /></span>
                )}
              </td>
              {/* 11. Orçamento */}
              <td className="px-3 py-3">
                <button data-testid={`bid-budget-${b.id}`} onClick={() => navigate(`/orcamento/${b.id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-brand hover:bg-brand/10" title="Abrir orçamento">
                  <Calculator size={18} />
                </button>
              </td>
              {/* 12. Ações */}
              <td className="px-3 py-3">
                <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button data-testid={`bid-edit-${b.id}`} onClick={() => onEdit(b)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title="Editar">
                    <Pencil size={16} />
                  </button>
                  <button data-testid={`bid-delete-${b.id}`} onClick={() => onDelete(b)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-alert/10 hover:text-alert" title="Excluir">
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
