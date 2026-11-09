import { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePickerInput } from "@/components/DatePickerInput";
import { BankLogo } from "@/components/financeiro/icons";
import { ChipSelect } from "@/components/financeiro/ui";
import { apiError, centsToInput, finApi, fmtDate, money, parseMoney, todaySP } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

// Integração Execução -> Financeiro. A Execução NUNCA cria recebível: só envia
// uma solicitação; o Financeiro aprova (com vencimento) ou rejeita.
// Estados por unidade (licitação sem remessas ou cada remessa):
//   nao_enviado -> enviado (aguardando aprovação) -> aprovado -> [parcial] -> recebido
//   rejeitado / cancelado -> pode reenviar
// "parcial" = o Financeiro registrou recebimento parcial: a timeline CONTINUA em
// Aguardando Pagamento (sem etapa nova) até a quitação integral.
export const ESTADOS = {
  nao_enviado: { label: "Não enviado", cls: "text-slate-400 hover:bg-slate-100", pill: "bg-slate-100 text-slate-600" },
  enviado: { label: "Enviado para aprovação", cls: "text-amber-600 hover:bg-amber-50", pill: "bg-amber-50 text-amber-700" },
  aprovado: { label: "Aprovado no Financeiro", cls: "text-teal-700 hover:bg-teal-50", pill: "bg-teal-50 text-teal-700" },
  parcial: { label: "Parcialmente recebido", cls: "text-orange-600 hover:bg-orange-50", pill: "bg-orange-50 text-orange-700" },
  recebido: { label: "Recebido", cls: "text-emerald-600 hover:bg-emerald-50", pill: "bg-emerald-50 text-emerald-700" },
  rejeitado: { label: "Rejeitado pelo Financeiro", cls: "text-red-600 hover:bg-red-50", pill: "bg-red-50 text-red-700" },
  cancelado: { label: "Recebível cancelado", cls: "text-slate-500 hover:bg-slate-100", pill: "bg-slate-100 text-slate-600" },
};

export const unitKey = (bidId, remessaId) => `${bidId}:${remessaId || ""}`;

// Informação financeira resumida sob o status da linha (parcial / recebido).
export function FinNote({ link }) {
  if (!link || link.estado !== "parcial") return null;
  return (
    <span className="mt-1 block whitespace-nowrap text-[11px] font-medium text-orange-700" data-testid="exec-fin-parcial"
      title={`Valor total ${money(link.entry_amount_cents)} · recebido ${money(link.received_cents)} · saldo ${money(link.open_cents)}`}>
      Parcialmente recebido · {link.atrasado ? <span className="text-red-600">saldo em atraso {money(link.open_cents)}</span> : `saldo ${money(link.open_cents)}`}
    </span>
  );
}

