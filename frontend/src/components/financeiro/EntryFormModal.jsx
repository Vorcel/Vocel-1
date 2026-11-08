import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Info, PencilLine, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { useData } from "@/context/DataContext";
import { activeOptions, useFinance } from "@/context/FinanceContext";
import {
  FREQUENCIAS, MODOS, apiError, apiErrorCode, centsToInput, finApi, money, parseMoney, splitInstallments, todaySP,
} from "@/lib/financeiro";
import { FinModal } from "./FinModal";
import { TagPicker } from "./TagPicker";
import { Field, FinButton, FinInput, FinSelect, FinTextarea, Segmented } from "./ui";

const SCOPES = [
  { value: "one", label: "Somente este lançamento" },
  { value: "next", label: "Este e os próximos" },
  { value: "all", label: "Todos os lançamentos da sequência" },
];

const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function initialState(mode, entry, defaults) {
  const base = {
    type: "pagar", description: "", client_supplier: "", category_id: "", payment_method_id: "", bank_account_id: "",
    card_id: "", notes: "", bid_id: "", mode: "avista", amount: "", installments: "2", frequency: "mensal", due_date: todaySP(),
    tag_ids: [],
  };
  if (!entry) return { ...base, ...(defaults || {}) };
  // Editar: o próprio registro. Duplicar: só os dados reutilizáveis — nada de
  // status, datas de baixa, histórico ou identidade do original.
  return {
    ...base,
    type: entry.type,
    description: entry.description || "",
    client_supplier: entry.client_supplier || "",
    category_id: entry.category_id || "",
    payment_method_id: entry.payment_method_id || "",
    bank_account_id: entry.bank_account_id || "",
    card_id: entry.card_id || "",
    notes: entry.notes || "",
    bid_id: entry.bid_id || "",
    tag_ids: entry.tag_ids || [],
    mode: mode === "edit" ? entry.mode : "avista",
    amount: centsToInput(entry.amount_cents),
    due_date: entry.due_date || todaySP(),
  };
}

