import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, ClipboardList, Truck, BarChart3, Settings, Pin, PinOff, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/", icon: Home, label: "Página inicial", testid: "nav-home", end: true },
  { to: "/licitacoes", icon: ClipboardList, label: "Todas as licitações", testid: "nav-bids" },
  { to: "/execucao", icon: Truck, label: "Execução / Pós-Venda", testid: "nav-execution" },
  { to: "/analises", icon: BarChart3, label: "Análises", testid: "nav-analytics" },
  { to: "/configuracoes", icon: Settings, label: "Configurações", testid: "nav-settings" },
];

export const Sidebar = () => {
  const [pinned, setPinned] = useState(() => localStorage.getItem("sidebar_pinned") === "1");
  const [hovered, setHovered] = useState(false);
  const navigate = useNavigate();
  const expanded = pinned || hovered;

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

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem("sidebar_pinned", next ? "1" : "0");
  };

  return (
    <aside
      data-testid="app-sidebar"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      className={cn(
        // Visual conforme Ref 1: fundo quase branco e borda vertical suave.
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-[#E5EEF7] bg-[#FAFCFE] transition-all duration-300 ease-in-out dark:border-border dark:bg-card",
        expanded ? "w-[210px]" : "w-16"
      )}
    >
      <button
        data-testid="sidebar-logo"
        onClick={() => navigate("/")}
        className="flex h-16 shrink-0 items-center gap-2.5 overflow-hidden border-b border-[#E5EEF7] px-3.5 dark:border-border"
      >
        <div
          data-testid="sidebar-expand-trigger"
          onMouseEnter={openFromTrigger}
          title="Expandir menu"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white"
        >
          <Gavel size={20} />
        </div>
        <span
          className={cn(
            "whitespace-nowrap font-heading text-lg font-bold tracking-tight text-foreground transition-opacity duration-200",
            expanded ? "opacity-100" : "opacity-0"
          )}
        >
          LicitaSys
        </span>
      </button>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-4">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={item.testid}
            className={({ isActive }) =>
              cn(
                // Recolhida: área interativa = quadrado do ícone (sem w-full), centralizado.
                // Expandida: linha inteira com texto (comportamento original preservado).
                "group relative flex items-center rounded-[7px] text-[13px] font-medium transition-colors duration-150",
                expanded ? "w-full gap-2.5 px-3 py-2" : "mx-auto h-10 w-10 justify-center",
                isActive
                  ? "bg-[#E8F2FF] text-[#1478F2] dark:bg-brand/20 dark:text-brand"
                  : "text-[#344B7A] hover:bg-[#EFF6FD] hover:text-[#0B2E66] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Indicador do item selecionado (Ref 1) */}
                {isActive && (
                  <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[#1E88FF]" />
                )}
                <span onMouseEnter={openFromTrigger} className="flex shrink-0 items-center justify-center">
                  <item.icon size={19} strokeWidth={isActive ? 2.3 : 1.9} />
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap transition-opacity duration-200",
                    expanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
                  )}
                >
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[#E5EEF7] p-2 dark:border-border">
        <button
          data-testid="sidebar-pin"
          onClick={togglePin}
          className={cn(
            // Mesma regra dos itens: recolhida = quadrado do ícone; expandida = linha inteira.
            "group flex items-center rounded-[7px] text-[13px] font-medium text-[#344B7A] transition-colors duration-150 hover:bg-[#EFF6FD] hover:text-[#0B2E66] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
            expanded ? "w-full gap-2.5 px-3 py-2" : "mx-auto h-10 w-10 justify-center"
          )}
        >
          <span onMouseEnter={openFromTrigger} className="flex shrink-0 items-center justify-center">
            {pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </span>
          <span
            className={cn(
              "whitespace-nowrap transition-opacity duration-200",
              expanded ? "opacity-100" : "w-0 overflow-hidden opacity-0"
            )}
          >
            {pinned ? "Desafixar menu" : "Fixar menu"}
          </span>
        </button>
      </div>
    </aside>
  );
};
