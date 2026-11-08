import { useRef, useState } from "react";
import { CreditCard, ImagePlus, Landmark, Loader2, Palette, Tag, Tags, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import api, { fileUrl } from "@/lib/api";
import { useFinance } from "@/context/FinanceContext";
import { BANDEIRAS, TIPOS_CONTA, apiError, apiErrorCode, centsToInput, finApi, money, parseMoney, todaySP } from "@/lib/financeiro";
import { BANK_PRESETS, BankLogo, FinIcon, ICONS, ICON_LABELS } from "./icons";
import { FinConfirm, FinModal } from "./FinModal";
import { Field, FinButton, FinInput, FinSelect, FinTextarea, Segmented } from "./ui";

const COLORS = ["#059669", "#0F766E", "#0284C7", "#2563EB", "#4F46E5", "#7C3AED", "#C026D3", "#DB2777", "#DC2626", "#EA580C", "#D97706", "#65A30D", "#64748B", "#334155"];

export function IconPicker({ value, onChange, testid = "fin-icon-picker" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid} className="flex h-10 w-full items-center gap-2 rounded-lg border px-3 text-sm"
          style={{ borderColor: "var(--fin-border)", color: "var(--fin-ink)", background: "var(--fin-surface)" }}>
          <FinIcon name={value} size={17} style={{ color: "var(--fin-primary)" }} />
          <span className="truncate">{ICON_LABELS[value] || "Escolher ícone"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="fin-scope w-[300px] p-2" style={{ background: "var(--fin-surface)" }} align="start">
        <div className="grid grid-cols-7 gap-1">
          {Object.keys(ICONS).map((name) => (
            <button key={name} type="button" title={ICON_LABELS[name]} data-testid={`${testid}-${name}`}
              onClick={() => { onChange(name); setOpen(false); }}
              className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-[var(--fin-primary-soft)]"
              style={value === name ? { background: "var(--fin-primary-soft)", color: "var(--fin-primary)" } : { color: "var(--fin-ink-2)" }}>
              <FinIcon name={name} size={17} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} className="h-7 w-7 rounded-full transition-transform hover:scale-110"
          style={{ background: c, boxShadow: value === c ? `0 0 0 2px var(--fin-surface), 0 0 0 4px ${c}` : "none" }} />
      ))}
      <label className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border" style={{ borderColor: "var(--fin-border)", color: "var(--fin-ink-3)" }} title="Outra cor">
        <Palette size={14} />
        <input type="color" value={value || "#64748B"} onChange={(e) => onChange(e.target.value)} className="sr-only" />
      </label>
    </div>
  );
}

// Imagem opcional (logo da conta / imagem do cartão) no R2 existente (/api/upload).
function ImageField({ value, onChange, aspect = "square", testid }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Envie uma imagem (PNG, JPG ou WebP)."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Imagem excede 10MB"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(data.id);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  const box = aspect === "card" ? "h-[86px] w-[136px]" : "h-16 w-16";
  return (
    <div className="flex items-center gap-3">
      <div className={`${box} flex shrink-0 items-center justify-center overflow-hidden rounded-xl border`} style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }}>
        {busy ? <Loader2 size={18} className="animate-spin" style={{ color: "var(--fin-ink-3)" }} />
          : value ? <img src={fileUrl(value)} alt="" className="h-full w-full object-contain" />
            : aspect === "card" ? <CreditCard size={26} style={{ color: "var(--fin-ink-3)" }} /> : <ImagePlus size={20} style={{ color: "var(--fin-ink-3)" }} />}
      </div>
      <div className="flex flex-wrap gap-2">
        <FinButton type="button" variant="outline" className="h-8 text-xs" onClick={() => ref.current?.click()} disabled={busy} data-testid={testid}>
          {value ? "Alterar imagem" : "Adicionar imagem"}
        </FinButton>
        {value && <FinButton type="button" variant="ghost" className="h-8 text-xs" onClick={() => onChange(null)}><Trash2 size={14} /> Remover</FinButton>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

function useSave(kind, item, onClose) {
  const { bump } = useFinance();
  const [saving, setSaving] = useState(false);
  const save = async (body) => {
    setSaving(true);
    try {
      if (item?.id) await finApi.editarCadastro(kind, item.id, body); else await finApi.criarCadastro(kind, body);
      toast.success(item?.id ? "Alterações salvas" : "Cadastro criado");
      bump();
      onClose();
    } catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return { saving, save };
}

function AtivoToggle({ value, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm" style={{ color: "var(--fin-ink)" }}>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} data-testid="fin-cad-ativo"
        className="relative h-6 w-11 rounded-full transition-colors" style={{ background: value ? "var(--fin-primary)" : "var(--fin-border)" }}>
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: value ? 22 : 2 }} />
      </button>
      <span><b>Ativo</b><span className="block text-xs" style={{ color: "var(--fin-ink-3)" }}>{label}</span></span>
    </label>
  );
}

