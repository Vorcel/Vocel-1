import { Area, Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, money, moneyShort } from "@/lib/financeiro";

// Fluxo Previsto — visual da Ref10: barras verdes (A Receber) e vermelhas
// (A Pagar) agrupadas por período, linha azul suave com pontos e área azul
// translúcida (Caixa Projetado), grade tracejada discreta e tooltip escuro.
// A MATEMÁTICA vem do backend (/fin/fluxo): saldo acumulado período a período.
// Sem animação (re-render não "pisca", igual Análises).
function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const row = (dot, label, v, ring) => (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={ring ? { background: "#fff", boxShadow: `0 0 0 2.5px ${dot}` } : { background: dot }} />
      <span>{label}: <b className="font-mono-num font-semibold">{money(v)}</b></span>
    </div>
  );
  return (
    <div className="rounded-xl px-3.5 py-2.5 text-xs leading-relaxed text-white shadow-xl" style={{ background: "#1B2A44" }} data-testid="fin-flow-tooltip">
      <p className="mb-1 text-[13px] font-bold">{p.label}</p>
      {row(CHART.receber, "A Receber", p.entradas_cents)}
      {row(CHART.pagar, "A Pagar", p.saidas_cents)}
      {row(CHART.caixa, "Caixa Projetado", p.saldo_final_cents, true)}
      {(p.vencidas_entradas_cents > 0 || p.vencidas_saidas_cents > 0) && <p className="mt-1 text-[11px] text-white/60">Inclui vencidos em aberto.</p>}
      {p.alerta && <p className="mt-1 font-semibold text-red-300">{p.alerta === "negativo" ? "Saldo projetado negativo" : "Abaixo do caixa mínimo"}</p>}
    </div>
  );
}

function Dot({ cx, cy, payload, active }) {
  if (cx == null || cy == null) return null;
  const alerta = payload?.alerta;
  const fill = alerta ? "#EF4444" : CHART.caixa;
  return (
    <g>
      <circle cx={cx} cy={cy} r={active ? 8 : 6.5} fill="#fff" />
      <circle cx={cx} cy={cy} r={active ? 5.5 : 4.5} fill={fill} />
    </g>
  );
}

export function CashFlowChart({ periodos, height = 280, minimo }) {
  const data = periodos || [];
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }} barGap={4} barCategoryGap="30%">
            <defs>
              <linearGradient id="finCaixaArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.caixa} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART.caixa} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--fin-border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--fin-border)" }} interval="preserveStartEnd" minTickGap={10} tickMargin={8} />
            <YAxis tickFormatter={moneyShort} tickLine={false} axisLine={false} width={78} />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--fin-muted-soft)", opacity: 0.5 }} />
            {data.some((p) => p.saldo_final_cents < 0) && <ReferenceLine y={0} stroke="var(--fin-ink-3)" strokeOpacity={0.6} />}
            {minimo > 0 && <ReferenceLine y={minimo} stroke="#EF4444" strokeDasharray="4 4" strokeOpacity={0.7} />}
            <Area type="monotone" dataKey="saldo_final_cents" name="Caixa Projetado" stroke="none" fill="url(#finCaixaArea)"
              isAnimationActive={false} activeDot={false} tooltipType="none" />
            <Bar dataKey="entradas_cents" name="A Receber" fill={CHART.receber} radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={false} />
            <Bar dataKey="saidas_cents" name="A Pagar" fill={CHART.pagar} radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={false} />
            <Area type="monotone" dataKey="saldo_final_cents" name="Caixa Projetado" stroke={CHART.caixa} strokeWidth={3} fill="none"
              isAnimationActive={false} dot={<Dot />} activeDot={<Dot active />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs" style={{ color: "var(--fin-ink-2)" }}>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.receber }} /> A Receber</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART.pagar }} /> A Pagar</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fff", boxShadow: `0 0 0 2.5px ${CHART.caixa}` }} /> Caixa Projetado</span>
        {minimo > 0 && <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-red-500" /> Caixa mínimo</span>}
      </div>
    </div>
  );
}

// Alerta de déficit: lista os períodos com saldo negativo / abaixo do mínimo.
export function DeficitAlert({ periodos }) {
  const ruins = (periodos || []).filter((p) => p.alerta);
  if (!ruins.length) return null;
  const neg = ruins.some((p) => p.alerta === "negativo");
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" data-testid="fin-deficit-alert"
      style={{ background: "var(--fin-danger-soft)", color: "var(--fin-danger)" }}>
      <span className="font-semibold">{neg ? "Déficit previsto:" : "Caixa abaixo do mínimo:"}</span>
      <span style={{ color: "var(--fin-ink-2)" }}>{ruins.map((p) => `${p.label} (${money(p.saldo_final_cents)})`).join(" · ")}</span>
    </div>
  );
}