export function useFinLinks() {
  const [links, setLinks] = useState({});
  const refresh = useCallback(async () => {
    try {
      const list = await finApi.vinculos();
      setLinks(Object.fromEntries(list.map((l) => [l.key, l])));
    } catch { /* módulo financeiro indisponível não pode quebrar a Execução */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { links, refresh };
}

export function RecebivelButton({ link, testid, onClick }) {
  const st = ESTADOS[link?.estado || "nao_enviado"];
  return (
    <button data-testid={testid} onClick={onClick} title={`Recebíveis: ${st.label}`}
      className={cn("relative flex h-8 w-8 items-center justify-center rounded-md", st.cls)}>
      <HandCoins size={16} />
      {link && link.estado !== "nao_enviado" && (
        <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
          { enviado: "bg-amber-500", aprovado: "bg-teal-600", parcial: "bg-orange-500", recebido: "bg-emerald-500", rejeitado: "bg-red-500", cancelado: "bg-slate-400" }[link.estado])} />
      )}
    </button>
  );
}

// target = { bidId, remessaId, nome, valorCents, link }
export function RecebivelModal({ target, onClose, onChanged }) {
  const link = target?.link;
  const estado = link?.estado || "nao_enviado";
  const podeEnviar = ["nao_enviado", "rejeitado", "cancelado"].includes(estado);
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setValor(centsToInput(target.valorCents || 0)); setObs(""); } }, [target]);
  if (!target) return null;
  const enviar = async () => {
    const c = parseMoney(valor);
    if (!c || c <= 0) { toast.error("Informe um valor maior que zero."); return; }
    setBusy(true);
    try {
      await finApi.enviarSolicitacao({ bid_id: target.bidId, remessa_id: target.remessaId || null, amount: (c / 100).toFixed(2), notes: obs || null });
      toast.success("Enviado ao Financeiro — aguardando aprovação");
      await onChanged();
      onClose();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  const retirar = async () => {
    setBusy(true);
    try { await finApi.retirarSolicitacao(link.request_id); toast.success("Solicitação retirada"); await onChanged(); onClose(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  const st = ESTADOS[estado];
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="exec-recebivel-modal" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading"><HandCoins size={18} className="text-teal-700" /> Enviar para Recebíveis</DialogTitle>
          <DialogDescription>{target.nome}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Situação:</span>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", st.pill)} data-testid="exec-recebivel-estado">{st.label}</span>
          </div>
          {estado === "enviado" && <p className="text-muted-foreground">Enviado em {fmtDate(link.sent_at?.slice(0, 10))} com {money(link.amount_cents)}. Ainda não é um recebível: o Financeiro precisa aprovar e definir o vencimento.</p>}
          {estado === "aprovado" && <p className="text-muted-foreground">Recebível de {money(link.entry_amount_cents)} com previsão para <b className="text-foreground">{fmtDate(link.due_date)}</b>. Ao marcar Pagamento Recebido na timeline, o Financeiro pode ser atualizado.</p>}
          {estado === "parcial" && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-900" data-testid="exec-recebivel-parcial">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-orange-700">Valor total</p><p className="font-semibold">{money(link.entry_amount_cents)}</p></div>
                <div><p className="text-orange-700">Recebido</p><p className="font-semibold">{money(link.received_cents)}</p></div>
                <div><p className="text-orange-700">Saldo a receber</p><p className={cn("font-semibold", link.atrasado && "text-red-600")}>{money(link.open_cents)}</p></div>
              </div>
              <p className="mt-2 text-xs">Previsão: {fmtDate(link.due_date)}{link.atrasado ? " — saldo em atraso" : ""}. A timeline continua em Aguardando Pagamento até a quitação.</p>
            </div>
          )}
          {estado === "recebido" && <p className="text-muted-foreground">Recebido em <b className="text-foreground">{fmtDate(link.settled_date)}</b> ({money(link.entry_amount_cents)}).</p>}
          {estado === "rejeitado" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <p className="font-semibold">O Financeiro rejeitou esta solicitação.</p>
              {link.rejection_reason && <p className="mt-0.5">Motivo: {link.rejection_reason}</p>}
              <p className="mt-1 text-xs text-red-700">Corrija o que for preciso e envie novamente.</p>
            </div>
          )}
          {podeEnviar && (
            <>
              <div>
                <Label className="mb-1 block">Valor a receber</Label>
                <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" data-testid="exec-recebivel-valor" />
                <p className="mt-1 text-xs text-muted-foreground">Sugerido: empenho {target.remessaId ? "da remessa" : "da licitação"} ({money(target.valorCents)}).</p>
              </div>
              <div>
                <Label className="mb-1 block">Observação para o Financeiro (opcional)</Label>
                <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">A data de entrega é logística e não é enviada como vencimento.</p>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
          {estado === "enviado" && <Button variant="outline" onClick={retirar} disabled={busy} data-testid="exec-recebivel-retirar">Retirar solicitação</Button>}
          {podeEnviar && (
            <Button onClick={enviar} disabled={busy} data-testid="exec-recebivel-enviar" className="bg-[#0F6B5C] hover:bg-[#0B564A]">
              {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}{estado === "nao_enviado" ? "Enviar para Recebíveis" : "Reenviar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Execução movida para Pagamento Recebido com recebível aprovado em aberto
// (inclusive parcial): pergunta se o Financeiro deve quitar o SALDO restante
// (data sugerida = hoje, editável). Nada é gravado sem confirmação.
// A conta de entrada é obrigatória (mesma regra da baixa no Financeiro) e não
// vem pré-selecionada.
export function BaixaRecebivelDialog({ prompt, onClose, onDone }) {
  const [date, setDate] = useState(todaySP());
  const [conta, setConta] = useState("");
  const [contaErr, setContaErr] = useState(false);
  const [contas, setContas] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!prompt) return;
    setDate(todaySP()); setConta(""); setContaErr(false);
    finApi.cadastros().then((d) => setContas((d.conta || []).filter((c) => c.ativo !== false))).catch(() => setContas([]));
  }, [prompt]);
  if (!prompt) return null;
  const confirmar = async () => {
    if (!date) { toast.error("Informe a data do recebimento."); return; }
    if (!conta) { setContaErr(true); toast.error("Selecione a conta em que o recebimento entrou."); return; }
    setBusy(true);
    try { await finApi.baixar(prompt.entry_id, { date, bank_account_id: conta }); toast.success("Recebível quitado no Financeiro"); await onDone(); onClose(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="exec-baixa-recebivel" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Atualizar o Financeiro?</DialogTitle>
          <DialogDescription>
            {prompt.nome} chegou em Pagamento Recebido.{" "}
            {prompt.estado === "parcial"
              ? `O recebível de ${money(prompt.entry_amount_cents)} já tem ${money(prompt.received_cents)} recebidos. Deseja registrar o saldo de ${money(prompt.open_cents)} e quitá-lo?`
              : `Deseja marcar o recebível de ${money(prompt.entry_amount_cents)} como Recebido?`}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="mb-1 block">Data do recebimento</Label>
          <DatePickerInput value={date} onChange={setDate} testid="exec-baixa-data" />
          <p className="mt-1 text-xs text-muted-foreground">Corrija se o dinheiro entrou em outra data.</p>
        </div>
        <div className="fin-scope" style={{ background: "transparent", color: "inherit" }} data-testid="exec-baixa-conta-field">
          <Label className="mb-1 block">Conta de entrada <span className="text-red-600">*</span></Label>
          <ChipSelect value={conta} onChange={(v) => { setConta(v); setContaErr(false); }} invalid={contaErr} testid="exec-baixa-conta" maxCollapsed={10}
            options={contas.map((c) => ({ value: c.id, label: c.nome, icon: <BankLogo item={c} size={18} /> }))}
            emptyText="Nenhuma conta bancária ativa no Financeiro." />
          <p className={cn("mt-1 text-xs", contaErr ? "text-red-600" : "text-muted-foreground")}>
            {contaErr ? "Selecione a conta em que o recebimento entrou." : "O saldo desta conta é movimentado no Financeiro."}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="exec-baixa-nao">Não</Button>
          <Button onClick={confirmar} disabled={busy} data-testid="exec-baixa-sim" className="bg-[#0F6B5C] hover:bg-[#0B564A]">
            {busy && <Loader2 size={15} className="mr-1.5 animate-spin" />}Sim, marcar como recebido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
