import { useMemo } from "react";
import { CalendarDays, Award, Star, Clock, MapPin } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { BidsSection } from "@/components/bids/BidsSection";
import { useData } from "@/context/DataContext";
import { cn } from "@/lib/utils";

const SummaryCard = ({ icon: Icon, label, value, accent, testid }) => (
  <div data-testid={testid} className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
    <div className={cn("flex h-12 w-12 items-center justify-center rounded-lg", accent)}>
      <Icon size={24} />
    </div>
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-heading text-3xl font-bold text-foreground">{value}</p>
    </div>
  </div>
);

export default function Dashboard() {
  const { summary, bids } = useData();

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayBids = useMemo(
    () => bids.filter((b) => b.data_disputa === todayStr).sort((a, b) => (a.hora || "").localeCompare(b.hora || "")),
    [bids, todayStr]
  );

  return (
    <>
      <Header title="Página Inicial" subtitle="Monitoramento diário das suas licitações" />
      <main className="space-y-8 p-6">
        {/* Seção 1 — Resumo */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard testid="card-mes" icon={CalendarDays} label="Licitações do Mês" value={summary.licitacoes_mes} accent="bg-brand/10 text-brand" />
          <SummaryCard testid="card-adjudicadas" icon={Award} label="Adjudicadas" value={summary.adjudicadas} accent="bg-emerald-100 text-emerald-600" />
          <SummaryCard testid="card-acompanhando" icon={Star} label="Acompanhando" value={summary.acompanhando} accent="bg-amber-100 text-amber-600" />
        </section>

        {/* Seção 2 — Alertas de Hoje */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 animate-pulse-clock rounded-full bg-alert" />
            <h2 className="font-heading text-lg font-semibold text-foreground">Alertas de Hoje</h2>
            <span className="rounded-full bg-alert/10 px-2 py-0.5 text-xs font-semibold text-alert">{todayBids.length}</span>
          </div>
          {todayBids.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
              Nenhuma sessão de disputa agendada para hoje.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {todayBids.map((b, idx) => (
                <div
                  key={b.id}
                  data-testid={`today-alert-${b.id}`}
                  className="animate-fade-up rounded-xl border border-border border-l-4 border-l-alert bg-card p-5 shadow-sm"
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  <div className="flex items-center gap-2 text-alert">
                    <Clock size={28} className="animate-pulse-clock" />
                    <span className="font-mono-num text-5xl font-black tracking-tighter">{b.hora || "--:--"}</span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-heading text-base font-semibold text-foreground">{b.objeto}</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {b.pregao && <span className="font-mono-num rounded-md bg-secondary px-2 py-1 font-medium">{b.pregao}</span>}
                    <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 font-medium text-brand">
                      <MapPin size={12} /> {b.portal}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Seção 3 + 4 — Filtros & Tabela */}
        <section>
          <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">Todas as Licitações</h2>
          <BidsSection />
        </section>
      </main>
    </>
  );
}
