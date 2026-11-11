import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, MoreHorizontal, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fileUrl } from "@/lib/api";
import { activeOptions, useFinance } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";
import { apiError, apiErrorCode, centsToInput, finApi, fmtDate, money, parseMoney, relativeTime } from "@/lib/financeiro";
import { ContactModal } from "./CadastroModals";
import { ContactFieldLabel, ContactPicker } from "./ContactPicker";
import { FinConfirm, FinModal } from "./FinModal";
import { EmptyState, Field, FinButton, FinInput, FinSelect, FinTextarea, Money, TonePill } from "./ui";

// Solicitações da Execução & Pós-Venda aguardando o Financeiro. Ficam SEPARADAS
// dos recebíveis oficiais: só viram A Receber depois de "Aprovar".
export function useReceivableQueue() {
  const { version } = useFinance();
  const [items, setItems] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    Promise.all([finApi.solicitacoes("pendente"), finApi.atualizacoes()])
      .then(([s, a]) => { if (alive) { setItems(s); setUpdates(a); } })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [version]);
  return { items, updates, loading };
}

export function ReceivableQueue({ items, loading, limit, compact }) {
  const [approve, setApprove] = useState(null);
  const [reject, setReject] = useState(null);
  const { can } = useAuth();
  const podeAprovar = can("finance.receber.approve");
  const podeRejeitar = can("finance.receber.reject");
  const list = limit ? items.slice(0, limit) : items;
  if (!loading && !items.length) {
    return <EmptyState icon={CheckCircle2} title="Nenhuma solicitação pendente">Os recebíveis enviados pela Execução & Pós-Venda aparecem aqui para aprovação.</EmptyState>;
  }
  return (
    <>
      <ul className="divide-y" style={{ borderColor: "var(--fin-border)" }} data-testid="fin-queue">
        {list.map((r) => {
          const sn = r.snapshot || {};
          const mudou = r.valor_execucao_atual_cents != null && r.valor_execucao_atual_cents !== r.amount_cents;
          return (
            <li key={r.id} className="flex items-center gap-3 py-3" style={{ borderColor: "var(--fin-border)" }} data-testid={`fin-queue-item-${r.id}`}>
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex" style={{ background: "var(--fin-warning-soft)", color: "var(--fin-warning)" }}>
                <FileText size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: "var(--fin-ink)" }} title={r.label}>{sn.orgao || sn.objeto || r.label}</p>
                <p className="truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>
                  {[sn.pregao && `Pregão ${sn.pregao}`, sn.remessa_nome, `Execução · ${relativeTime(r.sent_at)}`].filter(Boolean).join(" · ")}
                </p>
                {mudou && !compact && <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--fin-warning)" }}>Valor na Execução agora: {money(r.valor_execucao_atual_cents)}</p>}
              </div>
              <Money cents={r.amount_cents} flow="in" strong className="shrink-0 text-sm" />
              {podeAprovar && <FinButton className="h-8 px-3 text-xs" onClick={() => setApprove(r)} data-testid={`fin-approve-${r.id}`}>Aprovar</FinButton>}
              {(podeAprovar || podeRejeitar) && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink-2)" }} data-testid={`fin-queue-menu-${r.id}`}><MoreHorizontal size={17} /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {podeAprovar && <DropdownMenuItem onClick={() => setApprove(r)}><CheckCircle2 size={15} className="mr-2" /> Revisar e aprovar</DropdownMenuItem>}
                  {podeRejeitar && <DropdownMenuItem onClick={() => setReject(r)} className="text-alert focus:text-alert" data-testid={`fin-reject-${r.id}`}><XCircle size={15} className="mr-2" /> Rejeitar</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>}
            </li>
          );
        })}
      </ul>
      {approve && <ApproveModal request={approve} onClose={() => setApprove(null)} />}
      {reject && <RejectModal request={reject} onClose={() => setReject(null)} />}
    </>
  );
}

