import { ArrowDown, ArrowUp } from "lucide-react";
import { shortPeriodLabel } from "@/lib/analytics";
import { cn } from "@/lib/utils";

// Card de indicador do topo (Ref 1): [ícone pastel] valor + rótulo à esquerda,
// variação + período comparado à direita. Altura ~66px, uma linha só em desktop.
// `change` vem pronto do backend; `null` = sem base de comparação (nunca NaN).
// Paletas pastel por métrica — chave passada pela página.
export const KPI_TONES = {
  participadas: { fg: "#1687F8", bg: "#E7F3FF" },
  adjudicadas: { fg: "#19B975", bg: "#E4F8EF" },
  total: { fg: "#F59E0B", bg: "#FFF2DA" },
  empenhado: { fg: "#8B4FF6", bg: "#F1E9FF" },
  lucro: { fg: "#7427E8", bg: "#F2E9FF" },
  lucroNegativo: { fg: "#E23D3D", bg: "#FDE8E8" },
};

export function KpiCard({ icon: Icon, label, value, change, comparisonLabel, tone, testid }) {
  const semBase = change == null;
  const positivo = !semBase && change >= 0;
  const Seta = positivo ? ArrowUp : ArrowDown;
  const cor = KPI_TONES[tone] || KPI_TONES.participadas;
  return (
    <div data-testid={testid} className="an-card flex min-h-[66px] min-w-0 items-center gap-2 px-2.5 py-2.5">
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px]"
        style={{ backgroundColor: cor.bg, color: cor.fg }}
      >
        <Icon size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <p
          data-testid={`${testid}-value`}
          title={String(value)}
          className="truncate text-[20px] font-extrabold leading-none tracking-tight text-[var(--an-text)]"
        >
          {value}
        </p>
        <p title={label} className="mt-1 truncate text-[10.5px] font-medium leading-tight text-[var(--an-label)]">
          {label}
        </p>
      </div>

      <div className="flex w-[52px] shrink-0 flex-col items-end">
        {semBase ? (
          <span data-testid={`${testid}-delta`} className="text-[10px] font-semibold leading-none text-[var(--an-micro)]">
            Sem base
          </span>
        ) : (
          <span
            data-testid={`${testid}-delta`}
            className={cn(
              "flex items-center gap-0.5 text-[12px] font-bold leading-none",
              positivo ? "text-[#0DA66B]" : "text-[#E23D3D]"
            )}
          >
            <Seta size={12} strokeWidth={3} />
            {Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
        )}
        {/* Rótulo curto no card (o período completo fica no tooltip) — o card
            precisa da largura para o valor e o nome da métrica. */}
        <span title={`vs. ${comparisonLabel}`} className="mt-1.5 w-full truncate text-right text-[9px] leading-tight text-[var(--an-micro)]">
          vs. {shortPeriodLabel(comparisonLabel)}
        </span>
      </div>
    </div>
  );
}
