import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, LogOut, Menu, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fileUrl } from "@/lib/api";
import { STATUS, TONES, entryStatus, money } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { useFinance } from "@/context/FinanceContext";
import { FinIcon } from "./icons";

// Peças visuais do Financeiro. Cores só por variáveis --fin-* (index.css).

export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  const { openMobileNav } = useFinance();
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-6">
      <button onClick={openMobileNav} className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg border lg:hidden"
        style={{ borderColor: "var(--fin-border)", color: "var(--fin-ink-2)" }} data-testid="fin-mobile-nav" title="Menu">
        <Menu size={18} />
      </button>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:flex"
            style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}>
            <Icon size={22} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold leading-tight tracking-tight sm:text-2xl" style={{ color: "var(--fin-ink)" }}>{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm" style={{ color: "var(--fin-ink-3)" }}>{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <ModuleControls />
      </div>
    </header>
  );
}

// "Licitações" (volta ao módulo principal) + tema + usuário.
function ModuleControls() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const initials = (user?.name || "U").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <>
      <button data-testid="fin-back-licitacoes" onClick={() => navigate("/")}
        className="flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors hover:bg-[var(--fin-primary-soft)]"
        style={{ borderColor: "var(--fin-primary)", color: "var(--fin-primary)" }}>
        <ArrowLeft size={15} /> Licitações
      </button>
      <button onClick={toggleTheme} title="Alternar tema" data-testid="fin-theme-toggle"
        className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink-2)" }}>
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="outline-none" data-testid="fin-avatar">
            <Avatar className="h-9 w-9">
              {user?.avatar_url && <AvatarImage src={fileUrl(user.avatar_url)} alt={user?.name} />}
              <AvatarFallback className="text-sm font-semibold text-white" style={{ background: "var(--fin-primary)" }}>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col"><span className="font-medium">{user?.name}</span><span className="text-xs font-normal text-muted-foreground">{user?.email}</span></div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} className="text-alert focus:text-alert"><LogOut size={16} className="mr-2" /> Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function KpiCard({ icon: Icon, label, value, sub, tone = "info", highlight, testid, onClick }) {
  const t = TONES[tone] || TONES.info;
  const Comp = onClick ? "button" : "div";
  return (
    <Comp data-testid={testid} onClick={onClick}
      className={cn("fin-card flex min-w-0 items-center gap-3.5 p-4 text-left", onClick && "transition-shadow hover:shadow-md")}
      style={highlight ? { background: "linear-gradient(135deg, var(--fin-primary-soft), var(--fin-surface) 70%)" } : undefined}>
      {Icon && (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: t.bg, color: t.fg }}>
          <Icon size={20} />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium" style={{ color: "var(--fin-ink-2)" }}>{label}</p>
        <p className="font-mono-num truncate text-xl font-bold leading-snug tracking-tight sm:text-[22px]" style={{ color: "var(--fin-ink)" }}>{value}</p>
        {sub && <p className="truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>{sub}</p>}
      </div>
    </Comp>
  );
}

export function Panel({ icon: Icon, title, subtitle, actions, children, className, bodyClassName, testid }) {
  return (
    <section data-testid={testid} className={cn("fin-card min-w-0", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pb-3 pt-4">
          {Icon && <Icon size={20} className="mt-0.5 shrink-0" style={{ color: "var(--fin-primary)" }} />}
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-base font-semibold leading-tight" style={{ color: "var(--fin-ink)" }}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs" style={{ color: "var(--fin-ink-3)" }}>{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("px-5 pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function TonePill({ tone = "muted", children, className, title }) {
  const t = TONES[tone] || TONES.muted;
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}
      style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

export function StatusPill({ status, className }) {
  const s = STATUS[status] || STATUS.pendente;
  return <TonePill tone={s.tone} className={className}>{s.label}</TonePill>;
}

// Status de um lançamento: "Parcialmente pago/recebido" mantém a parcialidade
// visível e ganha um segundo selo "Atrasado" quando o saldo restante venceu.
export function EntryStatus({ entry, className }) {
  const s = entryStatus(entry);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <StatusPill status={s.main} />
      {s.atrasado && <TonePill tone="danger">Atrasado</TonePill>}
    </span>
  );
}

// Tags do lançamento: no máximo `max` visíveis + "+N" (todas no tooltip).
export function TagChips({ ids = [], names = [], max = 2, className }) {
  const { byId } = useFinance();
  if (!ids?.length) return null;
  const tags = ids.map((id, i) => ({ id, nome: byId[id]?.nome || names?.[i] || "Tag", cor: byId[id]?.cor || "#64748B" }));
  const all = tags.map((t) => t.nome).join(", ");
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)} title={all} data-testid="fin-tag-chips">
      {tags.slice(0, max).map((t) => (
        <span key={t.id} className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-full px-1.5 py-px text-[10.5px] font-medium"
          style={{ background: `${t.cor}1A`, color: t.cor }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.cor }} />
          <span className="truncate">{t.nome}</span>
        </span>
      ))}
      {tags.length > max && (
        <span className="rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: "var(--fin-muted-soft)", color: "var(--fin-ink-2)" }}>
          +{tags.length - max}
        </span>
      )}
    </span>
  );
}

