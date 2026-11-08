import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, ChartColumnIncreasing, History, Landmark, LayoutDashboard, Settings,
  Wallet, X,
} from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FinanceProvider, useFinance } from "@/context/FinanceContext";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/financeiro", label: "Visão Geral", icon: LayoutDashboard, end: true, testid: "fin-nav-overview" },
  { to: "/financeiro/pagar", label: "A Pagar", icon: ArrowUpFromLine, testid: "fin-nav-payables" },
  { to: "/financeiro/receber", label: "A Receber", icon: ArrowDownToLine, testid: "fin-nav-receivables", badge: true },
  { to: "/financeiro/fluxo", label: "Fluxo de Caixa", icon: ChartColumnIncreasing, testid: "fin-nav-cashflow" },
  { to: "/financeiro/bancos", label: "Bancos", icon: Landmark, testid: "fin-nav-banks" },
  { to: "/financeiro/historico", label: "Histórico", icon: History, testid: "fin-nav-history" },
  { to: "/financeiro/configuracoes", label: "Configurações", icon: Settings, testid: "fin-nav-settings" },
];

function SidebarContent({ onNavigate }) {
  const { pendentes } = useFinance();
  const badge = pendentes.solicitacoes + pendentes.atualizacoes;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-emerald-200 ring-1 ring-white/15">
          <Wallet size={21} />
        </span>
        <div className="leading-tight">
          <p className="font-heading text-lg font-bold tracking-tight text-white">Vorcel</p>
          <p className="text-[13px] font-medium text-emerald-100/70">Financeiro</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate} data-testid={n.testid}
            className={({ isActive }) => cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition-colors",
              isActive ? "bg-white/[0.13] text-white shadow-[inset_3px_0_0_#5EEAD4]" : "text-emerald-50/75 hover:bg-white/[0.07] hover:text-white"
            )}>
            <n.icon size={19} className="shrink-0" />
            <span className="flex-1 truncate">{n.label}</span>
            {n.badge && badge > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950" title="Aguardando o Financeiro" data-testid="fin-nav-badge">{badge}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <p className="px-5 py-5 text-[11px] text-emerald-50/40">Gestão de contas, recebimentos e caixa</p>
    </div>
  );
}

function Shell() {
  const { mobileNav, setMobileNav } = useFinance();
  const location = useLocation();
  useEffect(() => { setMobileNav(false); }, [location.pathname, setMobileNav]);
  return (
    <div className="fin-scope min-h-screen" data-testid="fin-layout">
      <aside className="fin-sidebar fixed inset-y-0 left-0 z-40 hidden w-[232px] lg:block">
        <SidebarContent />
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
          <aside className="fin-sidebar absolute inset-y-0 left-0 w-[260px] shadow-2xl">
            <button onClick={() => setMobileNav(false)} className="absolute right-3 top-3 rounded-lg p-1.5 text-white/70 hover:bg-white/10" title="Fechar"><X size={18} /></button>
            <SidebarContent onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-[232px]">
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <ErrorBoundary><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function FinancialLayout() {
  return (
    <FinanceProvider>
      <Shell />
    </FinanceProvider>
  );
}
