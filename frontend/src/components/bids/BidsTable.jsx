import { useNavigate } from "react-router-dom";
import { Star, FileText, Calculator, Pencil, Trash2, MessageSquare, FileX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDropdown } from "@/components/bids/StatusDropdown";
import { useData } from "@/context/DataContext";
import { fileUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmtDate = (d) => {
  if (!d) return "--";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const COLS = [
  "Data / Hora", "★", "Modalidade", "Itens", "Objeto", "Portal",
  "Pregão / UASG", "Status", "PDF", "Orçamento", "Ações",
];

export const BidsTable = ({ bids, onEdit, onDelete }) => {
  const { toggleFavorite } = useData();
  const navigate = useNavigate();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {COLS.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bids.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-16 text-center">
                  <FileX size={40} className="mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Nenhuma licitação encontrada</p>
                </td>
              </tr>
            )}
            {bids.map((b) => (
              <tr key={b.id} data-testid={`bid-row-${b.id}`} className="border-b border-border transition-colors last:border-0 hover:bg-accent/40">
                {/* 1. Data / Hora */}
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="font-medium text-foreground">{fmtDate(b.data_disputa)}</div>
                  <div className="font-mono-num text-xs text-muted-foreground">{b.hora || "--:--"}</div>
                </td>
                {/* 2. Acompanhar */}
                <td className="px-3 py-3">
                  <button
                    data-testid={`bid-star-${b.id}`}
                    onClick={() => toggleFavorite(b.id, !b.favorito)}
                    className="transition-transform hover:scale-125"
                  >
                    <Star size={18} className={cn(b.favorito ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} />
                  </button>
                </td>
                {/* 3. Modalidade */}
                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{b.modalidade}</td>
                {/* 4. Itens */}
                <td className="px-3 py-3">
                  <div className="flex max-w-[140px] flex-wrap gap-1">
                    {(b.itens_list || []).map((it, i) => (
                      <span key={i} className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                        {it}
                      </span>
                    ))}
                  </div>
                </td>
                {/* 5. Objeto + tooltip */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="block max-w-[260px] truncate font-medium text-foreground">{b.objeto}</span>
                    {b.observacao && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button data-testid={`bid-obs-${b.id}`}><MessageSquare size={14} className="text-brand" /></button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{b.observacao}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </td>
                {/* 6. Portal */}
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">{b.portal}</span>
                </td>
                {/* 7. Pregão / UASG */}
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="font-mono-num text-foreground">{b.pregao || "--"}</div>
                  <div className="font-mono-num text-xs text-muted-foreground">{b.uasg || "--"}</div>
                </td>
                {/* 8. Status */}
                <td className="px-3 py-3"><StatusDropdown bid={b} /></td>
                {/* 9. PDF */}
                <td className="px-3 py-3">
                  {b.termo_referencia ? (
                    <a href={fileUrl(b.termo_referencia.id)} target="_blank" rel="noreferrer" data-testid={`bid-pdf-${b.id}`} className="flex h-8 w-8 items-center justify-center rounded-md text-alert hover:bg-alert/10">
                      <FileText size={18} />
                    </a>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/30"><FileText size={18} /></span>
                  )}
                </td>
                {/* 10. Orçamento */}
                <td className="px-3 py-3">
                  <button
                    data-testid={`bid-budget-${b.id}`}
                    onClick={() => navigate(`/orcamento/${b.id}`)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-brand hover:bg-brand/10"
                    title="Abrir orçamento"
                  >
                    <Calculator size={18} />
                  </button>
                </td>
                {/* 11. Ações */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
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
    </TooltipProvider>
  );
};
