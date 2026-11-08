import { useCallback, useEffect, useState } from "react";
import {
  Ban, CheckCircle2, Copy, Eye, History, MoreHorizontal, PencilLine, Receipt, RotateCcw, Trash2, Truck, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { activeOptions, useFinance } from "@/context/FinanceContext";
import {
  ACOES, MODOS, TIPOS, apiError, centsToInput, changeValue, finApi, fmtDate, fmtTimestamp, isOpenEntry, money, parseMoney, todaySP,
} from "@/lib/financeiro";
import { FinConfirm, FinModal } from "./FinModal";
import { Amount, CategoryChip, EntryStatus, Field, FinButton, FinInput, FinSelect, FinTextarea, TagChips, TonePill } from "./ui";

const hasSettlements = (e) => (e.settled_cents || 0) > 0;

// Ação principal visível (Pagar/Receber, só com saldo em aberto) + menu ⋮.
export function EntryRowActions({ entry: e }) {
  const { acaoLancamento, editarLancamento, duplicarLancamento } = useFinance();
  const open = isOpenEntry(e);
  const virgem = e.status === "pendente" && !hasSettlements(e);
  return (
    <div className="flex items-center justify-end gap-1">
      {open && (
        <button data-testid={`fin-settle-${e.id}`} onClick={() => acaoLancamento("settle", e)}
          className="rounded-md px-2 py-1 text-xs font-semibold transition-colors hover:brightness-95"
          style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}>
          {e.type === "pagar" ? "Pagar" : "Receber"}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid={`fin-menu-${e.id}`} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink-2)" }} title="Mais ações">
            <MoreHorizontal size={17} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => acaoLancamento("detail", e)} data-testid={`fin-view-${e.id}`}><Eye size={15} className="mr-2" /> Visualizar</DropdownMenuItem>
          {e.status !== "cancelado" && <DropdownMenuItem onClick={() => editarLancamento(e)} data-testid={`fin-edit-${e.id}`}><PencilLine size={15} className="mr-2" /> Editar</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => duplicarLancamento(e)} data-testid={`fin-duplicate-${e.id}`}><Copy size={15} className="mr-2" /> Duplicar lançamento</DropdownMenuItem>
          <DropdownMenuSeparator />
          {open && <DropdownMenuItem onClick={() => acaoLancamento("settle", e)}><CheckCircle2 size={15} className="mr-2" /> {e.type === "pagar" ? "Registrar pagamento" : "Registrar recebimento"}</DropdownMenuItem>}
          {hasSettlements(e) && <DropdownMenuItem onClick={() => acaoLancamento("settlements", e)} data-testid={`fin-settlements-${e.id}`}><Receipt size={15} className="mr-2" /> Baixas e estornos</DropdownMenuItem>}
          {e.status === "cancelado" && <DropdownMenuItem onClick={() => acaoLancamento("reopen", e)} data-testid={`fin-reopen-${e.id}`}><RotateCcw size={15} className="mr-2" /> Reativar</DropdownMenuItem>}
          {virgem && <DropdownMenuItem onClick={() => acaoLancamento("cancel", e)} data-testid={`fin-cancel-${e.id}`}><Ban size={15} className="mr-2" /> Cancelar</DropdownMenuItem>}
          {!hasSettlements(e) && <DropdownMenuItem onClick={() => acaoLancamento("delete", e)} className="text-alert focus:text-alert" data-testid={`fin-delete-${e.id}`}><Trash2 size={15} className="mr-2" /> Excluir</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function EntryActionModals({ action, onClose, onDone, onEdit, onDuplicate }) {
  const [syncEntry, setSyncEntry] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const kind = action?.kind;
  const e = action?.entry;
  const done = () => { onClose(); onDone(); };

  const syncExecution = async () => {
    setSyncing(true);
    try {
      await finApi.sincronizarExecucao(syncEntry.id);
      toast.success("Execução atualizada para Pagamento Recebido");
      setSyncEntry(null);
      onDone();
    } catch (err) { toast.error(apiError(err)); } finally { setSyncing(false); }
  };

  return (
    <>
      {kind === "settle" && <SettleModal entry={e} onClose={onClose}
        onSettled={(saved) => {
          done();
          // Só a QUITAÇÃO integral pode levar a Execução a Pagamento Recebido;
          // recebimento parcial mantém a timeline em Aguardando Pagamento.
          if (saved.type === "receber" && saved.request_id && saved.quitado) setSyncEntry(saved);
        }} />}
      {kind === "settlements" && <SettlementsModal entry={e} onClose={onClose} onChanged={onDone} />}
      {kind === "reopen" && <ReopenModal entry={e} onClose={onClose} onDone={done} />}
      {(kind === "cancel" || kind === "delete") && <RemoveModal kind={kind} entry={e} onClose={onClose} onDone={done} />}
      <EntryDetailSheet entry={kind === "detail" ? e : null} onClose={onClose} onEdit={onEdit} onDuplicate={onDuplicate} />
      <FinConfirm open={!!syncEntry} onClose={() => setSyncEntry(null)} loading={syncing} testid="fin-sync-execution"
        title="Recebimento concluído" confirmLabel="Confirmar" cancelLabel="Cancelar"
        description="Deseja atualizar a Execução & Pós-Venda para “Pagamento Recebido”?"
        onConfirm={syncExecution}>
        <p className="flex items-center gap-2 rounded-lg p-3 text-sm" style={{ background: "var(--fin-info-soft)", color: "var(--fin-info)" }}>
          <Truck size={16} /> A timeline da execução{syncEntry?.remessa_id ? " (remessa)" : ""} será concluída (100%). O Atestado não muda.
        </p>
      </FinConfirm>
    </>
  );
}

// Valores do lançamento: original, já baixado e saldo em aberto.
function Valores({ e, compact }) {
  const pagar = e.type === "pagar";
  const item = (label, v, strong) => (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }}>{label}</p>
      <p className={`font-mono-num ${compact ? "text-sm" : "text-base"} ${strong ? "font-bold" : "font-semibold"}`} style={{ color: "var(--fin-ink)" }}>{money(v)}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl border p-3" style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }} data-testid="fin-entry-values">
      {item("Valor original", e.amount_cents)}
      {item(pagar ? "Total pago" : "Total recebido", e.settled_cents || 0)}
      {item(pagar ? "Saldo a pagar" : "Saldo a receber", e.open_cents ?? (e.amount_cents - (e.settled_cents || 0)), true)}
    </div>
  );
}

function SettleModal({ entry: e, onClose, onSettled }) {
  const { cad } = useFinance();
  const aberto = e.open_cents ?? (e.amount_cents - (e.settled_cents || 0));
  const [valor, setValor] = useState(centsToInput(aberto));
  const [date, setDate] = useState(todaySP());
  const [conta, setConta] = useState(e.bank_account_id || "");
  const [forma, setForma] = useState(e.payment_method_id || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const pagar = e.type === "pagar";
  const cents = parseMoney(valor);
  const parcial = cents != null && cents > 0 && cents < aberto;
  const submit = async () => {
    if (!date) { toast.error("Informe a data."); return; }
    if (!cents || cents <= 0) { toast.error("Informe um valor maior que zero."); return; }
    if (cents > aberto) { toast.error(`O valor não pode passar do saldo em aberto (${money(aberto)}).`); return; }
    setSaving(true);
    try {
      const saved = await finApi.baixar(e.id, { amount: (cents / 100).toFixed(2), date, bank_account_id: conta || null, payment_method_id: forma || null, notes: notes || null });
      toast.success(saved.quitado ? (pagar ? "Pagamento registrado — conta quitada" : "Recebimento registrado — quitado")
        : `${pagar ? "Pagamento" : "Recebimento"} parcial registrado · restam ${money(saved.open_cents)}`);
      onSettled(saved);
    } catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };
  return (
    <FinModal open onClose={onClose} busy={saving} size="sm" icon={CheckCircle2} testid="fin-settle-modal"
      title={pagar ? "Registrar pagamento" : "Registrar recebimento"}
      description={`${e.description} · vence ${fmtDate(e.due_date)}`}
      footer={<>
        <FinButton variant="outline" onClick={onClose} disabled={saving}>Cancelar</FinButton>
        <FinButton onClick={submit} loading={saving} data-testid="fin-settle-confirm">
          {parcial ? (pagar ? "Registrar pagamento parcial" : "Registrar recebimento parcial") : (pagar ? "Confirmar pagamento" : "Confirmar recebimento")}
        </FinButton>
      </>}>
      <div className="space-y-4">
        <Valores e={e} compact />
        <Field label={pagar ? "Valor do pagamento" : "Valor recebido"} required
          hint={parcial ? `Baixa parcial: ficam ${money(aberto - cents)} em aberto.` : "Sugerido: saldo em aberto inteiro. Informe menos para uma baixa parcial."}>
          <FinInput value={valor} onChange={(x) => setValor(x.target.value)} inputMode="decimal" data-testid="fin-settle-amount"
            onBlur={() => cents != null && setValor(centsToInput(cents))} invalid={cents != null && cents > aberto} />
        </Field>
        <Field label={pagar ? "Data do pagamento" : "Data do recebimento"} required hint="Pode ser retroativa. O histórico registra também o momento real desta ação.">
          <DatePickerInput value={date} onChange={setDate} testid="fin-settle-date" />
        </Field>
        <Field label={pagar ? "Conta utilizada" : "Conta de entrada"} hint="A baixa movimenta o saldo desta conta.">
          <FinSelect value={conta} onChange={(x) => setConta(x.target.value)} data-testid="fin-settle-account">
            <option value="">Nenhuma (não altera saldo)</option>
            {activeOptions(cad.conta, conta).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label={pagar ? "Forma de pagamento" : "Forma de recebimento"}>
          <FinSelect value={forma} onChange={(x) => setForma(x.target.value)}>
            <option value="">—</option>
            {activeOptions(cad.forma, forma).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Observação"><FinTextarea rows={2} value={notes} onChange={(x) => setNotes(x.target.value)} /></Field>
      </div>
    </FinModal>
  );
}

// Lista das baixas do lançamento (cada pagamento/recebimento parcial) com
// estorno individual. Estorno não apaga: a baixa fica marcada e o log ganha evento.
function useSettlements(entryId) {
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    if (!entryId) return;
    finApi.baixas(entryId).then(setItems).catch(() => {});
  }, [entryId]);
  useEffect(() => { load(); }, [load]);
  return [items, load];
}

function SettlementsList({ items, onReverse }) {
  if (!items.length) return <p className="text-xs" style={{ color: "var(--fin-ink-3)" }}>Nenhuma baixa registrada.</p>;
  const ativo = items.filter((b) => !b.reversed).reduce((s, b) => s + b.amount_cents, 0);
  return (
    <div>
      <ul className="divide-y rounded-xl border" style={{ borderColor: "var(--fin-border)" }} data-testid="fin-settlements-list">
        {items.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm" style={{ borderColor: "var(--fin-border)", opacity: b.reversed ? 0.55 : 1 }}>
            <span className="font-mono-num w-[78px] shrink-0" style={{ color: "var(--fin-ink-2)" }}>{fmtDate(b.financial_date)}</span>
            <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>
              {[b.account_name, b.payment_method_name, b.created_by_name && `por ${b.created_by_name}`].filter(Boolean).join(" · ") || "—"}
              {b.reversed && <span className="block" style={{ color: "var(--fin-danger)" }}>Estornada{b.reversal_reason ? `: ${b.reversal_reason}` : ""}</span>}
            </span>
            <span className={`font-mono-num font-semibold ${b.reversed ? "line-through" : ""}`} style={{ color: "var(--fin-ink)" }}>{money(b.amount_cents)}</span>
            {onReverse && !b.reversed && (
              <button onClick={() => onReverse(b)} title="Estornar esta baixa" data-testid={`fin-reverse-${b.id}`}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--fin-danger-soft)]" style={{ color: "var(--fin-danger)" }}>
                <Undo2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-right text-xs" style={{ color: "var(--fin-ink-3)" }}>Total baixado: <b style={{ color: "var(--fin-ink)" }}>{money(ativo)}</b></p>
    </div>
  );
}

function SettlementsModal({ entry, onClose, onChanged }) {
  const [e, setE] = useState(entry);
  const [items, reload] = useSettlements(entry.id);
  const [alvo, setAlvo] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const estornar = async () => {
    setBusy(true);
    try {
      await finApi.estornarBaixa(e.id, alvo.id, { reason });
      toast.success("Baixa estornada");
      setAlvo(null); setReason("");
      reload();
      setE(await finApi.lancamento(e.id));
      onChanged();
    } catch (err) { toast.error(apiError(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <FinModal open={!alvo} onClose={onClose} size="md" icon={Receipt} testid="fin-settlements-modal"
        title="Baixas e estornos" description={e.description}
        footer={<FinButton variant="outline" onClick={onClose}>Fechar</FinButton>}>
        <div className="space-y-4">
          <Valores e={e} />
          <SettlementsList items={items} onReverse={setAlvo} />
        </div>
      </FinModal>
      <FinConfirm open={!!alvo} onClose={() => setAlvo(null)} loading={busy} danger testid="fin-reverse-confirm"
        title={e.type === "pagar" ? "Estornar pagamento" : "Estornar recebimento"} confirmLabel="Estornar"
        description={alvo ? `Baixa de ${money(alvo.amount_cents)} em ${fmtDate(alvo.financial_date)}. O valor volta para o saldo em aberto; o registro original continua no histórico.` : ""}
        onConfirm={estornar}>
        <Field label="Motivo (opcional)"><FinTextarea rows={2} value={reason} onChange={(x) => setReason(x.target.value)} data-testid="fin-reverse-reason" /></Field>
      </FinConfirm>
    </>
  );
}

function ReopenModal({ entry: e, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await finApi.reabrir(e.id, { reason }); toast.success("Lançamento reativado"); onDone(); }
    catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };
  return (
    <FinConfirm open onClose={onClose} loading={saving} title="Reativar lançamento" confirmLabel="Reativar" onConfirm={submit} testid="fin-reopen-modal"
      description="O lançamento volta a ficar em aberto e entra novamente nas previsões.">
      <Field label="Motivo (opcional)"><FinTextarea rows={2} value={reason} onChange={(x) => setReason(x.target.value)} data-testid="fin-reopen-reason" /></Field>
    </FinConfirm>
  );
}

function RemoveModal({ kind, entry: e, onClose, onDone }) {
  const [scope, setScope] = useState("one");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const seq = !!e.sequence_id;
  const del = kind === "delete";
  const submit = async () => {
    setSaving(true);
    try {
      const r = del ? await finApi.excluir(e.id, scope) : await finApi.cancelar(e.id, { scope, reason });
      const n = del ? r.deleted : r.cancelled;
      toast.success(`${n} lançamento(s) ${del ? "excluído(s)" : "cancelado(s)"}`);
      if (r.preserved) toast.info(`${r.preserved} com pagamento/recebimento foram preservados.`);
      onDone();
    } catch (err) { toast.error(apiError(err)); } finally { setSaving(false); }
  };
  return (
    <FinConfirm open onClose={onClose} loading={saving} danger testid={`fin-${kind}-modal`}
      title={del ? "Excluir lançamento" : "Cancelar lançamento"} confirmLabel={del ? "Excluir" : "Cancelar lançamento"} cancelLabel="Voltar"
      description={del ? "Lançamentos com pagamento/recebimento (total ou parcial) nunca são excluídos. O histórico guarda o que foi removido."
        : "O lançamento continua registrado como Cancelado e sai das previsões."}
      onConfirm={submit}>
      <div className="space-y-3">
        {seq && (
          <div className="space-y-2">
            <p className="text-sm font-semibold" style={{ color: "var(--fin-ink)" }}>{del ? "Excluir:" : "Cancelar:"}</p>
            {[["one", "Somente este lançamento"], ["next", "Este e os próximos"], ["all", "Toda a sequência"]].map(([v, l]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--fin-ink-2)" }}>
                <input type="radio" checked={scope === v} onChange={() => setScope(v)} data-testid={`fin-remove-scope-${v}`} /> {l}
              </label>
            ))}
          </div>
        )}
        {!del && <Field label="Motivo (opcional)"><FinTextarea rows={2} value={reason} onChange={(x) => setReason(x.target.value)} /></Field>}
      </div>
    </FinConfirm>
  );
}

function EntryDetailSheet({ entry, onClose, onEdit, onDuplicate }) {
  const { byId } = useFinance();
  const [full, setFull] = useState(null);
  const [hist, setHist] = useState([]);
  const [baixas] = useSettlements(entry?.id);
  useEffect(() => {
    if (!entry) { setFull(null); setHist([]); return; }
    finApi.lancamento(entry.id).then(setFull).catch(() => setFull(entry));
    finApi.historico({ entity_id: entry.id, page_size: 30 }).then((r) => setHist(r.items)).catch(() => {});
  }, [entry]);
  const e = full || entry;
  const name = (id, snap) => (id && byId[id]?.nome) || snap || "—";
  const row = (label, value) => (
    <div className="flex justify-between gap-4 border-b py-2 text-sm" style={{ borderColor: "var(--fin-border)" }}>
      <span style={{ color: "var(--fin-ink-3)" }}>{label}</span>
      <span className="text-right font-medium" style={{ color: "var(--fin-ink)" }}>{value}</span>
    </div>
  );
  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="fin-scope w-full overflow-y-auto sm:max-w-md" style={{ background: "var(--fin-surface)" }} data-testid="fin-entry-detail">
        {e && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="font-heading text-lg" style={{ color: "var(--fin-ink)" }}>{e.description}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <TonePill tone={e.type === "pagar" ? "warning" : "success"}>{TIPOS[e.type]}</TonePill>
                <EntryStatus entry={e} />
                {e.sequence_id && <TonePill tone="muted">{MODOS[e.mode]} {e.sequence_index}/{e.sequence_total}</TonePill>}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <p className="mb-3 text-2xl font-bold"><Amount cents={e.amount_cents} type={e.type} /></p>
              {hasSettlements(e) && <Valores e={e} compact />}
              <div className="mt-3">
                {row("Vencimento / previsão", fmtDate(e.due_date))}
                {e.settled_date && row(e.type === "pagar" ? "Quitado em" : "Recebido integralmente em", fmtDate(e.settled_date))}
                {row(e.type === "pagar" ? "Fornecedor" : "Cliente / Órgão", e.client_supplier || "—")}
                {row("Categoria", <CategoryChip id={e.category_id} name={e.category_name} />)}
                {e.tag_ids?.length > 0 && row("Tags", <TagChips ids={e.tag_ids} names={e.tag_names} max={10} className="justify-end" />)}
                {row("Forma de pagamento", name(e.payment_method_id, e.payment_method_name))}
                {row("Banco / conta", name(e.bank_account_id, e.account_name))}
                {e.card_id && row("Cartão", name(e.card_id, e.card_name))}
                {e.bid_label && row("Licitação", e.bid_label)}
                {e.request_id && row("Origem", "Execução & Pós-Venda")}
                {e.cancel_reason && row("Motivo do cancelamento", e.cancel_reason)}
                {e.notes && row("Observação", e.notes)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {e.status !== "cancelado" && <FinButton variant="outline" onClick={() => onEdit(e)}><PencilLine size={15} /> Editar</FinButton>}
                <FinButton variant="outline" onClick={() => onDuplicate(e)}><Copy size={15} /> Duplicar</FinButton>
              </div>
              {baixas.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--fin-ink)" }}><Receipt size={15} /> Baixas</h3>
                  <SettlementsList items={baixas} />
                </>
              )}
              <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--fin-ink)" }}><History size={15} /> Histórico deste lançamento</h3>
              <ol className="space-y-3">
                {hist.map((h) => {
                  const t = fmtTimestamp(h.ts);
                  return (
                    <li key={h.id} className="rounded-lg border p-2.5 text-xs" style={{ borderColor: "var(--fin-border)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <TonePill tone={ACOES[h.action]?.tone}>{ACOES[h.action]?.label || h.action}</TonePill>
                        <span style={{ color: "var(--fin-ink-3)" }}>{t.date} {t.time}</span>
                      </div>
                      <p className="mt-1" style={{ color: "var(--fin-ink-2)" }}>
                        por {h.user_name || "—"}{h.amount_cents != null && /baixad|parcial|estornad|reaberto/.test(h.action) ? ` · ${money(h.amount_cents)}` : ""}{h.financial_date ? ` · data financeira ${fmtDate(h.financial_date)}` : ""}
                      </p>
                      {h.changes?.map((c) => (
                        <p key={c.field} className="mt-0.5" style={{ color: "var(--fin-ink-2)" }}>{c.label}: {changeValue(c.field, c.before)} → <b>{changeValue(c.field, c.after)}</b></p>
                      ))}
                    </li>
                  );
                })}
                {!hist.length && <li className="text-xs" style={{ color: "var(--fin-ink-3)" }}>Sem eventos.</li>}
              </ol>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
