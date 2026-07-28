import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SelectWithAdd } from "@/components/bids/SelectWithAdd";
import { ObservacaoTags } from "@/components/bids/ObservacaoTags";
import { FileUpload } from "@/components/FileUpload";
import { useData } from "@/context/DataContext";
import { toast } from "sonner";
import { formatApiError, fileUrl } from "@/lib/api";
import { smartTitleCase } from "@/lib/textcase";
import { cn } from "@/lib/utils";
import { X, FileText } from "lucide-react";

const ITENS_REGEX = /^\d+(,\s*\d+)*$/;
const todayStr = () => new Date().toISOString().slice(0, 10);

const Req = () => <span className="text-alert"> *</span>;

const empty = {
  objeto: "", modalidade: "", itens: "", portal: "",
  data_disputa: "", hora: "", pregao: "", uasg: "",
  observacao: "", observacoes: [], proposta_enviada: false,
  termo_referencia: null, anexos: [], status: "Disputar", favorito: false,
};

export const BidFormModal = ({ open, onOpenChange, editing, wonMode = false, onCreated }) => {
  const { createBid, updateBid } = useData();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      const base = editing ? { ...empty, ...editing } : { ...empty };
      // Migra observação antiga (string) para o novo formato de tags.
      if (editing && (!base.observacoes || base.observacoes.length === 0) && editing.observacao) {
        base.observacoes = [{ id: `obs_legacy_${editing.id}`, text: editing.observacao, color: "#64748B" }];
      }
      setForm(base);
      setTouched({});
      setSubmitAttempted(false);
    }
  }, [open, editing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const errors = useMemo(() => {
    const e = {};
    if (!form.objeto.trim()) e.objeto = "Obrigatório";
    if (!form.modalidade) e.modalidade = "Obrigatório";
    if (!form.itens.trim()) e.itens = "Obrigatório";
    else if (!ITENS_REGEX.test(form.itens.trim())) e.itens = "Use números separados por vírgula. Ex: 1, 2, 3";
    if (!form.portal) e.portal = "Obrigatório";
    if (!form.data_disputa) e.data_disputa = "Obrigatório";
    // Em wonMode a licitação já foi ganha (pode ser passada), então não bloqueia data retroativa.
    else if (!editing && !wonMode && form.data_disputa < todayStr()) e.data_disputa = "Não é permitida data retroativa";
    if (!form.hora) e.hora = "Obrigatório";
    if (!form.pregao.trim()) e.pregao = "Obrigatório";
    if (!form.uasg.trim()) e.uasg = "Obrigatório";
    if (!form.termo_referencia) e.termo = "Anexe o Termo de Referência (PDF)";
    return e;
  }, [form, editing, wonMode]);

  const valid = Object.keys(errors).length === 0;

  const submit = async () => {
    if (!valid) { setSubmitAttempted(true); return; }
    setSaving(true);
    try {
      const obsList = form.observacoes || [];
      const payload = {
        ...form,
        observacoes: obsList,
        observacao: obsList.map((o) => o.text).join("; "),
        status: editing ? form.status : (wonMode ? "Adjudicado" : "Disputar"),
      };
      if (editing) {
        await updateBid(editing.id, payload);
      } else {
        const created = await createBid(payload);
        if (wonMode) onCreated?.(created);
      }
      toast.success(editing ? "Licitação atualizada" : (wonMode ? "Licitação ganha cadastrada" : "Licitação cadastrada"));
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const err = (k) => (touched[k] || submitAttempted) && errors[k];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="bid-modal">
        <DialogHeader>
          <DialogTitle className="font-heading">{editing ? "Editar Licitação" : wonMode ? "Adicionar Licitação Ganha" : "Nova Licitação"}</DialogTitle>
          <DialogDescription>{wonMode ? "Cadastre uma licitação já ganha. Ela será marcada como Adjudicada e entrará automaticamente no fluxo de execução/pós-venda." : "Preencha os campos obrigatórios (*) para cadastrar a disputa."}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome do Objeto<Req /></Label>
            <Input
              data-testid="bid-objeto"
              value={form.objeto}
              onChange={(e) => set("objeto", e.target.value)}
              onBlur={() => { setTouched((t) => ({ ...t, objeto: true })); set("objeto", smartTitleCase(form.objeto)); }}
              placeholder="Ex: Aquisição de equipamentos de informática"
              aria-invalid={!!err("objeto") || undefined}
              aria-describedby={err("objeto") ? "err-objeto" : undefined}
              className={cn(err("objeto") && "border-alert focus-visible:ring-alert")}
            />
            {err("objeto") && <p id="err-objeto" className="text-xs text-alert">{errors.objeto}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Modalidade<Req /></Label>
              <SelectWithAdd listType="modalidades" value={form.modalidade} onChange={(v) => set("modalidade", v)} placeholder="Selecione" testid="bid-modalidade" invalid={!!err("modalidade")} />
              {err("modalidade") && <p className="text-xs text-alert">{errors.modalidade}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Portal *</Label>
              <SelectWithAdd listType="portais" value={form.portal} onChange={(v) => set("portal", v)} placeholder="Selecione" testid="bid-portal" invalid={!!err("portal")} />
              {err("portal") && <p className="text-xs text-alert">{errors.portal}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Números dos Itens<Req /></Label>
            <Input
              data-testid="bid-itens"
              value={form.itens}
              onChange={(e) => set("itens", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, itens: true }))}
              placeholder="Ex: 1, 2, 5, 8"
              aria-invalid={!!err("itens") || undefined}
              aria-describedby={err("itens") ? "err-itens" : undefined}
              className={cn(err("itens") && "border-alert focus-visible:ring-alert")}
            />
            {err("itens") && <p id="err-itens" className="text-xs text-alert">{errors.itens}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data da Disputa<Req /></Label>
              <Input
                type="date"
                data-testid="bid-data"
                min={editing || wonMode ? undefined : todayStr()}
                value={form.data_disputa}
                onChange={(e) => set("data_disputa", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, data_disputa: true }))}
                aria-invalid={!!err("data_disputa") || undefined}
                aria-describedby={err("data_disputa") ? "err-data" : undefined}
                className={cn(err("data_disputa") && "border-alert focus-visible:ring-alert")}
              />
              {err("data_disputa") && <p id="err-data" className="text-xs text-alert">{errors.data_disputa}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Hora<Req /></Label>
              <Input
                type="time"
                data-testid="bid-hora"
                value={form.hora}
                onChange={(e) => set("hora", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, hora: true }))}
                aria-invalid={!!err("hora") || undefined}
                aria-describedby={err("hora") ? "err-hora" : undefined}
                className={cn(err("hora") && "border-alert focus-visible:ring-alert")}
              />
              {err("hora") && <p id="err-hora" className="text-xs text-alert">{errors.hora}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pregão<Req /></Label>
              <Input data-testid="bid-pregao" value={form.pregao} onChange={(e) => set("pregao", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, pregao: true }))} placeholder="Ex: 90012/2026"
                aria-invalid={!!err("pregao") || undefined} aria-describedby={err("pregao") ? "err-pregao" : undefined}
                className={cn(err("pregao") && "border-alert focus-visible:ring-alert")} />
              {err("pregao") && <p id="err-pregao" className="text-xs text-alert">{errors.pregao}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>UASG<Req /></Label>
              <Input data-testid="bid-uasg" value={form.uasg} onChange={(e) => set("uasg", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, uasg: true }))} placeholder="Ex: 160088"
                aria-invalid={!!err("uasg") || undefined} aria-describedby={err("uasg") ? "err-uasg" : undefined}
                className={cn(err("uasg") && "border-alert focus-visible:ring-alert")} />
              {err("uasg") && <p id="err-uasg" className="text-xs text-alert">{errors.uasg}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observações</Label>
            <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="bid-obs">
              <ObservacaoTags value={form.observacoes} onChange={(arr) => set("observacoes", arr)} testid="bid-modal-obs" />
            </div>
            <p className="text-xs text-muted-foreground">Adicione anotações como tags coloridas (clique no “+”).</p>
          </div>

          <div className="space-y-1.5">
            <Label>Termo de Referência (PDF)<Req /></Label>
            <FileUpload
              testid="bid-termo"
              accept=".pdf"
              value={form.termo_referencia}
              onUploaded={(f) => set("termo_referencia", f)}
              onRemove={() => set("termo_referencia", null)}
              invalid={!!err("termo")}
            />
            {err("termo") && <p id="err-termo" className="text-xs text-alert">{errors.termo}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Anexos adicionais (opcional)</Label>
            {(form.anexos || []).length > 0 && (
              <div className="space-y-1.5" data-testid="bid-anexos-list">
                {form.anexos.map((a, i) => (
                  <div key={a.id || i} className="flex items-center justify-between rounded-md border border-border bg-accent/40 px-3 py-2 text-sm">
                    <a href={fileUrl(a.id)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 truncate hover:underline">
                      <FileText size={15} className="shrink-0 text-brand" />
                      <span className="truncate">{a.filename}</span>
                    </a>
                    <button type="button" data-testid={`bid-anexo-remove-${i}`} onClick={() => set("anexos", form.anexos.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-alert">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <FileUpload
              testid="bid-anexo"
              accept=".pdf,.png,.jpg,.jpeg"
              value={null}
              onUploaded={(f) => set("anexos", [...(form.anexos || []), f])}
            />
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          {submitAttempted && !valid ? (
            <p role="alert" data-testid="bid-required-msg" className="text-sm font-medium text-alert">Preencha os campos obrigatórios</p>
          ) : <span className="hidden sm:block" />}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="bid-cancel">Cancelar</Button>
            {/* Botão sempre habilitado: a validação ocorre no clique (submit). */}
            <Button onClick={submit} disabled={saving} data-testid="bid-save" className="bg-brand hover:bg-brand-hover">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