function ApproveModal({ request: r, onClose }) {
  const { cad, bump } = useFinance();
  const sn = r.snapshot || {};
  const receita = activeOptions(cad.categoria, null, (c) => c.tipo === "receita");
  const [f, setF] = useState({
    due_date: "", amount: centsToInput(r.amount_cents),
    description: `Recebimento – ${[sn.pregao && `Pregão ${sn.pregao}`, sn.remessa_nome].filter(Boolean).join(" · ") || (sn.objeto || "").slice(0, 50)}`,
    category_id: receita[0]?.id || "", payment_method_id: "", bank_account_id: "", notes: "",
  });
  // Cliente cadastrado é OPCIONAL na aprovação (nunca bloqueia a integração):
  // sugerido só quando há UM cliente ativo com o nome idêntico ao órgão; sem
  // seleção, o recebível usa o nome do órgão da licitação, como antes.
  const [contact, setContact] = useState(null);
  const [contactText, setContactText] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [quick, setQuick] = useState(null);
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!sn.orgao) return;
    finApi.sugestaoContato(sn.orgao).then((c) => { if (c) { setContact(c); setContactText(c.name); setSuggested(true); } }).catch(() => {});
  }, [sn.orgao]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    const cents = parseMoney(f.amount);
    const e = {};
    if (!f.due_date) e.due_date = "Obrigatório: informe o vencimento/previsão.";
    if (!cents || cents <= 0) e.amount = "Informe um valor maior que zero.";
    if (contactText.trim() && !contact) e.contact = "Selecione um cliente cadastrado na lista — ou deixe vazio para usar o órgão da licitação.";
    setErr(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await finApi.aprovar(r.id, { ...f, amount: (cents / 100).toFixed(2), contact_id: contact?.id || null, category_id: f.category_id || null,
        payment_method_id: f.payment_method_id || null, bank_account_id: f.bank_account_id || null });
      toast.success("Recebível aprovado — já entra em A Receber e no fluxo");
      onClose();
      bump();
    } catch (x) { toast.error(apiError(x)); if (x.response?.status === 409) { onClose(); bump(); } } finally { setSaving(false); }
  };
  const info = (label, value) => value ? (
    <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }}>{label}</p><p className="truncate text-sm font-medium" style={{ color: "var(--fin-ink)" }} title={value}>{value}</p></div>
  ) : null;
  const files = (list) => list?.length ? list.map((d) => (
    <a key={d.id} href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium underline-offset-2 hover:underline" style={{ color: "var(--fin-primary)" }}>{d.filename}</a>
  )) : null;
  return (
    <FinModal open onClose={onClose} busy={saving} size="lg" icon={CheckCircle2} testid="fin-approve-modal"
      title="Aprovar recebível" description="Revise os dados enviados pela Execução. Só depois da aprovação ele vira um recebível oficial."
      footer={<>
        <FinButton variant="outline" onClick={onClose} disabled={saving}>Cancelar</FinButton>
        <FinButton onClick={submit} loading={saving} data-testid="fin-approve-confirm">Aprovar recebível</FinButton>
      </>}>
      <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-3" style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }}>
        {info("Órgão / cliente", sn.orgao)}
        {info("Pregão", sn.pregao)}
        {info("UASG", sn.uasg)}
        <div className="col-span-2 sm:col-span-3">{info("Objeto", sn.objeto)}</div>
        {info("Remessa", sn.remessa_nome)}
        {info("Valor solicitado", <Money cents={r.amount_cents} flow="in" />)}
        {info("Enviado por", `${r.sent_by_name || "—"} · ${relativeTime(r.sent_at)}`)}
        {sn.empenhos?.length > 0 && <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }}>Empenho</p>{files(sn.empenhos)}</div>}
        {sn.notas_fiscais?.length > 0 && <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }}>Nota fiscal</p>{files(sn.notas_fiscais)}</div>}
        {r.notes && <div className="col-span-2 sm:col-span-3">{info("Observação da Execução", r.notes)}</div>}
      </div>
      {r.valor_execucao_atual_cents != null && r.valor_execucao_atual_cents !== r.amount_cents && (
        <p className="mb-4 flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "var(--fin-warning-soft)", color: "var(--fin-warning)" }}>
          <AlertTriangle size={15} /> O valor na Execução mudou desde o envio: agora é {money(r.valor_execucao_atual_cents)}. Confira antes de aprovar.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vencimento / previsão de recebimento" required error={err.due_date}
          hint="Data financeira prevista. A data de entrega da Execução é logística e não é usada aqui.">
          <DatePickerInput value={f.due_date} onChange={set("due_date")} testid="fin-approve-due" invalid={!!err.due_date} />
        </Field>
        <Field label="Valor" required error={err.amount}>
          <FinInput value={f.amount} onChange={set("amount")} inputMode="decimal" data-testid="fin-approve-amount" invalid={!!err.amount} />
        </Field>
        <Field label="Descrição" className="sm:col-span-2"><FinInput value={f.description} onChange={set("description")} /></Field>
        <div className="min-w-0" data-testid="fin-approve-contact-field">
          <div className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--fin-ink-2)" }}>
            <ContactFieldLabel type="receber" onCreate={() => setQuick({ name: contact ? "" : contactText || sn.orgao || "" })} testid="fin-approve-contact-quick" />
          </div>
          <ContactPicker type="receber" value={contact} onSelect={(c) => { setContact(c); setSuggested(false); setErr((p) => ({ ...p, contact: undefined })); }}
            text={contactText} onText={setContactText} invalid={!!err.contact} testid="fin-approve-contact"
            onCreate={(t) => setQuick({ name: t || sn.orgao || "" })} />
          <span className="mt-1 block text-xs" style={{ color: err.contact ? "var(--fin-danger)" : "var(--fin-ink-3)" }}>
            {err.contact || (suggested ? "Sugerido: cliente com o mesmo nome do órgão. Confira antes de aprovar."
              : !contact ? `Opcional. Sem cliente cadastrado, o recebível usa o órgão${sn.orgao ? ` “${sn.orgao}”` : ""}.` : "")}
          </span>
        </div>
        <Field label="Categoria">
          <FinSelect value={f.category_id} onChange={set("category_id")}>
            <option value="">Sem categoria</option>
            {receita.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Forma de recebimento">
          <FinSelect value={f.payment_method_id} onChange={set("payment_method_id")}>
            <option value="">—</option>
            {activeOptions(cad.forma).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Conta de recebimento">
          <FinSelect value={f.bank_account_id} onChange={set("bank_account_id")}>
            <option value="">—</option>
            {activeOptions(cad.conta).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Observação" className="sm:col-span-2"><FinTextarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      {quick && (
        <ContactModal quick defaultRole="cliente" defaultName={quick.name} onClose={() => setQuick(null)}
          onSaved={(c) => { if (c.role !== "fornecedor") { setContact(c); setContactText(c.name); setSuggested(false); setErr((p) => ({ ...p, contact: undefined })); } }} />
      )}
    </FinModal>
  );
}

