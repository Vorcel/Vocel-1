import { useState } from "react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CreditCard, Eye, EyeOff, Landmark, MoreVertical, PencilLine, Plus, Power, Settings, SlidersHorizontal, Tag, Tags as TagsIcon, Trash2, Wallet,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fileUrl } from "@/lib/api";
import { useData } from "@/context/DataContext";
import { useFinance } from "@/context/FinanceContext";
import { TIPOS_CONTA, apiError, centsToInput, finApi, money, parseMoney } from "@/lib/financeiro";
import { BankLogo, FinIcon, institutionName } from "@/components/financeiro/icons";
import { AccountModal, CardModal, CategoryModal, PaymentMethodModal, SaldoModal, TagModal, useCadastroDelete } from "@/components/financeiro/CadastroModals";
import { EmptyState, Field, FinButton, FinInput, PageHeader, Segmented, TonePill } from "@/components/financeiro/ui";

const SECOES = [
  { key: "categorias", label: "Categorias", icon: Tag, desc: "Classificação de receitas e despesas." },
  { key: "tags", label: "Tags", icon: TagsIcon, desc: "Marcadores livres dos lançamentos." },
  { key: "contas", label: "Contas e cartões", icon: Landmark, desc: "Contas bancárias e cartões de crédito." },
  { key: "formas", label: "Formas de pagamento", icon: Wallet, desc: "Pix, boleto, transferência…" },
  { key: "preferencias", label: "Preferências", icon: SlidersHorizontal, desc: "Alertas do fluxo de caixa." },
];

export default function Configuracoes() {
  const { secao } = useParams();
  if (!secao) return <Navigate to="/financeiro/configuracoes/categorias" replace />;
  const atual = SECOES.find((s) => s.key === secao) || SECOES[0];
  return (
    <>
      <PageHeader icon={Settings} title="Configurações" subtitle="Cadastros auxiliares e preferências do Financeiro." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav className="fin-card flex gap-1 overflow-x-auto p-2 lg:flex-col lg:self-start" data-testid="fin-settings-menu">
          {SECOES.map((s) => (
            <NavLink key={s.key} to={`/financeiro/configuracoes/${s.key}`} data-testid={`fin-settings-${s.key}`}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
              style={({ isActive }) => isActive ? { background: "var(--fin-primary-soft)", color: "var(--fin-primary)" } : { color: "var(--fin-ink-2)" }}>
              <s.icon size={17} className="shrink-0" /> {s.label}
            </NavLink>
          ))}
        </nav>
        <section className="fin-card min-w-0 p-5 sm:p-6" data-testid={`fin-settings-section-${atual.key}`}>
          {atual.key === "categorias" && <Categorias />}
          {atual.key === "contas" && <ContasCartoes />}
          {atual.key === "formas" && <Formas />}
          {atual.key === "tags" && <TagsSection />}
          {atual.key === "preferencias" && <Preferencias />}
        </section>
      </div>
    </>
  );
}

function SectionHead({ title, subtitle, showInactive, setShowInactive, onAdd, addLabel, testid }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-lg font-semibold" style={{ color: "var(--fin-ink)" }}>{title}</h2>
        {subtitle && <p className="text-sm" style={{ color: "var(--fin-ink-3)" }}>{subtitle}</p>}
      </div>
      {setShowInactive && (
        <FinButton variant="ghost" onClick={() => setShowInactive(!showInactive)} data-testid="fin-show-inactive">
          {showInactive ? <EyeOff size={15} /> : <Eye size={15} />} {showInactive ? "Ocultar inativos" : "Mostrar inativos"}
        </FinButton>
      )}
      {onAdd && <FinButton onClick={onAdd} data-testid={testid}><Plus size={16} /> {addLabel}</FinButton>}
    </div>
  );
}

