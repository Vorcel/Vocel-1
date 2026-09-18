import { cn } from "@/lib/utils";

// Barra de progresso principal abaixo da timeline (Execução & Pós-Venda),
// redesenhada a partir de `referências/Ref 1.png`: cápsula com borda azul-clara,
// trilho claro, preenchimento em degradê azul → violeta → roxo → lilás, marcador
// circular (anel branco + centro roxo + glow) exatamente no fim do preenchimento
// e percentual roxo à direita. Puramente visual: recebe o `progress` (0–100) já
// calculado pela lógica existente — não recalcula nada.
// A mini barra da tabela NÃO usa este componente.

const GRADIENT = "linear-gradient(90deg, #3B3DFF 0%, #6A4BFF 35%, #9B4DF5 65%, #D9A0F5 100%)";
const PURPLE = "#6D3BE8";
const MARKER = 22;               // diâmetro do marcador (px) — anel incluso
const R = MARKER / 2;

export function TimelineProgressBar({ progress, done, total, className }) {
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  // O centro do marcador percorre [R, 100% - R] para nunca ser cortado nas pontas;
  // o preenchimento termina sob o marcador (R além do centro), chegando a 100% no fim.
  const center = `calc(${R}px + ${p / 100} * (100% - ${MARKER}px))`;
  const fill = `calc(${MARKER}px + ${p / 100} * (100% - ${MARKER}px))`;

  return (
    <div className={cn("flex flex-col items-center", className)} data-testid="exec-progress-wrap">
      {/* ~70% da largura útil do bloco da timeline, centralizada; em telas
          estreitas usa a largura toda para não ficar pequena demais. */}
      <div className="w-full sm:w-[70%] sm:min-w-[360px]">
        {done != null && total != null && (
          <div className="mb-1.5 flex justify-end">
            <span className="text-xs text-muted-foreground">{done} de {total} etapas concluídas</span>
          </div>
        )}
        <div className="flex items-center gap-4">
          {/* Cápsula externa (borda azul-clara + trilho) — padding vertical dá espaço ao glow */}
          <div className="min-w-0 flex-1 py-1.5">
            <div className="rounded-full border-2 border-[#CFE0FF] bg-[#F3F6FC] p-[3px] shadow-[0_1px_2px_rgba(37,99,235,0.08)] dark:border-[#3B4A6B] dark:bg-[#1B2233]">
              <div className="relative h-4 rounded-full bg-[#E4EAF3] dark:bg-[#2A3346]">
                {/* Preenchimento em degradê (cores da referência) */}
                <div
                  data-testid="exec-progress-bar"
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: fill, background: GRADIENT }}
                />
                {/* Marcador circular no fim do preenchimento: glow + anel branco + centro roxo */}
                <div
                  data-testid="exec-progress-marker"
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-[left] duration-500 ease-out dark:bg-slate-100"
                  style={{
                    left: center, width: MARKER, height: MARKER,
                    boxShadow: "0 0 0 6px rgba(139,92,246,0.22), 0 0 16px 4px rgba(124,77,255,0.35)",
                  }}
                >
                  <div className="absolute inset-[4px] rounded-full" style={{ backgroundColor: "#7B3FE4" }} />
                </div>
              </div>
            </div>
          </div>
          <span data-testid="exec-progress-pct" className="font-heading shrink-0 text-lg font-extrabold tabular-nums" style={{ color: PURPLE }}>
            {p}%
          </span>
        </div>
      </div>
    </div>
  );
}