function RejectModal({ request: r, onClose }) {
  const { bump } = useFinance();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await finApi.rejeitar(r.id, { reason }); toast.success("Solicitação rejeitada — a Execução poderá corrigir e reenviar"); onClose(); bump(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <FinConfirm open onClose={onClose} loading={saving} danger title="Rejeitar solicitação" confirmLabel="Rejeitar" testid="fin-reject-modal"
      description={`${r.label} · ${money(r.amount_cents)}. A Execução verá a rejeição e o motivo.`} onConfirm={submit}>
      <Field label="Motivo" hint="Recomendado: ajuda a Execução a corrigir antes de reenviar.">
        <FinTextarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: NF com valor divergente do empenho" data-testid="fin-reject-reason" />
      </Field>
    </FinConfirm>
  );
}

// "Alteração recebida da Execução": valor mudou depois da aprovação. Nunca é
// aplicado sozinho — o Financeiro escolhe Ignorar ou Atualizar recebível.
export function ExecutionUpdates({ updates }) {
  const { bump } = useFinance();
  const { can } = useAuth();
  const [busy, setBusy] = useState(null);
  const [confirmSettled, setConfirmSettled] = useState(null);
  const decide = async (u, action, includeSettled = false) => {
    setBusy(u.request_id + action);
    try {
      await finApi.decidirAtualizacao(u.request_id, { action, valor_novo_cents: u.valor_novo_cents, include_settled: includeSettled });
      toast.success(action === "aplicar" ? "Recebível atualizado" : "Alteração ignorada");
      setConfirmSettled(null);
      bump();
    } catch (e) {
      if (apiErrorCode(e) === "settled") setConfirmSettled(u); else toast.error(apiError(e));
    } finally { setBusy(null); }
  };
  if (!updates.length) return null;
  const podeDecidir = can("finance.receber.approve");
  return (
    <div className="space-y-2" data-testid="fin-exec-updates">
      {updates.map((u) => (
        <div key={u.request_id} className="rounded-xl border p-3" style={{ borderColor: "var(--fin-warning)", background: "var(--fin-warning-soft)" }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--fin-warning)" }}><RefreshCcw size={15} /> Alteração recebida da Execução</p>
          <p className="mt-1 truncate text-xs" style={{ color: "var(--fin-ink-2)" }} title={u.description}>{u.description} · vence {fmtDate(u.due_date)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--fin-ink-2)" }}>
            <span>Valor anterior: <b className="font-mono-num">{money(u.valor_anterior_cents)}</b></span>
            <span>Novo valor: <Money cents={u.valor_novo_cents} flow="in" strong /></span>
            {u.entry_status === "recebido" && <TonePill tone="success">já recebido</TonePill>}
          </div>
          {podeDecidir && <div className="mt-2 flex gap-2">
            <FinButton variant="outline" className="h-8 text-xs" loading={busy === u.request_id + "ignorar"} onClick={() => decide(u, "ignorar")} data-testid={`fin-update-ignore-${u.request_id}`}>Ignorar</FinButton>
            <FinButton className="h-8 text-xs" loading={busy === u.request_id + "aplicar"} onClick={() => decide(u, "aplicar")} data-testid={`fin-update-apply-${u.request_id}`}>Atualizar recebível</FinButton>
          </div>}
        </div>
      ))}
      <FinConfirm open={!!confirmSettled} onClose={() => setConfirmSettled(null)} title="Recebível já recebido" confirmLabel="Atualizar mesmo assim" danger
        description="Este recebível já foi baixado. Alterar o valor muda um registro realizado (o histórico guarda o antes e o depois)."
        loading={!!busy} onConfirm={() => decide(confirmSettled, "aplicar", true)} />
    </div>
  );
}
