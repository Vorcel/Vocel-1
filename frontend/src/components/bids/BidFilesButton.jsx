import { FileText, Image as ImageIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fileUrl } from "@/lib/api";

const isImage = (name = "") => /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
const FileTypeIcon = ({ name, size = 16 }) =>
  isImage(name)
    ? <ImageIcon size={size} className="shrink-0 text-emerald-600" />
    : <FileText size={size} className="shrink-0 text-alert" />;

// Arquivos vinculados à licitação — mesma regra usada na tabela de licitações
// (Termo de Referência + anexos). Não duplica dados: lê direto do bid vinculado.
export const collectBidFiles = (bid) =>
  [bid?.termo_referencia, ...(bid?.anexos || [])].filter(Boolean);

// Bloco compacto de arquivos para o cabeçalho do orçamento (padrão ref23:
// ícone de pasta + label "Arquivos" + quantidade). Reutiliza o mesmo mecanismo
// de visualização das demais telas: fileUrl() abre cada arquivo em nova aba.
export const BidFilesButton = ({ bid }) => {
  const files = collectBidFiles(bid);
  const count = files.length;

  const trigger = (
    <button
      type="button"
      data-testid="budget-files-trigger"
      disabled={count === 0}
      title={count === 0 ? "Nenhum arquivo anexado" : `${count} arquivo${count > 1 ? "s" : ""}`}
      className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
    >
      <FileText size={15} className="shrink-0 text-alert" />
      <span className="leading-none">
        <span className="block text-[10px] text-muted-foreground">Arquivos</span>
        <span className="block text-xs font-medium text-foreground">{count}</span>
      </span>
    </button>
  );

  if (count === 0) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1" data-testid="budget-files-popover">
        <p className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {count} arquivo{count > 1 ? "s" : ""}
        </p>
        <div className="max-h-72 overflow-y-auto">
          {files.map((f, i) => (
            <a
              key={f.id || i}
              href={fileUrl(f.id)}
              target="_blank"
              rel="noreferrer"
              data-testid={`budget-file-item-${i}`}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
            >
              <FileTypeIcon name={f.filename} />
              <span className="truncate">{f.filename}</span>
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