// Valor com sinal/cor pelo tipo: receber verde, pagar neutro com "−".
export function Amount({ cents, type, className, strong }) {
  const isOut = type === "pagar";
  return (
    <span className={cn("font-mono-num whitespace-nowrap", strong && "font-semibold", className)}
      style={{ color: isOut ? "var(--fin-ink)" : "var(--fin-success)" }}>
      {isOut ? "−" : ""}{money(cents)}
    </span>
  );
}

export function CategoryChip({ id, name }) {
  const { byId } = useFinance();
  const c = id ? byId[id] : null;
  const label = c?.nome || name;
  if (!label) return <span style={{ color: "var(--fin-ink-3)" }}>—</span>;
  const cor = c?.cor || "#64748B";
  return (
    <span className="inline-flex max-w-[170px] items-center gap-1.5 truncate rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ background: `${cor}1A`, color: cor }} title={label}>
      <FinIcon name={c?.icone} size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function Field({ label, required, hint, error, children, className }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--fin-ink-2)" }}>
        {label}{required && <span style={{ color: "var(--fin-danger)" }}> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs" style={{ color: "var(--fin-danger)" }}>{error}</span>
        : hint ? <span className="mt-1 block text-xs" style={{ color: "var(--fin-ink-3)" }}>{hint}</span> : null}
    </label>
  );
}

const inputCls = "h-10 w-full rounded-lg border bg-[var(--fin-surface)] px-3 text-sm outline-none transition-colors focus:border-[var(--fin-primary)] focus:ring-2 focus:ring-[var(--fin-primary-soft)] disabled:opacity-60";
export function FinInput({ className, invalid, ...props }) {
  return <input className={cn(inputCls, className)} style={{ borderColor: invalid ? "var(--fin-danger)" : "var(--fin-border)", color: "var(--fin-ink)" }} {...props} />;
}
// Select nativo: acessível, funciona bem no celular e aceita valor vazio.
export function FinSelect({ className, invalid, children, ...props }) {
  return (
    <select className={cn(inputCls, "cursor-pointer pr-8", className)} style={{ borderColor: invalid ? "var(--fin-danger)" : "var(--fin-border)", color: "var(--fin-ink)" }} {...props}>
      {children}
    </select>
  );
}
export function FinTextarea({ className, ...props }) {
  return <textarea className={cn(inputCls, "h-auto min-h-[72px] py-2", className)} style={{ borderColor: "var(--fin-border)", color: "var(--fin-ink)" }} {...props} />;
}

export function FinButton({ variant = "primary", loading, children, className, disabled, ...props }) {
  const styles = {
    primary: { background: "var(--fin-primary)", color: "#fff", borderColor: "var(--fin-primary)" },
    outline: { background: "var(--fin-surface)", color: "var(--fin-ink)", borderColor: "var(--fin-border)" },
    danger: { background: "var(--fin-danger)", color: "#fff", borderColor: "var(--fin-danger)" },
    ghost: { background: "transparent", color: "var(--fin-ink-2)", borderColor: "transparent" },
    soft: { background: "var(--fin-primary-soft)", color: "var(--fin-primary)", borderColor: "transparent" },
  };
  return (
    <button disabled={disabled || loading} style={styles[variant]}
      className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold transition-[filter,background] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60", className)}
      {...props}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

// Abas compactas (pílulas) — usadas em Contas/Cartões, Tipo e Modo do lançamento.
export function Segmented({ value, onChange, options, testid, className, size = "md" }) {
  return (
    <div className={cn("inline-flex flex-wrap rounded-lg p-1", className)} style={{ background: "var(--fin-muted-soft)" }} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} data-testid={testid ? `${testid}-${o.value}` : undefined}
            onClick={() => onChange(o.value)} disabled={o.disabled}
            className={cn("rounded-md font-semibold transition-colors disabled:opacity-40", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm")}
            style={active ? { background: "var(--fin-surface)", color: "var(--fin-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : { color: "var(--fin-ink-2)" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {Icon && <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--fin-muted-soft)", color: "var(--fin-ink-3)" }}><Icon size={22} /></span>}
      <p className="text-sm font-semibold" style={{ color: "var(--fin-ink)" }}>{title}</p>
      {children && <p className="max-w-sm text-xs" style={{ color: "var(--fin-ink-3)" }}>{children}</p>}
      {action}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-xs" style={{ color: "var(--fin-ink-3)" }}>
      <span>Mostrando {from} a {to} de {total}</span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-1.5">Por página
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} data-testid="fin-page-size"
              className="h-8 rounded-md border bg-[var(--fin-surface)] px-1.5" style={{ borderColor: "var(--fin-border)", color: "var(--fin-ink)" }}>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <button className={btn} style={{ borderColor: "var(--fin-border)" }} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="fin-page-prev">‹</button>
        <span className="font-semibold" style={{ color: "var(--fin-ink)" }}>{page} / {pages}</span>
        <button className={btn} style={{ borderColor: "var(--fin-border)" }} disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="fin-page-next">›</button>
      </div>
    </div>
  );
}
