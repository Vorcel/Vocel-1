import { BarChart3, Building2, Trophy, TrendingUp } from "lucide-react";
import { compactMoney, money, pctLabel } from "@/lib/analytics";

// Quatro insights do período, sempre em UMA linha no desktop (Ref 1).
// Todos derivam do mesmo dataset do backend (`monthly` / ranking de empenhos):
// nada é recalculado aqui. Cada card tem paleta pastel própria; o ícone fica à
// esquerda, separado do texto por uma divisória bem suave.
const TONES = {
  green: { bg: "#E8FAF1", icon: "#14AF70", title: "#07905B", border: "#CFF0E0" },
  blue: { bg: "#EAF4FF", icon: "#187BEA", title: "#1469CE", border: "#D2E6FB" },
  purple: { bg: "#F3E9FF", icon: "#8429EE", title: "#6F18DA", border: "#E4D4FA" },
  orange: { bg: "#FFF0E1", icon: "#FF5A18", title: "#D74216", border: "#FBDCC3" },
};

const SEM_DADOS = "Sem dados no período";

const Card = ({ icon: Icon, tone, title, main, detail, extra, testid }) => (
  <div
    data-testid={testid}
    className="flex min-h-[74px] min-w-0 items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-shadow duration-150 hover:shadow-[0_2px_8px_rgba(25,60,100,0.07)]"
    style={{ backgroundColor: tone.bg, borderColor: tone.border }}
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ color: tone.icon }}>
      <Icon size={26} strokeWidth={2.2} />
    </span>
    <span className="h-9 w-px shrink-0" style={{ backgroundColor: tone.border }} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-[11px] font-bold leading-tight" style={{ color: tone.title }} title={title}>{title}</p>
      <p
        className="truncate text-[17px] font-extrabold leading-tight text-[var(--an-text)]"
        title={typeof main === "string" ? main : undefined}
      >
        {main}
      </p>
      {detail && <p className="truncate text-[10px] leading-tight text-[var(--an-muted)]" title={detail}>{detail}</p>}
      {extra && <p className="truncate text-[9px] leading-tight text-[var(--an-micro)]" title={extra}>{extra}</p>}
    </div>
  </div>
);

export function InsightCards({ insights = {} }) {
  const { best_month: melhorMes, best_success_rate: melhorTaxa, growth = {}, top_bid: maior } = insights;
  const crescimento = growth.change;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        testid="insight-best-month" icon={BarChart3} tone={TONES.green} title="Melhor mês do período"
        main={melhorMes ? melhorMes.month_label : SEM_DADOS}
        detail={melhorMes ? `${money(melhorMes.committed_value)} empenhados` : "Nenhum empenho reconhecido"}
        extra={melhorMes ? `${melhorMes.participated} licitação(ões) participada(s)` : null}
      />
      <Card
        testid="insight-success-rate" icon={Trophy} tone={TONES.blue} title="Maior taxa de sucesso"
        main={melhorTaxa ? pctLabel(melhorTaxa.success_rate) : SEM_DADOS}
        detail={melhorTaxa ? `Em ${melhorTaxa.label}` : "Nenhuma participação no período"}
        extra={melhorTaxa ? `${melhorTaxa.adjudicated} adjudicada(s) de ${melhorTaxa.participated}` : null}
      />
      <Card
        testid="insight-growth" icon={TrendingUp} tone={TONES.purple} title="Crescimento do período"
        main={crescimento == null ? "Sem base de comparação" : `${crescimento >= 0 ? "+" : ""}${pctLabel(crescimento)}`}
        detail="No valor empenhado"
        extra={`${compactMoney(growth.current)} vs. ${compactMoney(growth.previous)} (${growth.comparison_label})`}
      />
      <Card
        testid="insight-top-bid" icon={Building2} tone={TONES.orange} title="Maior participação (valor empenhado)"
        main={maior ? maior.orgao : SEM_DADOS}
        detail={maior ? money(maior.valor_empenhado) : "Nenhum empenho reconhecido"}
        extra={maior ? maior.objeto : null}
      />
    </div>
  );
}