const footer = (onClose, saving, onSave) => (<>
  <FinButton variant="outline" onClick={onClose} disabled={saving}>Cancelar</FinButton>
  <FinButton onClick={onSave} loading={saving} data-testid="fin-cad-save">Salvar</FinButton>
</>);

export function CategoryModal({ item, onClose }) {
  const [f, setF] = useState({ nome: item?.nome || "", tipo: item?.tipo || "despesa", icone: item?.icone || "Tag", cor: item?.cor || "#059669", ativo: item?.ativo ?? true });
  const [err, setErr] = useState("");
  const { saving, save } = useSave("categoria", item, onClose);
  const submit = () => { if (!f.nome.trim()) { setErr("Informe o nome."); return; } save(f); };
  return (
    <FinModal open onClose={onClose} busy={saving} size="sm" icon={Tag} title={item ? "Editar categoria" : "Nova categoria"} testid="fin-category-modal" footer={footer(onClose, saving, submit)}>
      <div className="space-y-4">
        <Field label="Nome" required error={err}><FinInput value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="fin-cad-nome" autoFocus /></Field>
        <Field label="Tipo" required>
          <Segmented value={f.tipo} onChange={(tipo) => setF({ ...f, tipo })} testid="fin-cad-tipo" options={[{ value: "receita", label: "Receita" }, { value: "despesa", label: "Despesa" }]} />
        </Field>
        <Field label="Ícone"><IconPicker value={f.icone} onChange={(icone) => setF({ ...f, icone })} /></Field>
        <Field label="Cor"><ColorPicker value={f.cor} onChange={(cor) => setF({ ...f, cor })} /></Field>
        <AtivoToggle value={f.ativo} onChange={(ativo) => setF({ ...f, ativo })} label="Disponível para novos lançamentos." />
      </div>
    </FinModal>
  );
}

export function PaymentMethodModal({ item, onClose }) {
  const [f, setF] = useState({ nome: item?.nome || "", icone: item?.icone || "Wallet", ativo: item?.ativo ?? true });
  const [err, setErr] = useState("");
  const { saving, save } = useSave("forma", item, onClose);
  const submit = () => { if (!f.nome.trim()) { setErr("Informe o nome."); return; } save(f); };
  return (
    <FinModal open onClose={onClose} busy={saving} size="sm" icon={Wallet} title={item ? "Editar forma de pagamento" : "Nova forma de pagamento"} testid="fin-method-modal" footer={footer(onClose, saving, submit)}>
      <div className="space-y-4">
        <Field label="Nome" required error={err}><FinInput value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Pix" data-testid="fin-cad-nome" autoFocus /></Field>
        <Field label="Ícone"><IconPicker value={f.icone} onChange={(icone) => setF({ ...f, icone })} /></Field>
        <AtivoToggle value={f.ativo} onChange={(ativo) => setF({ ...f, ativo })} label="Disponível para novos lançamentos." />
      </div>
    </FinModal>
  );
}