export function EntryFormModal({ mode, entry: entryProp, defaults, onClose, onSaved }) {
  const { cad } = useFinance();
  const { bids } = useData();
  const [entry, setEntry] = useState(entryProp);
  const [f, setF] = useState(() => initialState(mode, entryProp, defaults));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState("form");           // form | confirm (escopo / realizados)
  const [scope, setScope] = useState("one");
  const [includeSettled, setIncludeSettled] = useState(false);
  const token = useRef(uid());
  const isEdit = mode === "edit";
  const isSeq = isEdit && !!entry?.sequence_id;
  // Já tem baixa (total ou parcial): alterar exige confirmação explícita.
  const settledSelf = isEdit && (entry?.settled_cents || 0) > 0;

  // Editar: busca o registro completo (inclui quantos da série já foram baixados).
  useEffect(() => {
    if (isEdit && entryProp?.id) finApi.lancamento(entryProp.id).then(setEntry).catch(() => {});
  }, [isEdit, entryProp?.id]);

  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const cents = parseMoney(f.amount);
  const n = Math.max(0, parseInt(f.installments, 10) || 0);
  const preview = useMemo(() => {
    if (!cents || cents <= 0 || isEdit) return null;
    if (f.mode === "parcelado" && n >= 1) {
      const parts = splitInstallments(cents, n);
      const diff = parts[parts.length - 1] !== parts[0];
      return `${n}x de ${money(parts[0])}${diff ? ` (última ${money(parts[parts.length - 1])})` : ""} · total ${money(cents)}`;
    }
    if (f.mode === "recorrente" && n >= 1) {
      const fr = FREQUENCIAS.find((x) => x.value === f.frequency)?.label.toLowerCase();
      return `${n} lançamentos de ${money(cents)} (${fr}) · total projetado ${money(cents * n)}`;
    }
    return null;
  }, [cents, n, f.mode, f.frequency, isEdit]);

  const catOptions = activeOptions(cad.categoria, f.category_id, (c) => c.tipo === (f.type === "receber" ? "receita" : "despesa"));
  const bidOptions = useMemo(() => [...(bids || [])].sort((a, b) => (b.data_disputa || "").localeCompare(a.data_disputa || "")), [bids]);

  const validate = () => {
    const e = {};
    if (!f.description.trim()) e.description = "Informe a descrição.";
    if (!cents || cents <= 0) e.amount = "Informe um valor maior que zero.";
    else if (isEdit && cents < (entry?.settled_cents || 0)) e.amount = `Não pode ser menor que o já baixado (${money(entry.settled_cents)}).`;
    if (!f.due_date) e.due_date = "Informe a data.";
    if (!isEdit && f.mode !== "avista" && (n < 1 || n > 360)) e.installments = "Entre 1 e 360.";
    setErrors(e);
    return !Object.keys(e).length;
  };

  // Só os campos que mudaram (a edição de série aplica exatamente isso).
  const changedFields = () => {
    const orig = initialState("edit", entry);
    const out = {};
    for (const k of ["description", "client_supplier", "category_id", "payment_method_id", "bank_account_id", "card_id", "notes", "bid_id", "due_date"]) {
      if ((f[k] || "") !== (orig[k] || "")) out[k] = f[k] || null;
    }
    if (cents !== entry.amount_cents) out.amount = (cents / 100).toFixed(2);
    const a = [...(f.tag_ids || [])].sort().join();
    const b = [...(orig.tag_ids || [])].sort().join();
    if (a !== b) out.tag_ids = f.tag_ids;
    return out;
  };

  const submit = async () => {
    if (!validate()) return;
    if (isEdit) {
      const changes = changedFields();
      if (!Object.keys(changes).length) { toast.info("Nada foi alterado."); onClose(); return; }
      if ((isSeq || settledSelf) && step === "form") { setStep("confirm"); return; }
      setSaving(true);
      try {
        const r = await finApi.editar(entry.id, { ...changes, scope: isSeq ? scope : "one", include_settled: includeSettled || false, version: entry.version });
        toast.success(r.updated > 1 ? `${r.updated} lançamentos atualizados` : "Lançamento atualizado");
        if (r.skipped_settled) toast.info(`${r.skipped_settled} lançamento(s) já baixado(s) foram preservados.`);
        onSaved();
      } catch (e) {
        if (apiErrorCode(e) === "settled") { setStep("confirm"); toast.error(apiError(e)); }
        else toast.error(apiError(e));
      } finally { setSaving(false); }
      return;
    }
    setSaving(true);
    try {
      const body = {
        type: f.type, description: f.description.trim(), client_supplier: f.client_supplier || null,
        category_id: f.category_id || null, payment_method_id: f.payment_method_id || null,
        bank_account_id: f.bank_account_id || null, card_id: f.card_id || null, notes: f.notes || null,
        bid_id: f.bid_id || null, mode: f.mode, amount: (cents / 100).toFixed(2), due_date: f.due_date,
        installments: f.mode === "avista" ? null : n, frequency: f.mode === "recorrente" ? f.frequency : null,
        client_token: token.current, duplicated_from: mode === "duplicate" ? entry.id : null, tag_ids: f.tag_ids,
      };
      const r = await finApi.criar(body);
      toast.success(r.created > 1 ? `${r.created} lançamentos criados` : (mode === "duplicate" ? "Cópia criada" : "Lançamento criado"));
      onSaved();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setSaving(false); }
  };

  const title = isEdit ? "Editar lançamento" : mode === "duplicate" ? "Duplicar lançamento" : "Novo lançamento";
  const settledAfter = scope === "all" ? entry?.sequence_settled_all : scope === "next" ? entry?.sequence_settled_after : (settledSelf ? 1 : 0);
  const pessoa = f.type === "receber" ? "Cliente / Órgão" : "Fornecedor";

  return (
    <FinModal open onClose={onClose} busy={saving} title={title} size="lg" testid="fin-entry-modal"
      icon={isEdit ? PencilLine : mode === "duplicate" ? Copy : Plus}
      description={mode === "duplicate" ? "Revise os dados: a cópia será um lançamento novo e independente, em aberto." :
        isSeq ? `Lançamento ${entry.sequence_index}/${entry.sequence_total} de uma sequência ${MODOS[entry.mode]?.toLowerCase()}.` : undefined}
      footer={step === "confirm" ? (
        <>
          <FinButton variant="outline" onClick={() => setStep("form")} disabled={saving}>Voltar</FinButton>
          <FinButton onClick={submit} loading={saving} disabled={settledSelf && !includeSettled} data-testid="fin-entry-confirm-scope">Aplicar alteração</FinButton>
        </>
      ) : (
        <>
          <FinButton variant="outline" onClick={onClose} disabled={saving}>Cancelar</FinButton>
          <FinButton onClick={submit} loading={saving} data-testid="fin-entry-save">{isEdit ? "Salvar alterações" : "Salvar"}</FinButton>
        </>
      )}>
      {step === "confirm" ? (
        <div className="space-y-4" data-testid="fin-entry-scope">
          {isSeq && (
            <div>
              <p className="mb-2 text-sm font-semibold" style={{ color: "var(--fin-ink)" }}>Aplicar alteração em:</p>
              <div className="space-y-2">
                {SCOPES.map((s) => (
                  <label key={s.value} className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm"
                    style={{ borderColor: scope === s.value ? "var(--fin-primary)" : "var(--fin-border)", background: scope === s.value ? "var(--fin-primary-soft)" : "transparent" }}>
                    <input type="radio" name="scope" value={s.value} checked={scope === s.value} onChange={() => setScope(s.value)} data-testid={`fin-scope-${s.value}`} className="accent-[var(--fin-primary)]" />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {settledAfter > 0 && (
            <div className="rounded-lg p-3 text-sm" style={{ background: "var(--fin-warning-soft)", color: "var(--fin-warning)" }}>
              <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} />
                {settledSelf ? "Este lançamento já tem pagamento/recebimento registrado." : `${settledAfter} lançamento(s) neste escopo já têm baixa (total ou parcial).`}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--fin-ink-2)" }}>
                {settledSelf ? "Alterar um registro realizado muda o histórico financeiro. Confirme abaixo para continuar."
                  : "Por padrão eles são preservados e não mudam. Marque abaixo só se quiser alterá-los também."}
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--fin-ink)" }}>
                <input type="checkbox" checked={includeSettled} onChange={(e) => setIncludeSettled(e.target.checked)} data-testid="fin-include-settled" />
                {settledSelf ? "Confirmo a alteração de um lançamento já realizado" : "Alterar também os já pagos/recebidos"}
              </label>
            </div>
          )}
          {f.due_date !== entry?.due_date && isSeq && scope !== "one" && (
            <p className="flex items-start gap-2 text-xs" style={{ color: "var(--fin-ink-3)" }}>
              <Info size={14} className="mt-0.5 shrink-0" /> A mudança de vencimento desloca as demais ocorrências pelo mesmo número de dias.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tipo" className="sm:col-span-2">
            <Segmented testid="fin-entry-type" value={f.type} onChange={(v) => setF((p) => ({ ...p, type: v, category_id: "" }))}
              options={[{ value: "pagar", label: "A Pagar", disabled: isEdit }, { value: "receber", label: "A Receber", disabled: isEdit }]} />
          </Field>
          <Field label="Descrição" required error={errors.description} className="sm:col-span-2">
            <FinInput value={f.description} onChange={set("description")} invalid={!!errors.description} data-testid="fin-entry-description"
              placeholder={f.type === "receber" ? "Ex.: Recebimento – Pregão 90012/2026" : "Ex.: Fornecedor – Mercadoria do pregão"} />
          </Field>
          <Field label={pessoa}>
            <FinInput value={f.client_supplier} onChange={set("client_supplier")} data-testid="fin-entry-client" />
          </Field>
          <Field label="Categoria">
            <FinSelect value={f.category_id} onChange={set("category_id")} data-testid="fin-entry-category">
              <option value="">Sem categoria</option>
              {catOptions.map((c) => <option key={c.id} value={c.id}>{`${c.nome}${c.ativo === false ? " (inativa)" : ""}`}</option>)}
            </FinSelect>
          </Field>

          {!isEdit && (
            <Field label="Modo de lançamento" className="sm:col-span-2">
              <Segmented testid="fin-entry-mode" value={f.mode} onChange={set("mode")}
                options={Object.entries(MODOS).map(([value, label]) => ({ value, label }))} />
            </Field>
          )}
          <Field required error={errors.amount}
            hint={isEdit && entry?.settled_cents > 0 ? `Já baixado: ${money(entry.settled_cents)} · em aberto: ${money(entry.amount_cents - entry.settled_cents)}` : undefined}
            label={isEdit ? "Valor deste lançamento" : f.mode === "parcelado" ? "Valor total" : f.mode === "recorrente" ? "Valor por ocorrência" : "Valor"}>
            <FinInput value={f.amount} onChange={set("amount")} inputMode="decimal" placeholder="0,00" invalid={!!errors.amount}
              onBlur={() => cents != null && setF((p) => ({ ...p, amount: centsToInput(cents) }))} data-testid="fin-entry-amount" />
          </Field>
          <Field label={!isEdit && f.mode !== "avista" ? "Primeiro vencimento" : "Vencimento"} required error={errors.due_date}>
            <DatePickerInput value={f.due_date} onChange={set("due_date")} testid="fin-entry-due" invalid={!!errors.due_date} />
          </Field>
          {!isEdit && f.mode !== "avista" && (
            <Field label={f.mode === "parcelado" ? "Quantidade de parcelas" : "Quantidade de ocorrências"} required error={errors.installments}>
              <FinInput type="number" min={1} max={360} value={f.installments} onChange={set("installments")} data-testid="fin-entry-installments" />
            </Field>
          )}
          {!isEdit && f.mode === "recorrente" && (
            <Field label="Periodicidade">
              <FinSelect value={f.frequency} onChange={set("frequency")} data-testid="fin-entry-frequency">
                {FREQUENCIAS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </FinSelect>
            </Field>
          )}
          {!isEdit && f.mode === "parcelado" && <Field label="Periodicidade"><FinInput value="Mensal" disabled /></Field>}
          {preview && (
            <p className="rounded-lg px-3 py-2 text-xs font-medium sm:col-span-2" style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }} data-testid="fin-entry-preview">
              {preview}
            </p>
          )}

          <Field label="Forma de pagamento">
            <FinSelect value={f.payment_method_id} onChange={set("payment_method_id")} data-testid="fin-entry-method">
              <option value="">—</option>
              {activeOptions(cad.forma, f.payment_method_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </FinSelect>
          </Field>
          <Field label={f.type === "receber" ? "Conta de recebimento" : "Banco / conta"}>
            <FinSelect value={f.bank_account_id} onChange={set("bank_account_id")} data-testid="fin-entry-account">
              <option value="">—</option>
              {activeOptions(cad.conta, f.bank_account_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </FinSelect>
          </Field>
          {f.type === "pagar" && (
            <Field label="Cartão de crédito">
              <FinSelect value={f.card_id} onChange={set("card_id")} data-testid="fin-entry-card">
                <option value="">—</option>
                {activeOptions(cad.cartao, f.card_id).map((c) => <option key={c.id} value={c.id}>{`${c.nome}${c.final ? ` •••• ${c.final}` : ""}`}</option>)}
              </FinSelect>
            </Field>
          )}
          <Field label="Licitação vinculada (opcional)" className={f.type === "pagar" ? "" : "sm:col-span-2"}>
            <FinSelect value={f.bid_id} onChange={set("bid_id")} data-testid="fin-entry-bid">
              <option value="">Nenhuma</option>
              {bidOptions.map((b) => (
                <option key={b.id} value={b.id}>{[b.pregao && `Pregão ${b.pregao}`, b.orgao, (b.objeto || "").slice(0, 50)].filter(Boolean).join(" · ")}</option>
              ))}
            </FinSelect>
          </Field>
          <Field label="Tags" className="sm:col-span-2" hint="Marcadores livres (ex.: pregão, região, urgência). Diferente da categoria.">
            <TagPicker value={f.tag_ids} onChange={set("tag_ids")} allowCreate testid="fin-entry-tags" />
          </Field>
          <Field label="Observação" className="sm:col-span-2">
            <FinTextarea value={f.notes} onChange={set("notes")} rows={2} data-testid="fin-entry-notes" />
          </Field>
        </div>
      )}
    </FinModal>
  );
}
