import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, ClipboardList, Truck, BarChart3, Settings, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { VorcelMark } from "@/components/layout/VorcelMark";
import { useAuth } from "@/context/AuthContext";

const ITEMS = [
  { to: "/", icon: Home, label: "Página inicial", testid: "nav-home", end: true, perms: ["licitacoes.view"] },
  { to: "/licitacoes", icon: ClipboardList, label: "Todas as licitações", testid: "nav-bids", perms: ["licitacoes.view"] },
  { to: "/execucao", icon: Truck, label: "Execução / Pós-Venda", testid: "nav-execution", perms: ["execution.view"] },
  { to: "/analises", icon: BarChart3, label: "Análises", testid: "nav-analytics", perms: ["analytics.view"] },
  { to: "/configuracoes", icon: Settings, label: "Configurações", testid: "nav-settings" },
];

// Visual de Licitações (Ref 1): fundo quase branco e borda vertical suave.
const LICITACOES_THEME = {
  aside: "border-r border-[#E5EEF7] bg-[#FAFCFE] dark:border-border dark:bg-card",
  divider: "border-[#E5EEF7] dark:border-border",
  logo: "ring-1 ring-black/5 dark:ring-white/10",
  title: "text-foreground",
  subtitle: "text-muted-foreground",
  active: "bg-[#E8F2FF] text-[#1478F2] dark:bg-brand/20 dark:text-brand",
  idle: "text-[#344B7A] hover:bg-[#EFF6FD] hover:text-[#0B2E66] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
  indicator: "bg-[#1E88FF]",
};

// Sidebar de TODO o Vorcel. O MECANISMO é um só (recolhida 64px, expande por
// hover nos ícones, fixar/desafixar persistido, item ativo com indicador) e cada
// módulo só troca itens, nome e cores via `theme` — o Financeiro usa a mesma
// peça com a identidade teal dele (FinancialLayout). O símbolo Vorcel é único.
export const Sidebar = ({ items = ITEMS, brand, theme = LICITACOES_THEME, testid = "app-sidebar", homeTo = "/" }) => {
  const { canAny } = useAuth();
  // Itens com `perms` só aparecem para quem tem alguma delas (UX — o backend valida tudo).
  const visible = items.filter((item) => !item.perms || canAny(item.perms));
  const [pinned, setPinned] = useState(() => localStorage.getItem("sidebar_pinned") === "1");
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();
  const expanded = pinned || hovered;
  const b = brand || { title: "Vorcel", subtitle: "Licitações" };

  // A expansão por hover é ativada SOMENTE pelos ícones (logo, itens do menu
  // e pin), nunca pela faixa lateral inteira nem pelos espaços vazios.
  // O fechamento tem um pequeno atraso para o cursor circular sem tremulação.
  const closeTimer = useRef(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openFromTrigger = () => { cancelClose(); setHovered(true); };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 250);
  };
  useEffect(() => cancelClose, []);

  // Preferência única do Vorcel: fixar em um módulo vale para o outro também.
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sidebar_pinned", next ? "1" : "0");
  };

  const label = (text) => (
    <span
      className={cn(
        "whitespace-nowrap transition-opacity duration-200",
        expanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
      )}
    >
      {text}
    </span>
  );

  return (
    <aside
      data-testid={testid}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col transition-all duration-300 ease-in-out",
        theme.aside,
        expanded ? "w-[210px]" : "w-16"
      )}
    >
      <button
        data-testid="sidebar-logo"
        onClick={() => navigate(homeTo)}
        className={cn("flex h-16 shrink-0 items-center gap-2.5 overflow-hidden border-b px-3.5", theme.divider)}
      >
        <div
          data-testid="sidebar-expand-trigger"
          onMouseEnter={openFromTrigger}
          title="Expandir menu"
          className={cn("h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg", theme.logo)}
        >
          <VorcelMark className="h-9 w-9" />
        </div>
        <span
          className={cn(
            "flex flex-col items-start whitespace-nowrap leading-tight transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0"
          )}
        >
          <span className={cn("font-heading text-lg font-bold tracking-tight", theme.title)}>{b.title}</span>
          {b.subtitle && <span className={cn("text-[11px] font-medium", theme.subtitle)}>{b.subtitle}</span>}
        </span>
      </button>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-4">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={item.testid}
            title={expanded ? undefined : item.label}
            className={({ isActive }) =>
              cn(
                // Recolhida: área interativa = quadrado do ícone (sem w-full), centralizado.
                // Expandida: linha inteira com texto (comportamento original preservado).
                "group relative flex items-center rounded-[7px] text-[13px] font-medium transition-colors duration-150",
                expanded ? "w-full gap-2.5 px-3 py-2" : "mx-auto h-10 w-10 justify-center",
                isActive ? theme.active : theme.idle
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Indicador do item selecionado (Ref 1) */}
                {isActive && (
                  <span aria-hidden className={cn("absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full", theme.indicator)} />
                )}
                <span onMouseEnter={openFromTrigger} className="relative flex shrink-0 items-center justify-center">
                  <item.icon size={19} strokeWidth={isActive ? 2.3 : 1.9} />
                  {/* Contador recolhido: um ponto sobre o ícone */}
                  {item.badge > 0 && !expanded && (
                    <span aria-hidden className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400" />
                  )}
                </span>
                {label(item.label)}
                {item.badge > 0 && expanded && (
                  <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950"
                    title={item.badgeTitle} data-testid={item.badgeTestid}>{item.badge}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn("border-t p-2", theme.divider)}>
        <button
          data-testid="sidebar-pin"
          onClick={togglePin}
          className={cn(
            // Mesma regra dos itens: recolhida = quadrado do ícone; expandida = linha inteira.
            "group flex items-center rounded-[7px] text-[13px] font-medium transition-colors duration-150",
            theme.idle,
            expanded ? "w-full gap-2.5 px-3 py-2" : "mx-auto h-10 w-10 justify-center"
          )}
        >
          <span onMouseEnter={openFromTrigger} className="flex shrink-0 items-center justify-center">
            {pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </span>
          {label(pinned ? "Desafixar menu" : "Fixar menu")}
        </button>
      </div>
    </aside>
  );
};