export function AccountModal({ item, onClose }) {
  const [f, setF] = useState({
    instituicao: item?.instituicao || "", nome: item?.nome || "", titular: item?.titular || "", tipo_conta: item?.tipo_conta || "corrente",
    agencia: item?.agencia || "", numero: item?.numero || "", logo_file_id: item?.logo_file_id || null, ativo: item?.ativo ?? true,
    observacao: item?.observacao || "", saldo: "", saldo_data: todaySP(),
  });
  const [err, setErr] = useState({});
  const { saving, save } = useSave("conta", item, onClose);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const submit = () => {
    const e = {};
    if (!f.nome.trim()) e.nome = "Informe um nome/apelido.";
    if (!item && f.saldo && parseMoney(f.saldo) == null) e.saldo = "Valor inválido.";
    setErr(e);
    if (Object.keys(e).length) return;
    const body = { ...f, logo_preset: f.instituicao || null };
    if (item) { delete body.saldo; delete body.saldo_data; } else body.saldo = f.saldo ? (parseMoney(f.saldo) / 100).toFixed(2) : "0";
    save(body);
  };
  return (
    <FinModal open onClose={onClose} busy={saving} size="lg" icon={Landmark} title={item ? "Editar conta" : "Nova conta"} testid="fin-account-modal" footer={footer(onClose, saving, submit)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Instituição financeira">
          <FinSelect value={f.instituicao} onChange={(e) => setF({ ...f, instituicao: e.target.value, nome: f.nome || BANK_PRESETS[e.target.value]?.nome || "" })} data-testid="fin-account-bank">
            <option value="">Outra / não listada</option>
            {Object.entries(BANK_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Nome / apelido da conta" required error={err.nome}><FinInput value={f.nome} onChange={set("nome")} placeholder="Ex.: Itaú PJ" data-testid="fin-cad-nome" /></Field>
        <Field label="Titular"><FinInput value={f.titular} onChange={set("titular")} /></Field>
        <Field label="Tipo de conta">
          <FinSelect value={f.tipo_conta} onChange={set("tipo_conta")}>{TIPOS_CONTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</FinSelect>
        </Field>
        <Field label="Agência"><FinInput value={f.agencia} onChange={set("agencia")} /></Field>
        <Field label="Conta"><FinInput value={f.numero} onChange={set("numero")} /></Field>
        {!item && (
          <>
            <Field label="Saldo atual" error={err.saldo} hint="Pode ser negativo. Ajuste quando quiser em Bancos.">
              <FinInput value={f.saldo} onChange={set("saldo")} inputMode="decimal" placeholder="0,00" data-testid="fin-account-saldo"
                onBlur={() => { const c = parseMoney(f.saldo); if (c != null) setF((p) => ({ ...p, saldo: centsToInput(c) })); }} />
            </Field>
            <Field label="Saldo em"><DatePickerInput value={f.saldo_data} onChange={set("saldo_data")} testid="fin-account-saldo-data" /></Field>
          </>
        )}
        <Field label="Logo / ícone" className="sm:col-span-2" hint="Opcional. Sem imagem, usamos a sigla da instituição.">
          <div className="flex items-center gap-4">
            <BankLogo item={{ ...f, logo_preset: f.instituicao }} size={44} />
            <ImageField value={f.logo_file_id} onChange={(id) => setF({ ...f, logo_file_id: id })} testid="fin-account-logo" />
          </div>
        </Field>
        <Field label="Observação" className="sm:col-span-2"><FinTextarea rows={2} value={f.observacao} onChange={set("observacao")} /></Field>
        <div className="sm:col-span-2"><AtivoToggle value={f.ativo} onChange={(ativo) => setF({ ...f, ativo })} label="Conta inativa sai das seleções e do caixa consolidado." /></div>
      </div>
    </FinModal>
  );
}

export function CardModal({ item, onClose }) {
  const { cad } = useFinance();
  const [f, setF] = useState({
    nome: item?.nome || "", instituicao: item?.instituicao || "", bandeira: item?.bandeira || "", final: item?.final || "",
    fechamento_dia: item?.fechamento_dia ?? "", vencimento_dia: item?.vencimento_dia ?? "", limite: item?.limite_cents != null ? centsToInput(item.limite_cents) : "",
    conta_id: item?.conta_id || "", imagem_file_id: item?.imagem_file_id || null, ativo: item?.ativo ?? true,
  });
  const [err, setErr] = useState({});
  const { saving, save } = useSave("cartao", item, onClose);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const submit = () => {
    const e = {};
    if (!f.nome.trim()) e.nome = "Informe um nome/apelido.";
    if (f.final && !/^\d{4}$/.test(f.final)) e.final = "Somente os 4 últimos dígitos.";
    for (const k of ["fechamento_dia", "vencimento_dia"]) if (f[k] !== "" && !(Number(f[k]) >= 1 && Number(f[k]) <= 31)) e[k] = "Dia entre 1 e 31.";
    if (f.limite && parseMoney(f.limite) == null) e.limite = "Valor inválido.";
    setErr(e);
    if (Object.keys(e).length) return;
    save({ ...f, logo_preset: f.instituicao || null, fechamento_dia: f.fechamento_dia === "" ? null : Number(f.fechamento_dia),
      vencimento_dia: f.vencimento_dia === "" ? null : Number(f.vencimento_dia), limite: f.limite ? (parseMoney(f.limite) / 100).toFixed(2) : null,
      conta_id: f.conta_id || null });
  };
  return (
    <FinModal open onClose={onClose} busy={saving} size="lg" icon={CreditCard} title={item ? "Editar cartão" : "Novo cartão"} testid="fin-card-modal" footer={footer(onClose, saving, submit)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome / apelido" required error={err.nome}><FinInput value={f.nome} onChange={set("nome")} placeholder="Ex.: Corporativo Itaú" data-testid="fin-cad-nome" /></Field>
        <Field label="Instituição">
          <FinSelect value={f.instituicao} onChange={set("instituicao")}>
            <option value="">Outra</option>
            {Object.entries(BANK_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Bandeira">
          <FinSelect value={f.bandeira} onChange={set("bandeira")}><option value="">—</option>{BANDEIRAS.map((b) => <option key={b}>{b}</option>)}</FinSelect>
        </Field>
        <Field label="Final (4 últimos dígitos)" error={err.final} hint="Nunca guardamos o número completo.">
          <FinInput value={f.final} onChange={(e) => setF({ ...f, final: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="1234" data-testid="fin-card-final" />
        </Field>
        <Field label="Dia de fechamento" error={err.fechamento_dia}><FinInput type="number" min={1} max={31} value={f.fechamento_dia} onChange={set("fechamento_dia")} /></Field>
        <Field label="Dia de vencimento" error={err.vencimento_dia}><FinInput type="number" min={1} max={31} value={f.vencimento_dia} onChange={set("vencimento_dia")} /></Field>
        <Field label="Limite" error={err.limite}><FinInput value={f.limite} onChange={set("limite")} inputMode="decimal" placeholder="0,00" /></Field>
        <Field label="Conta associada">
          <FinSelect value={f.conta_id} onChange={set("conta_id")}>
            <option value="">—</option>
            {cad.conta.filter((c) => c.ativo !== false || c.id === f.conta_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </FinSelect>
        </Field>
        <Field label="Imagem do cartão" className="sm:col-span-2" hint="Opcional — só para identificação visual.">
          <ImageField value={f.imagem_file_id} onChange={(id) => setF({ ...f, imagem_file_id: id })} aspect="card" testid="fin-card-image" />
        </Field>
        <div className="sm:col-span-2"><AtivoToggle value={f.ativo} onChange={(ativo) => setF({ ...f, ativo })} label="Disponível para novos lançamentos." /></div>
      </div>
    </FinModal>
  );
}

export function TagModal({ item, onClose }) {
  const [f, setF] = useState({ nome: item?.nome || "", cor: item?.cor || "#2563EB", ativo: item?.ativo ?? true });
  const [err, setErr] = useState("");
  const { saving, save } = useSave("tag", item, onClose);
  const submit = () => { if (!f.nome.trim()) { setErr("Informe o nome."); return; } save(f); };
  return (
    <FinModal open onClose={onClose} busy={saving} size="sm" icon={Tags} title={item ? "Editar tag" : "Nova tag"} testid="fin-tag-modal" footer={footer(onClose, saving, submit)}>
      <div className="space-y-4">
        <Field label="Nome" required error={err}><FinInput value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Urgente" data-testid="fin-cad-nome" autoFocus /></Field>
        <Field label="Cor"><ColorPicker value={f.cor} onChange={(cor) => setF({ ...f, cor })} /></Field>
        <AtivoToggle value={f.ativo} onChange={(ativo) => setF({ ...f, ativo })} label="Tag inativa sai das novas seleções; continua nos lançamentos antigos." />
      </div>
    </FinModal>
  );
}

export function SaldoModal({ conta, onClose }) {
  const { bump } = useFinance();
  const [saldo, setSaldo] = useState(centsToInput(conta.saldo_atual_cents));
  const [data, setData] = useState(todaySP());
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const c = parseMoney(saldo);
    if (c == null) { toast.error("Informe um valor válido."); return; }
    setSaving(true);
    try { await finApi.ajustarSaldo(conta.id, { saldo: (c / 100).toFixed(2), saldo_data: data }); toast.success("Saldo ajustado"); bump(); onClose(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <FinModal open onClose={onClose} busy={saving} size="sm" icon={Landmark} title={`Ajustar saldo — ${conta.nome}`} testid="fin-saldo-modal"
      description={`Saldo atual no sistema: ${money(conta.saldo_atual_cents)}. O valor informado passa a ser a base; baixas registradas depois dele movimentam a conta.`}
      footer={<><FinButton variant="outline" onClick={onClose} disabled={saving}>Cancelar</FinButton><FinButton onClick={submit} loading={saving} data-testid="fin-saldo-save">Salvar saldo</FinButton></>}>
      <div className="space-y-4">
        <Field label="Saldo real da conta"><FinInput value={saldo} onChange={(e) => setSaldo(e.target.value)} inputMode="decimal" data-testid="fin-saldo-valor" /></Field>
        <Field label="Saldo conferido em"><DatePickerInput value={data} onChange={setData} testid="fin-saldo-data" /></Field>
      </div>
    </FinModal>
  );
}

// Excluir cadastro: em uso -> oferece Inativar (integridade do histórico).
export function useCadastroDelete() {
  const { bump } = useFinance();
  const [target, setTarget] = useState(null);   // { kind, item, inUse? }
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (target.inUse) { await finApi.editarCadastro(target.kind, target.item.id, { ativo: false }); toast.success("Cadastro inativado"); setTarget(null); bump(); }
      else { await finApi.excluirCadastro(target.kind, target.item.id); toast.success("Cadastro excluído"); setTarget(null); bump(); }
    } catch (e) {
      if (apiErrorCode(e) === "in_use") setTarget({ ...target, inUse: e.response.data.detail.count });
      else toast.error(apiError(e));
    } finally { setBusy(false); }
  };
  const dialog = (
    <FinConfirm open={!!target} onClose={() => setTarget(null)} loading={busy} danger={!target?.inUse} testid="fin-cad-delete"
      title={target?.inUse ? "Cadastro em uso" : `Excluir "${target?.item?.nome}"?`}
      description={target?.inUse ? `"${target.item.nome}" está em uso por ${target.inUse} registro(s) e não pode ser excluído sem quebrar o histórico. Inative-o para tirá-lo das novas seleções.` : "Esta ação não pode ser desfeita."}
      confirmLabel={target?.inUse ? "Inativar" : "Excluir"} onConfirm={run} />
  );
  return { askDelete: (kind, item) => setTarget({ kind, item }), dialog };
}
