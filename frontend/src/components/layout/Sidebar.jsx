import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, ClipboardList, Truck, Settings, Pin, PinOff, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/", icon: Home, label: "Página inicial", testid: "nav-home", end: true },
  { to: "/licitacoes", icon: ClipboardList, label: "Todas as licitações", testid: "nav-bids" },
  { to: "/execucao", icon: Truck, label: "Execução / Pós-Venda", testid: "nav-execution" },
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
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-[#E9ECEF] transition-all duration-300 ease-in-out dark:bg-card",
        expanded ? "w-64" : "w-16"
      )}
    >
      <button
        data-testid="sidebar-logo"
        onClick={() => navigate("/")}
        className="flex h-16 items-center gap-3 overflow-hidden border-b border-border px-4 shrink-0"
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
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand text-white"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <span onMouseEnter={openFromTrigger} className="flex shrink-0 items-center justify-center">
              <item.icon size={22} />
            </span>
            <span
              className={cn(
                "whitespace-nowrap transition-opacity duration-200",
                expanded ? "opacity-100" : "opacity-0"
              )}
            >
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-2">
        <button
          data-testid="sidebar-pin"
          onClick={togglePin}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white hover:text-foreground dark:hover:bg-accent"
        >
          <span onMouseEnter={openFromTrigger} className="flex shrink-0 items-center justify-center">
            {pinned ? <PinOff size={20} /> : <Pin size={20} />}
          </span>
          <span
            className={cn(
              "whitespace-nowrap transition-opacity duration-200",
              expanded ? "opacity-100" : "opacity-0"
            )}
          >
            {pinned ? "Desafixar menu" : "Fixar menu"}
          </span>
        </button>
      </div>
    </aside>
  );
};
