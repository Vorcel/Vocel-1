import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Award, Star, Wallet } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { BidsSection } from "@/components/bids/BidsSection";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { hasAnyFinance } from "@/lib/permissions";
import { TodayTasks } from "@/components/tasks/TodayTasks";
import { TodayBids } from "@/components/home/TodayBids";
import { cn } from "@/lib/utils";

const MiniCard = ({ icon: Icon, label, value, accent, testid, delta }) => (
  <div data-testid={testid} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm transition-shadow hover:shadow">
    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", accent)}>
      <Icon size={16} />
    </div>
    <div className="min-w-0">
      <p className="truncate text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className="font-heading text-lg font-bold leading-none text-foreground">{value}</p>
        {delta != null && (
          <span
            data-testid={`${testid}-delta`}
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
              delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            )}
          >
            {delta >= 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
    </div>
  </div>
);

// Data/hora da disputa como Date no fuso LOCAL do navegador (America/Sao_Paulo
// no uso real) — evita o deslocamento de dia causado por conversão UTC.
// Sem horário cadastrado, assume o fim do dia (23:59).
const disputaDateTime = (b) => {
  if (!b.data_disputa) return null;
  const d = new Date(`${b.data_disputa}T${b.hora || "23:59"}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const WINDOW_MS = 24 * 60 * 60 * 1000; // aparece 24h antes da disputa
const AFTER_MS = 30 * 60 * 1000; // permanece até 30 min depois da disputa

// Data local (YYYY-MM-DD) de um Date, sem conversão UTC.
const toDateStr = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

export default function Dashboard() {
  const { summary, bids } = useData();
  const { user, can } = useAuth();
  const navigate = useNavigate();

  // Relógio interno (1 min): retira/insere cards da janela sem precisar de F5.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Janela de exibição: de (disputa - 24h) até 30 min depois da disputa.
  // Sexta/sábado/domingo também puxam as sessões da segunda (fim de semana sem disputas).
  const todayBids = useMemo(() => {
    const day = now.getDay(); // 0=dom, 5=sex, 6=sáb
    const mondayStr =
      day === 5 || day === 6 || day === 0
        ? toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - day) % 7)))
        : null;
    return bids
      .filter((b) => {
        const d = disputaDateTime(b);
        if (!d) return false;
        const diff = d - now;
        const inWindow = diff <= WINDOW_MS && diff >= -AFTER_MS;
        const isNextMonday = mondayStr && b.data_disputa === mondayStr;
        return inWindow || isNextMonday;
      })
      .sort((a, b) => disputaDateTime(a) - disputaDateTime(b));
  }, [bids, now]);

  const headerCards = (
    <>
      <MiniCard testid="card-mes" icon={CalendarDays} label="Participações no Mês" value={summary.licitacoes_mes} delta={summary.licitacoes_mes_delta} accent="bg-brand/10 text-brand" />
      <MiniCard testid="card-adjudicadas" icon={Award} label="Adjudicadas" value={summary.adjudicadas} delta={summary.adjudicadas_delta} accent="bg-emerald-100 text-emerald-600" />
      <MiniCard testid="card-acompanhando" icon={Star} label="Em Acompanhamento" value={summary.acompanhando} accent="bg-amber-100 text-amber-600" />
    </>
  );

  // Troca de módulo: fica à esquerda, logo depois do ícone da sidebar e antes
  // dos cards de indicadores (não junto do Rascunho, que é ferramenta de trabalho).
  const financeiroButton = hasAnyFinance(user) && (
    <button
      data-testid="header-financeiro"
      onClick={() => navigate("/financeiro")}
      title="Abrir o módulo Financeiro"
      className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#0F6B5C] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#0B564A]"
    >
      <Wallet size={16} className="shrink-0" />
      <span className="hidden sm:inline">Financeiro</span>
    </button>
  );

  return (
    <>
      <Header leftContent={financeiroButton} centerContent={headerCards} />
      <main className="space-y-5 p-6">
        {/* 1 — Tarefas do Dia (resumo operacional; a lista completa fica em /tarefas) */}
        {can("tasks.view") && <TodayTasks />}

        {/* 2 — Licitações do Dia (REF1) */}
        <TodayBids bids={todayBids} />

        {/* 3 — Todas as Licitações (sem alterações) */}
        <section className="pt-1">
          <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">Todas as Licitações</h2>
          <BidsSection />
        </section>
      </main>
    </>
  );
}
