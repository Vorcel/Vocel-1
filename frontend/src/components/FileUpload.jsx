import { useRef, useState } from "react";
import { UploadCloud, FileText, X, Loader2, Paperclip } from "lucide-react";
import api, { fileUrl, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Drag-and-drop file uploader. Calls onUploaded({id, filename, url, content_type}).
export const FileUpload = ({ value, onUploaded, onRemove, accept = ".pdf", maxMb = 10, testid = "file-upload", compact = false }) => {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const doUpload = async (file) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Arquivo excede ${maxMb}MB`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onUploaded(data);
      toast.success("Arquivo enviado");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (value && compact) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs" data-testid={`${testid}-chip`}>
        <Paperclip size={12} className="text-brand" />
        <a href={fileUrl(value.id)} target="_blank" rel="noreferrer" className="max-w-[120px] truncate text-foreground hover:underline">
          {value.filename}
        </a>
        {onRemove && (
          <button onClick={onRemove} data-testid={`${testid}-remove`} className="text-muted-foreground hover:text-alert">
            <X size={12} />
          </button>
        )}
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-accent/50 px-3 py-2.5" data-testid={`${testid}-file`}>
        <a href={fileUrl(value.id)} target="_blank" rel="noreferrer" className="flex items-center gap-2 truncate text-sm text-foreground hover:underline">
          <FileText size={18} className="shrink-0 text-brand" />
          <span className="truncate">{value.filename}</span>
        </a>
        {onRemove && (
          <button type="button" onClick={onRemove} data-testid={`${testid}-remove`} className="text-muted-foreground hover:text-alert">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={testid}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files[0]); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
        drag ? "border-brand bg-brand/5" : "border-border hover:border-brand/60 hover:bg-accent/40"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        data-testid={`${testid}-input`}
        onChange={(e) => doUpload(e.target.files[0])}
      />
      {busy ? (
        <Loader2 size={24} className="animate-spin text-brand" />
      ) : (
        <UploadCloud size={24} className="text-muted-foreground" />
      )}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-brand">Clique para enviar</span> ou arraste o arquivo
      </p>
      <p className="text-xs text-muted-foreground">Máx {maxMb}MB</p>
    </div>
  );
};
