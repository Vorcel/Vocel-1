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
import { formatApiError } from "@/lib/api";

const ITENS_REGEX = /^\d+(,\s*\d+)*$/;
const todayStr = () => new Date().toISOString().slice(0, 10);

const Req = () => <span className="text-alert"> *</span>;

const empty = {
  objeto: "", modalidade: "", itens: "", portal: "",
  data_disputa: "", hora: "", pregao: "", uasg: "",
  observacao: "", observacoes: [], termo_referencia: null, status: "Disputar", favorito: false,
};

export const BidFormModal = ({ open, onOpenChange, editing }) => {
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
    else if (!editing && form.data_disputa < todayStr()) e.data_disputa = "Não é permitida data retroativa";
    if (!form.hora) e.hora = "Obrigatório";
    if (!form.pregao.trim()) e.pregao = "Obrigatório";
    if (!form.uasg.trim()) e.uasg = "Obrigatório";
    if (!form.termo_referencia) e.termo = "Anexe o Termo de Referência (PDF)";
    return e;
  }, [form, editing]);

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
        status: editing ? form.status : "Disputar",
      };
      if (editing) await updateBid(editing.id, payload);
      else await createBid(payload);
      toast.success(editing ? "Licitação atualizada" : "Licitação cadastrada");
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
          <DialogTitle className="font-heading">{editing ? "Editar Licitação" : "Nova Licitação"}</DialogTitle>
          <DialogDescription>Preencha os campos obrigatórios (*) para cadastrar a disputa.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome do Objeto<Req /></Label>
            <Input
              data-testid="bid-objeto"
              value={form.objeto}
              onChange={(e) => set("objeto", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, objeto: true }))}
              placeholder="Ex: Aquisição de equipamentos de informática"
            />
            {err("objeto") && <p className="text-xs text-alert">{errors.objeto}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Modalidade<Req /></Label>
              <SelectWithAdd listType="modalidades" value={form.modalidade} onChange={(v) => set("modalidade", v)} placeholder="Selecione" testid="bid-modalidade" />
              {err("modalidade") && <p className="text-xs text-alert">{errors.modalidade}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Portal *</Label>
              <SelectWithAdd listType="portais" value={form.portal} onChange={(v) => set("portal", v)} placeholder="Selecione" testid="bid-portal" />
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
            />
            {err("itens") && <p className="text-xs text-alert">{errors.itens}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data da Disputa<Req /></Label>
              <Input
                type="date"
                data-testid="bid-data"
                min={editing ? undefined : todayStr()}
                value={form.data_disputa}
                onChange={(e) => set("data_disputa", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, data_disputa: true }))}
              />
              {err("data_disputa") && <p className="text-xs text-alert">{errors.data_disputa}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Hora<Req /></Label>
              <Input
                type="time"
                data-testid="bid-hora"
                value={form.hora}
                onChange={(e) => set("hora", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, hora: true }))}
              />
              {err("hora") && <p className="text-xs text-alert">{errors.hora}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pregão<Req /></Label>
              <Input data-testid="bid-pregao" value={form.pregao} onChange={(e) => set("pregao", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, pregao: true }))} placeholder="Ex: 90012/2026" />
              {err("pregao") && <p className="text-xs text-alert">{errors.pregao}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>UASG<Req /></Label>
              <Input data-testid="bid-uasg" value={form.uasg} onChange={(e) => set("uasg", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, uasg: true }))} placeholder="Ex: 160088" />
              {err("uasg") && <p className="text-xs text-alert">{errors.uasg}</p>}
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
            />
            {err("termo") && <p className="text-xs text-alert">{errors.termo}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="bid-cancel">Cancelar</Button>
          <Button onClick={submit} disabled={!valid || saving} data-testid="bid-save" className="bg-brand hover:bg-brand-hover">
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
