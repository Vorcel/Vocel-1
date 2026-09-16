import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/FileUpload";
import { useData } from "@/context/DataContext";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";

// Informação discreta da licitação, só para conferência (não é formulário).
const Info = ({ label, value }) =>
  value ? (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="truncate text-foreground" title={value}>{value}</span>
    </span>
  ) : null;

// "Adicionar Proposta" (primeiro upload) e "Substituir proposta" — o mesmo formulário,
// mudando só o texto e o verbo usado no DataContext.
export const PropostaUploadModal = ({ open, onOpenChange, bid, modo = "novo", onSaved }) => {
  const { uploadProposta, replaceProposta } = useData();
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const substituindo = modo === "substituir";

  // Cada abertura começa limpa (evita reaproveitar o arquivo da licitação anterior).
  useEffect(() => {
    if (open) setFile(null);
  }, [open, bid?.id]);

  const salvar = async () => {
    if (!file || !bid) return;
    setSaving(true);
    try {
      const atualizada = substituindo ? await replaceProposta(bid.id, file) : await uploadProposta(bid.id, file);
      toast.success(substituindo ? "Proposta substituída" : "Proposta salva");
      onOpenChange(false);
      onSaved?.(atualizada);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent data-testid="proposta-upload-modal" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">{substituindo ? "Substituir Proposta" : "Adicionar Proposta"}</DialogTitle>
        </DialogHeader>

        {bid && (
          <div className="flex flex-col gap-1 border-b border-border pb-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Info label="Pregão" value={bid.pregao} />
              <Info label="UASG" value={bid.uasg} />
            </div>
            <Info label="Objeto" value={bid.objeto} />
          </div>
        )}

        <div className="py-1">
          <FileUpload
            testid="proposta-file"
            accept=".docx"
            maxMb={10}
            deferred
            value={file}
            onSelect={setFile}
            onRemove={() => setFile(null)}
          />
          <p className="mt-2 text-xs text-muted-foreground">Arquivo do Word em formato .docx (máx 10MB).</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button data-testid="proposta-save" onClick={salvar} disabled={!file || saving} className="bg-brand hover:bg-brand-hover">
            {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            {substituindo ? "Substituir proposta" : "Salvar proposta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
