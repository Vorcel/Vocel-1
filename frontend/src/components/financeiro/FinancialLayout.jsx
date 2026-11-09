import { Outlet } from "react-router-dom";
import {
  ArrowDownToLine, ArrowUpFromLine, ChartColumnIncreasing, FileBarChart, History, Landmark, LayoutDashboard, Settings,
} from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/layout/Sidebar";
import { FinanceProvider, useFinance } from "@/context/FinanceContext";

const NAV = [
  { to: "/financeiro", label: "Visão Geral", icon: LayoutDashboard, end: true, testid: "fin-nav-overview" },
  { to: "/financeiro/pagar", label: "A Pagar", icon: ArrowUpFromLine, testid: "fin-nav-payables" },
  { to: "/financeiro/receber", label: "A Receber", icon: ArrowDownToLine, testid: "fin-nav-receivables", badge: true },
  { to: "/financeiro/fluxo", label: "Fluxo de Caixa", icon: ChartColumnIncreasing, testid: "fin-nav-cashflow" },
  { to: "/financeiro/bancos", label: "Bancos", icon: Landmark, testid: "fin-nav-banks" },
  { to: "/financeiro/dre", label: "DRE", icon: FileBarChart, testid: "fin-nav-dre" },
  { to: "/financeiro/historico", label: "Histórico", icon: History, testid: "fin-nav-history" },
  { to: "/financeiro/configuracoes", label: "Configurações", icon: Settings, testid: "fin-nav-settings" },
];

// Mesma Sidebar de Licitações (mecanismo idêntico), com a identidade teal do Financeiro.
const FIN_THEME = {
  aside: "fin-sidebar",
  divider: "border-white/10",
  logo: "bg-white ring-1 ring-white/15",
  title: "text-white",
  subtitle: "text-emerald-100/70",
  active: "bg-white/[0.13] text-white",
  idle: "text-emerald-50/75 hover:bg-white/[0.07] hover:text-white",
  indicator: "bg-[#5EEAD4]",
};

function Shell() {
  const { pendentes } = useFinance();
  const badge = pendentes.solicitacoes + pendentes.atualizacoes;
  const items = NAV.map((n) => (n.badge
    ? { ...n, badge, badgeTitle: "Aguardando o Financeiro", badgeTestid: "fin-nav-badge" }
    : { ...n, badge: 0 }));
  return (
    <div className="fin-scope min-h-screen" data-testid="fin-layout">
      <Sidebar items={items} theme={FIN_THEME} testid="fin-sidebar" homeTo="/financeiro"
        brand={{ title: "Vorcel", subtitle: "Financeiro" }} />
      <div className="pl-16 transition-all duration-300">
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
