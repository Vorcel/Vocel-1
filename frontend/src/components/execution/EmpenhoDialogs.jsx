import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError, centsToInput, finApi, money, parseMoney } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { colorStyles } from "@/lib/constants";

const ALERTA_COR = "#DC2626";   // mesmo vermelho do Atestado "Não solicitado"
const ALERTA = colorStyles(ALERTA_COR);

// VALOR DO EMPENHO = dado próprio e FIXO (backend/empenho.py). O orçamento só
// define Compra/Lucro; a venda selecionada serve para CONFERIR: qualquer
// diferença em centavos acende a célula (vermelho + exclamação), sem tolerância.

const toCents = (v) => (v == null ? null : Math.round(Number(v) * 100));
export const empenhoCents = (unit) => (unit?.empenho_informado ? toCents(unit.valor_empenho) : null);

// Campo de valor em R$ com validação (> 0). Devolve centavos ou null.
function MoneyField({ label, value, onChange, testid, autoFocus, error }) {
  return (
    <div>
      <Label className="mb-1 block">{label} <span className="text-red-600">*</span></Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
        <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoFocus={autoFocus}
          data-testid={testid} className={cn("pl-9 font-mono-num", error && "border-red-500 focus-visible:ring-red-500")} />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const validCents = (text) => {
  const c = parseMoney(text);
  return c && c > 0 ? c : null;
};

// ---------------- Célula EMPENHO da tabela ----------------
// Normal: visual de sempre. Divergente (empenho ≠ venda selecionada, para cima ou
// para baixo, ou empenho ainda não informado): SÓ esta célula fica vermelha clara
// com o ícone de exclamação; o detalhe aparece no tooltip.
export function EmpenhoCell({ unit, remessasDivergentes, onClick, testid }) {
  const informado = unit?.empenho_informado;
  const divergente = !!unit?.empenho_divergente;
  const emp = empenhoCents(unit);
  const venda = Number(unit?.venda_orcamento_cents ?? toCents(unit?.venda_orcamento) ?? 0);
  const conteudo = informado ? money(emp) : "Informar";
  const clicavel = !!onClick;
  const base = "font-mono-num whitespace-nowrap px-3 py-3";
  if (!divergente) {
    return (
      <td className={base} data-testid={testid} data-divergente="0">
        {clicavel
          ? <button type="button" onClick={(ev) => { ev.stopPropagation(); onClick(); }} className="rounded hover:text-brand hover:underline" title="Alterar valor do empenho">{conteudo}</button>
          : conteudo}
      </td>
    );
  }
  const diff = informado ? emp - venda : null;
  const tip = (
    <div className="space-y-1 text-xs">
      <p className="font-semibold">
        {!informado ? "Valor do empenho ainda não informado."
          : remessasDivergentes?.length ? `Empenho diferente da venda selecionada em: ${remessasDivergentes.join(", ")}.`
            : "Valor do empenho diferente do valor total de venda selecionado."}
      </p>
      {informado && !remessasDivergentes && (
        <div className="grid grid-cols-[auto_auto] gap-x-3 font-mono-num">
          <span>Empenho:</span><span className="text-right">{money(emp)}</span>
          <span>Venda selecionada:</span><span className="text-right">{money(venda)}</span>
          <span>Diferença:</span><span className="text-right">{diff > 0 ? "+" : diff < 0 ? "−" : ""}{money(Math.abs(diff))}</span>
        </div>
      )}
    </div>
  );
  // Divergente: etiqueta compacta SÓ em volta do valor (a célula não é pintada),
  // no mesmo vermelho do Atestado "Não solicitado".
  const Inner = clicavel ? "button" : "span";
  return (
    <td className={base}
      data-testid={testid} data-divergente="1" onClick={(ev) => ev.stopPropagation()}>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Inner type={clicavel ? "button" : undefined} onClick={onClick} data-testid={testid && `${testid}-alert`}
              style={ALERTA.badge}
              className={cn("-ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold", clicavel && "hover:brightness-95")}>
              <AlertCircle size={15} className="shrink-0" style={{ color: ALERTA_COR }} aria-label="Divergência" />
              {conteudo}
            </Inner>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </td>
  );
}

// ---------------- Pop-up 1: confirmar o empenho ao enviar para Adjudicado ----------------
// target = { bid } ; onConfirm(cents) executa o envio (status + empenho no mesmo PATCH).
export function EmpenhoAdjudicacaoDialog({ target, onCancel, onConfirm }) {
  const [valor, setValor] = useState("");
  const [venda, setVenda] = useState(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const bidId = target?.bid?.id;
  useEffect(() => {
    if (!bidId) return;
    let alive = true;
    setValor(""); setVenda(null); setErro("");
    // Sugestão = venda total das linhas selecionadas do orçamento (só para evitar digitação).
    api.get(`/bids/${bidId}/empenho-sugestao`)
      .then(({ data }) => {
        if (!alive) return;
        setVenda(data.venda_orcamento_cents || 0);
        if (data.venda_orcamento_cents > 0) setValor(centsToInput(data.venda_orcamento_cents));
      })
      .catch(() => alive && setVenda(0));
    return () => { alive = false; };
  }, [bidId]);
  if (!target) return null;
  const confirmar = async () => {
    const c = validCents(valor);
    if (!c) { setErro("Informe um valor maior que zero."); return; }
    setBusy(true);
    try { await onConfirm(c); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent data-testid="empenho-adjudicacao-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Confirmar valor do empenho</DialogTitle>
          <DialogDescription>Informe e confirme o valor do empenho desta licitação.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <MoneyField label="Valor do empenho" value={valor} onChange={(v) => { setValor(v); setErro(""); }}
            testid="empenho-adjudicacao-valor" autoFocus error={erro} />
          <p className="text-xs text-muted-foreground" data-testid="empenho-adjudicacao-referencia">
            Valor total de venda do orçamento: {venda == null ? "…" : money(venda)}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="empenho-adjudicacao-cancelar">Cancelar</Button>
          <Button onClick={confirmar} disabled={busy} data-testid="empenho-adjudicacao-confirmar" className="bg-brand text-white hover:bg-brand-hover">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Confirmar e enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Pop-up 2: confirmar ao avançar para "Empenho Recebido" ----------------
// target = { unit, nome } ; onSaved(result) segue com a timeline. canEdit = permissão de alterar valor.
export function EmpenhoRecebidoDialog({ target, canEdit, onCancel, onSave }) {
  const unit = target?.unit;
  const atual = empenhoCents(unit);
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    const semValor = atual == null;
    setEditando(semValor);
    const sugestao = semValor ? Number(target.unit?.venda_orcamento_cents || 0) : atual;
    setValor(sugestao > 0 ? centsToInput(sugestao) : "");
    setErro("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (!target) return null;
  const run = async (body) => {
    setBusy(true);
    try { await onSave(body); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const salvar = () => {
    const c = validCents(valor);
    if (!c) { setErro("Informe um valor maior que zero."); return; }
    run({ acao: "editar", valor: (c / 100).toFixed(2), origem: "empenho_recebido" });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent data-testid="empenho-recebido-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Confirmar valor do empenho recebido</DialogTitle>
          {target.nome && <DialogDescription>{target.nome}</DialogDescription>}
        </DialogHeader>
        {!editando ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Valor cadastrado anteriormente:</p>
              <p className="font-mono-num text-xl font-bold text-foreground" data-testid="empenho-recebido-atual">{money(atual)}</p>
            </div>
            <p className="text-sm text-foreground">O valor do empenho recebido está correto?</p>
          </div>
        ) : (
          <div className="space-y-2">
            {atual != null && <p className="text-xs text-muted-foreground">Valor cadastrado anteriormente: <span className="font-mono-num">{money(atual)}</span></p>}
            <MoneyField label="Novo valor do empenho" value={valor} onChange={(v) => { setValor(v); setErro(""); }}
              testid="empenho-recebido-valor" autoFocus error={erro} />
          </div>
        )}
        <DialogFooter className="gap-2">
          {!editando ? (
            <>
              {canEdit && <Button variant="outline" onClick={() => setEditando(true)} disabled={busy} data-testid="empenho-recebido-editar">Editar valor</Button>}
              <Button onClick={() => run({ acao: "confirmar", origem: "empenho_recebido" })} disabled={busy}
                data-testid="empenho-recebido-confirmar" className="bg-brand text-white hover:bg-brand-hover">
                {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Confirmar valor
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} data-testid="empenho-recebido-cancelar"
                onClick={() => (atual == null ? onCancel() : (setEditando(false), setValor(centsToInput(atual)), setErro("")))}>Cancelar</Button>
              <Button onClick={salvar} disabled={busy || !canEdit} data-testid="empenho-recebido-salvar" className="bg-brand text-white hover:bg-brand-hover">
                {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Salvar e confirmar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Alterar o empenho (clique na célula) ----------------
export function EmpenhoEditDialog({ target, onCancel, onSave }) {
  const unit = target?.unit;
  const atual = empenhoCents(unit);
  const venda = Number(unit?.venda_orcamento_cents || 0);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    setValor(atual != null ? centsToInput(atual) : venda > 0 ? centsToInput(venda) : "");
    setErro("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (!target) return null;
  const salvar = async () => {
    const c = validCents(valor);
    if (!c) { setErro("Informe um valor maior que zero."); return; }
    setBusy(true);
    try { await onSave({ acao: "editar", valor: (c / 100).toFixed(2), origem: "edicao" }); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent data-testid="empenho-edit-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Valor do empenho</DialogTitle>
          {target.nome && <DialogDescription>{target.nome}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <MoneyField label="Valor do empenho" value={valor} onChange={(v) => { setValor(v); setErro(""); }}
            testid="empenho-edit-valor" autoFocus error={erro} />
          <p className={cn("text-xs", unit?.empenho_divergente ? "text-red-700" : "text-muted-foreground")} data-testid="empenho-edit-referencia">
            Valor total de venda selecionado no orçamento: {money(venda)}
          </p>
          <p className="text-xs text-muted-foreground">Alterar o orçamento nunca muda este valor.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="empenho-edit-cancelar">Cancelar</Button>
          <Button onClick={salvar} disabled={busy} data-testid="empenho-edit-salvar" className="bg-brand text-white hover:bg-brand-hover">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Empenho alterado com lançamento vinculado no Financeiro ----------------
// prompt = { bidId, remessaId, antes, depois } ; nada é enviado sem o clique.
export function EmpenhoFinanceiroDialog({ prompt, onClose, onSent }) {
  const [busy, setBusy] = useState(false);
  if (!prompt) return null;
  const enviar = async () => {
    setBusy(true);
    try {
      await finApi.solicitarAtualizacao({ bid_id: prompt.bidId, remessa_id: prompt.remessaId || null });
      toast.success("Solicitação enviada ao Financeiro");
      await onSent?.();
      onClose();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="empenho-financeiro-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{prompt.titulo || "Valor do empenho alterado"}</DialogTitle>
          {prompt.nome && <DialogDescription>{prompt.nome}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div><p className="text-xs text-muted-foreground">{prompt.labelAntes || "Valor anterior"}:</p><p className="font-mono-num font-semibold" data-testid="empenho-fin-antes">{money(prompt.antes)}</p></div>
            <div><p className="text-xs text-muted-foreground">Novo valor:</p><p className="font-mono-num font-semibold" data-testid="empenho-fin-depois">{money(prompt.depois)}</p></div>
          </div>
          <p>Esta licitação já possui um lançamento vinculado no Financeiro.</p>
          <p className="font-medium">Deseja enviar uma solicitação para atualizar o valor no Financeiro?</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="empenho-fin-agora-nao">Agora não</Button>
          <Button onClick={enviar} disabled={busy} data-testid="empenho-fin-enviar" className="bg-[#0F6B5C] text-white hover:bg-[#0B564A]">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Enviar solicitação ao Financeiro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
