import { useMemo } from "react";
import { CalendarDays, Award, Star, Clock, MapPin } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { BidsSection } from "@/components/bids/BidsSection";
import { useData } from "@/context/DataContext";
import { colorStyles, findColor } from "@/lib/constants";
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

export default function Dashboard() {
  const { summary, bids, lists } = useData();

  const now = new Date();
  const DAY_COLORS = ["#18181B", "#1E293B", "#2D283E", "#334155", "#1F2937", "#475569", "#121417"];
  const dayColor = DAY_COLORS[now.getDay()];
  const longDate = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayBids = useMemo(
    () => bids.filter((b) => b.data_disputa === todayStr).sort((a, b) => (a.hora || "").localeCompare(b.hora || "")),
    [bids, todayStr]
  );

  const headerCards = (
    <>
      <MiniCard testid="card-mes" icon={CalendarDays} label="Participações no Mês" value={summary.licitacoes_mes} delta={summary.licitacoes_mes_delta} accent="bg-brand/10 text-brand" />
      <MiniCard testid="card-adjudicadas" icon={Award} label="Adjudicadas" value={summary.adjudicadas} delta={summary.adjudicadas_delta} accent="bg-emerald-100 text-emerald-600" />
      <MiniCard testid="card-acompanhando" icon={Star} label="Em Acompanhamento" value={summary.acompanhando} accent="bg-amber-100 text-amber-600" />
    </>
  );

  return (
    <>
      <Header centerContent={headerCards} />
      <main className="space-y-8 p-6">
        {/* Seção 2 — Licitações do Dia (Hero Banner dinâmico) */}
        <section>
          <div
            data-testid="hero-banner"
            style={{ height: 280, width: "100%", backgroundColor: dayColor, transition: "background-color 0.5s ease" }}
            className="flex flex-col overflow-hidden rounded-2xl p-6"
          >
            <div className="mb-4 flex shrink-0 items-center gap-2">
              <span className="flex h-2.5 w-2.5 animate-pulse-clock rounded-full bg-white/70" />
              <h2 className="font-heading text-lg font-semibold text-white">Licitações do Dia</h2>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white">{todayBids.length}</span>
              <span className="ml-auto text-sm capitalize text-white/60">{longDate}</span>
            </div>

            {todayBids.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-white/60">
                Nenhuma sessão de disputa agendada para hoje.
              </div>
            ) : (
              <div className="scrollbar-hide flex flex-1 items-center overflow-x-auto" style={{ gap: 16 }}>
                {todayBids.map((b) => {
                  const portalStyle = colorStyles(findColor(lists.portais, b.portal)).badge;
                  return (
                    <div key={b.id} data-testid={`today-alert-${b.id}`} className="hero-bid-card flex shrink-0 flex-col justify-between p-5">
                      <div className="flex items-center gap-2">
                        <Clock size={22} className="text-brand" />
                        <span className="font-mono-num text-4xl font-extrabold tracking-tighter text-[#121417]">{b.hora || "--:--"}</span>
                        {b.uasg && <span className="font-mono-num ml-auto text-[11px] text-[#76777b]">UASG {b.uasg}</span>}
                      </div>
                      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[#141d23]">{b.objeto}</h3>
                      <div className="flex items-center gap-2">
                        <span style={portalStyle} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                          <MapPin size={11} /> {b.portal}
                        </span>
                        {b.pregao && <span className="font-mono-num text-[11px] text-[#76777b]">{b.pregao}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
