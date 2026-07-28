import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Star, FileText, Image as ImageIcon, Calculator, Pencil, Trash2, FileX } from "lucide-react";
import { StatusDropdown } from "@/components/bids/StatusDropdown";
import { PortalName } from "@/components/bids/PortalName";
import { ObservacaoTags } from "@/components/bids/ObservacaoTags";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useColumnResize, ColResizer } from "@/components/table/resizable";
import { SortArrows } from "@/components/table/SortArrows";
import { StickyHorizontalScrollbar } from "@/components/table/StickyHorizontalScrollbar";
import { usePersistentSort } from "@/hooks/usePersistentSort";
import { useData } from "@/context/DataContext";
import { fileUrl } from "@/lib/api";
import { hexToRgba, tagColorAt } from "@/lib/constants";
import { cn } from "@/lib/utils";

const fmtDate = (d) => {
  if (!d) return "--";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const isImage = (name = "") => /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
const FileTypeIcon = ({ name, size = 16 }) =>
  isImage(name) ? <ImageIcon size={size} className="shrink-0 text-emerald-600" /> : <FileText size={size} className="shrink-0 text-alert" />;

// Portal e Modalidade compartilham uma coluna (portal em cima, modalidade abaixo).
const COLS = [
  { label: "Data / Hora", key: "data_disputa", type: "date", w: 110 },
  { label: "★", key: null, w: 52 },
  { label: "PROP.", key: null, w: 56 },
  { label: "Portal / Modalidade", key: "portal", type: "text", w: 170 },
  { label: "Itens", key: null, w: 130 },
  { label: "Objeto", key: "objeto", type: "text", w: 260 },
  { label: "Observação", key: null, w: 230 },
  { label: "Pregão / UASG", key: "pregao", type: "text", w: 140 },
  { label: "Status", key: "status", type: "text", w: 160 },
  { label: "Arquivos", key: null, w: 80 },
  { label: "Orçamento", key: null, w: 96 },
  { label: "Ações", key: null, w: 96 },
];

const FilesCell = ({ files }) => {
  if (files.length === 0) {
    return <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/30"><FileText size={18} /></span>;
  }
  if (files.length === 1) {
    return (
      <a href={fileUrl(files[0].id)} target="_blank" rel="noreferrer" data-testid="bid-file-single" className="flex h-8 w-8 items-center justify-center rounded-md text-alert hover:bg-alert/10" title={files[0].filename}>
        <FileTypeIcon name={files[0].filename} size={18} />
      </a>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="bid-files-trigger" className="relative flex h-8 w-8 items-center justify-center rounded-md text-alert hover:bg-alert/10" title={`${files.length} arquivos`}>
          <FileText size={18} />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
            {files.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1" data-testid="bid-files-popover">
        <p className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{files.length} arquivos</p>
        {files.map((f, i) => (
          <a
            key={f.id || i} href={fileUrl(f.id)} target="_blank" rel="noreferrer"
            data-testid={`bid-file-item-${i}`}
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
          >
            <FileTypeIcon name={f.filename} />
            <span className="truncate">{f.filename}</span>
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export const BidsTable = ({ bids, onEdit, onDelete }) => {
  const { toggleFavorite, updateObservacoes, toggleProposta } = useData();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const { widths, startResize, total } = useColumnResize("bidstable_widths_v4", COLS.map((c) => c.w));
  // Padrão: data/hora da disputa decrescente (mais recente primeiro).
  // Persistido por usuário no backend (preferências) — ver usePersistentSort.
  const [sort, toggleSort] = usePersistentSort("bids", { key: "data_disputa", dir: "desc" });

  const sorted = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    if (!col) return bids;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (b) => (col.key === "data_disputa" ? `${b.data_disputa || ""}T${b.hora || ""}` : (b[col.key] ?? "").toString());
    return [...bids].sort((a, b) => {
      const va = val(a), vb = val(b);
      // Registros sem valor (ex.: sem data) sempre no fim, em qualquer direção.
      const ea = !va || va === "T", eb = !vb || vb === "T";
      if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
      return dir * va.localeCompare(vb, "pt-BR", { numeric: true, sensitivity: "base" });
    });
  }, [bids, sort]);

  return (
    <>
    <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="rt-fixed border-collapse text-sm" style={{ width: total }}>
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {COLS.map((col, i) => (
              <th key={col.label} data-testid={col.key ? `bid-th-${col.key}` : undefined} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex select-none items-center">
                  {col.label}
                  {col.key && <SortArrows active={sort.key === col.key} dir={sort.dir} onClick={() => toggleSort(col.key)} />}
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
          {sorted.map((b) => {
            const files = [b.termo_referencia, ...(b.anexos || [])].filter(Boolean);
            return (
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
                {/* 3. PROP. (proposta enviada) */}
                <td className="px-3 py-3">
                  <button
                    data-testid={`bid-prop-${b.id}`}
                    onClick={() => toggleProposta(b.id, !b.proposta_enviada)}
                    title={b.proposta_enviada ? "Proposta enviada" : "Proposta não enviada"}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold transition-all",
                      b.proposta_enviada ? "bg-brand/10 text-brand ring-1 ring-brand/40" : "text-muted-foreground/40 hover:bg-accent"
                    )}
                  >
                    P
                  </button>
                </td>
                {/* 4. Portal / Modalidade (portal em cima com cor do parâmetro, modalidade abaixo) */}
                <td className="px-3 py-3">
                  <PortalName portal={b.portal} />
                  <span className="block truncate text-xs text-muted-foreground" title={b.modalidade}>{b.modalidade}</span>
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
                {/* 7. Objeto */}
                <td className="px-3 py-3">
                  <span className="block max-w-[260px] truncate font-medium text-foreground">{b.objeto}</span>
                </td>
                {/* 8. Observação */}
                <td className="px-3 py-3">
                  <ObservacaoTags testid={`bid-obs-${b.id}`} value={b.observacoes || []} onChange={(arr) => updateObservacoes(b.id, arr)} />
                </td>
                {/* 9. Pregão / UASG */}
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="font-mono-num text-foreground">{b.pregao || "--"}</div>
                  <div className="font-mono-num text-xs text-muted-foreground">{b.uasg || "--"}</div>
                </td>
                {/* 10. Status */}
                <td className="px-3 py-3"><StatusDropdown bid={b} /></td>
                {/* 11. Arquivos (multi com badge + popover) */}
                <td className="px-3 py-3"><FilesCell files={files} /></td>
                {/* 12. Orçamento */}
                <td className="px-3 py-3">
                  <button data-testid={`bid-budget-${b.id}`} onClick={() => navigate(`/orcamento/${b.id}`)} className="flex h-8 w-8 items-center justify-center rounded-md text-brand hover:bg-brand/10" title="Abrir orçamento">
                    <Calculator size={18} />
                  </button>
                </td>
                {/* 13. Ações */}
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
            );
          })}
        </tbody>
      </table>
    </div>
    <StickyHorizontalScrollbar targetRef={scrollRef} />
    </>
  );
};