function RowMenu({ item, kind, onEdit, askDelete, extra }) {
  const { bump } = useFinance();
  const toggle = async () => {
    try { await finApi.editarCadastro(kind, item.id, { ativo: item.ativo === false }); toast.success(item.ativo === false ? "Reativado" : "Inativado"); bump(); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink-2)" }} data-testid={`fin-cad-menu-${item.id}`} title="Ações">
          <MoreVertical size={17} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit} data-testid={`fin-cad-edit-${item.id}`}><PencilLine size={15} className="mr-2" /> Editar</DropdownMenuItem>
        {extra}
        <DropdownMenuItem onClick={toggle}><Power size={15} className="mr-2" /> {item.ativo === false ? "Reativar" : "Inativar"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => askDelete(kind, item)} className="text-alert focus:text-alert" data-testid={`fin-cad-delete-${item.id}`}><Trash2 size={15} className="mr-2" /> Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const rowCls = "flex items-center gap-3 border-b py-3 last:border-0";
const Inactive = ({ item }) => item.ativo === false ? <TonePill tone="muted">Inativo</TonePill> : null;

function Categorias() {
  const { cad } = useFinance();
  const [showInactive, setShowInactive] = useState(false);
  const [tipo, setTipo] = useState("todas");
  const [modal, setModal] = useState(null);
  const { askDelete, dialog } = useCadastroDelete();
  const list = cad.categoria.filter((c) => (showInactive || c.ativo !== false) && (tipo === "todas" || c.tipo === tipo));
  return (
    <>
      <SectionHead title="Categorias" subtitle="Usadas para classificar lançamentos a pagar (despesas) e a receber (receitas)."
        showInactive={showInactive} setShowInactive={setShowInactive} onAdd={() => setModal({})} addLabel="Nova categoria" testid="fin-new-category" />
      <Segmented size="sm" value={tipo} onChange={setTipo} options={[{ value: "todas", label: "Todas" }, { value: "receita", label: "Receitas" }, { value: "despesa", label: "Despesas" }]} className="mb-2" />
      <ul data-testid="fin-category-list">
        {list.map((c) => (
          <li key={c.id} className={rowCls} style={{ borderColor: "var(--fin-border)", opacity: c.ativo === false ? 0.6 : 1 }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${c.cor}1F`, color: c.cor }}><FinIcon name={c.icone} size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" style={{ color: "var(--fin-ink)" }}>{c.nome}</p>
              <p className="text-xs" style={{ color: "var(--fin-ink-3)" }}>Tipo: {c.tipo === "receita" ? "Receita" : "Despesa"}</p>
            </div>
            <Inactive item={c} />
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.cor }} />
            <RowMenu item={c} kind="categoria" onEdit={() => setModal({ item: c })} askDelete={askDelete} />
          </li>
        ))}
      </ul>
      {!list.length && <EmptyState icon={Tag} title="Nenhuma categoria" />}
      {modal && <CategoryModal item={modal.item} onClose={() => setModal(null)} />}
      {dialog}
    </>
  );
}

function Formas() {
  const { cad } = useFinance();
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(null);
  const { askDelete, dialog } = useCadastroDelete();
  const list = cad.forma.filter((c) => showInactive || c.ativo !== false);
  return (
    <>
      <SectionHead title="Formas de pagamento" subtitle="Disponíveis nos lançamentos e nas baixas."
        showInactive={showInactive} setShowInactive={setShowInactive} onAdd={() => setModal({})} addLabel="Nova forma de pagamento" testid="fin-new-method" />
      <ul data-testid="fin-method-list">
        {list.map((c) => (
          <li key={c.id} className={rowCls} style={{ borderColor: "var(--fin-border)", opacity: c.ativo === false ? 0.6 : 1 }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}><FinIcon name={c.icone} size={18} /></span>
            <p className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--fin-ink)" }}>{c.nome}</p>
            <Inactive item={c} />
            <RowMenu item={c} kind="forma" onEdit={() => setModal({ item: c })} askDelete={askDelete} />
          </li>
        ))}
      </ul>
      {!list.length && <EmptyState icon={Wallet} title="Nenhuma forma de pagamento" />}
      {modal && <PaymentMethodModal item={modal.item} onClose={() => setModal(null)} />}
      {dialog}
    </>
  );
}

function TagsSection() {
  const { cad } = useFinance();
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(null);
  const { askDelete, dialog } = useCadastroDelete();
  const list = (cad.tag || []).filter((c) => showInactive || c.ativo !== false);
  return (
    <>
      <SectionHead title="Tags" subtitle="Marcadores livres (pregão, região, urgência…). Um lançamento pode ter várias; a categoria continua sendo a classificação principal."
        showInactive={showInactive} setShowInactive={setShowInactive} onAdd={() => setModal({})} addLabel="Nova tag" testid="fin-new-tag" />
      <ul data-testid="fin-tag-list">
        {list.map((c) => (
          <li key={c.id} className={rowCls} style={{ borderColor: "var(--fin-border)", opacity: c.ativo === false ? 0.6 : 1 }}>
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: c.cor || "#64748B" }} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" style={{ color: "var(--fin-ink)" }}>{c.nome}</p>
              <p className="text-xs" style={{ color: "var(--fin-ink-3)" }}>{c.ativo === false ? "Inativa" : "Ativa"}</p>
            </div>
            <Inactive item={c} />
            <RowMenu item={c} kind="tag" onEdit={() => setModal({ item: c })} askDelete={askDelete} />
          </li>
        ))}
      </ul>
      {!list.length && <EmptyState icon={TagsIcon} title="Nenhuma tag cadastrada">Crie tags aqui ou direto no formulário do lançamento.</EmptyState>}
      {modal && <TagModal item={modal.item} onClose={() => setModal(null)} />}
      {dialog}
    </>
  );
}

export function ContasCartoes() {
  const [aba, setAba] = useState("contas");
  return (
    <>
      <Segmented value={aba} onChange={setAba} testid="fin-accounts-tab" className="mb-5"
        options={[{ value: "contas", label: "Contas" }, { value: "cartoes", label: "Cartões de crédito" }]} />
      {aba === "contas" ? <ContasList /> : <CartoesList />}
    </>
  );
}

export function ContasList({ compact }) {
  const { cad } = useFinance();
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(null);
  const [saldo, setSaldo] = useState(null);
  const { askDelete, dialog } = useCadastroDelete();
  const list = cad.conta.filter((c) => showInactive || c.ativo !== false);
  return (
    <>
      <SectionHead title={compact ? "Minhas contas bancárias" : "Contas"} subtitle="Saldos alimentam a projeção do fluxo de caixa."
        showInactive={showInactive} setShowInactive={setShowInactive} onAdd={() => setModal({})} addLabel="Nova conta" testid="fin-new-account" />
      <ul data-testid="fin-account-list">
        {list.map((c) => (
          <li key={c.id} className={rowCls} style={{ borderColor: "var(--fin-border)", opacity: c.ativo === false ? 0.6 : 1 }} data-testid={`fin-account-${c.id}`}>
            <BankLogo item={c} size={42} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold" style={{ color: "var(--fin-ink)" }}>{c.nome}</p>
              <p className="truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>
                {[c.titular && `Titular: ${c.titular}`, TIPOS_CONTA.find((t) => t.value === c.tipo_conta)?.label, c.agencia && `Ag. ${c.agencia}`, c.numero && `Cc. ${c.numero}`, !c.titular && institutionName(c.instituicao)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Inactive item={c} />
            <div className="text-right">
              <p className="text-[11px]" style={{ color: "var(--fin-ink-3)" }}>Saldo atual</p>
              <p className="font-mono-num font-semibold" style={{ color: c.saldo_atual_cents < 0 ? "var(--fin-danger)" : "var(--fin-ink)" }}>{money(c.saldo_atual_cents)}</p>
            </div>
            <RowMenu item={c} kind="conta" onEdit={() => setModal({ item: c })} askDelete={askDelete}
              extra={<DropdownMenuItem onClick={() => setSaldo(c)} data-testid={`fin-account-adjust-${c.id}`}><Landmark size={15} className="mr-2" /> Ajustar saldo</DropdownMenuItem>} />
          </li>
        ))}
      </ul>
      {!list.length && <EmptyState icon={Landmark} title="Nenhuma conta cadastrada">Cadastre as contas da empresa para o fluxo de caixa partir do saldo real.</EmptyState>}
      {modal && <AccountModal item={modal.item} onClose={() => setModal(null)} />}
      {saldo && <SaldoModal conta={saldo} onClose={() => setSaldo(null)} />}
      {dialog}
    </>
  );
}

export function CartoesList({ compact }) {
  const { cad, byId } = useFinance();
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(null);
  const { askDelete, dialog } = useCadastroDelete();
  const list = cad.cartao.filter((c) => showInactive || c.ativo !== false);
  return (
    <>
      <SectionHead title={compact ? "Cartões de crédito" : "Cartões de crédito"} subtitle="Só os 4 últimos dígitos são guardados."
        showInactive={showInactive} setShowInactive={setShowInactive} onAdd={() => setModal({})} addLabel="Novo cartão" testid="fin-new-card" />
      <ul data-testid="fin-card-list">
        {list.map((c) => (
          <li key={c.id} className={rowCls} style={{ borderColor: "var(--fin-border)", opacity: c.ativo === false ? 0.6 : 1 }}>
            {c.imagem_file_id
              ? <img src={fileUrl(c.imagem_file_id)} alt="" className="h-[38px] w-[60px] shrink-0 rounded-md object-cover" />
              : <span className="flex h-[38px] w-[60px] shrink-0 items-center justify-center rounded-md" style={{ background: "var(--fin-muted-soft)", color: "var(--fin-ink-3)" }}><CreditCard size={20} /></span>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold" style={{ color: "var(--fin-ink)" }}>{c.nome}{c.final ? ` •••• ${c.final}` : ""}</p>
              <p className="truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>
                {[c.bandeira, institutionName(c.instituicao), c.fechamento_dia && `fecha dia ${c.fechamento_dia}`, c.vencimento_dia && `vence dia ${c.vencimento_dia}`, c.conta_id && byId[c.conta_id]?.nome && `conta ${byId[c.conta_id].nome}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Inactive item={c} />
            {c.limite_cents != null && <div className="hidden text-right sm:block"><p className="text-[11px]" style={{ color: "var(--fin-ink-3)" }}>Limite</p><p className="font-mono-num font-semibold" style={{ color: "var(--fin-ink)" }}>{money(c.limite_cents)}</p></div>}
            <RowMenu item={c} kind="cartao" onEdit={() => setModal({ item: c })} askDelete={askDelete} />
          </li>
        ))}
      </ul>
      {!list.length && <EmptyState icon={CreditCard} title="Nenhum cartão cadastrado" />}
      {modal && <CardModal item={modal.item} onClose={() => setModal(null)} />}
      {dialog}
    </>
  );
}

// Preferências do Financeiro: guardadas nas preferências do usuário já existentes
// (/api/preferences, campo `financeiro`), sem coleção nova.
function Preferencias() {
  const { prefs, savePrefs } = useData();
  const { bump } = useFinance();
  const atual = prefs?.financeiro || {};
  const [minimo, setMinimo] = useState(atual.caixa_minimo_cents ? centsToInput(atual.caixa_minimo_cents) : "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const c = minimo ? parseMoney(minimo) : 0;
    if (c == null || c < 0) { toast.error("Informe um valor válido."); return; }
    setSaving(true);
    try { await savePrefs({ financeiro: { ...atual, caixa_minimo_cents: c } }); toast.success("Preferências salvas"); bump(); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  return (
    <>
      <SectionHead title="Preferências" subtitle="Ajustes do Financeiro para a sua conta." />
      <div className="max-w-md space-y-4">
        <Field label="Caixa mínimo (alerta de saldo baixo)" hint="O fluxo de caixa sinaliza os períodos em que o saldo projetado ficar abaixo deste valor. Vazio = alerta só quando ficar negativo.">
          <FinInput value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="decimal" placeholder="0,00" data-testid="fin-pref-minimo" />
        </Field>
        <FinButton onClick={save} loading={saving} data-testid="fin-pref-save">Salvar preferências</FinButton>
      </div>
    </>
  );
}
