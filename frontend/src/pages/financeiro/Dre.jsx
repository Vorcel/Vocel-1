import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileBarChart, Landmark, Loader2, Scale, Sparkles, TrendingDown, TrendingUp, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { useFinance } from "@/context/FinanceContext";
import { apiError, drePresets, finApi, fmtDate, money, periodLabel, todaySP } from "@/lib/financeiro";
import { EmptyState, FinButton, FinSelect, KpiCard, Money, PageHeader, Panel } from "@/components/financeiro/ui";
import { cn } from "@/lib/utils";

// DRE GERENCIAL (não é Fluxo de Caixa): resultado econômico por COMPETÊNCIA.
// Tudo vem de UMA agregação do backend (/api/fin/dre): cards e tabela leem a
// mesma resposta. Valores = valor integral dos lançamentos (baixa parcial não
// muda a DRE); nunca saldo bancário. Hierarquia: Grupo DRE → Categoria →
// Subcategoria → Lançamentos (último nível carregado sob demanda).

const NONE = "none";
const fmtSigned = (v) => <Money cents={Math.abs(v || 0)} flow={v < 0 ? "out" : v > 0 ? "in" : "neutral"} />;
const SINAL_TXT = { "+": "", "-": "(−)", "+/-": "(+/−)" };

function Variation({ cur, prev }) {
  const d = (cur || 0) - (prev || 0);
  if (!d) return <span style={{ color: "var(--fin-ink-3)" }}>—</span>;
  const pct = prev ? (d / Math.abs(prev)) * 100 : null;
  // Para o RESULTADO, valor maior é sempre melhor (despesa menor também sobe o número).
  const good = d > 0;
  return (
    <span className="inline-flex items-center gap-1 font-mono-num whitespace-nowrap text-xs font-semibold" style={{ color: good ? "var(--fin-success)" : "var(--fin-danger)" }}>
      {good ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {good ? "+" : "−"}{money(Math.abs(d))}{pct != null && ` (${good ? "+" : "−"}${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}
    </span>
  );
}

export default function Dre() {
  const { version, acaoLancamento } = useFinance();
  const navigate = useNavigate();
  const today = todaySP();
  const presets = useMemo(() => drePresets(today), [today]);
  const [periodKey, setPeriodKey] = useState("mes");          // nunca persistido
  const [custom, setCustom] = useState({ from: presets[0].from, to: presets[0].to });
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});                       // nós expandidos (path -> bool)
  const [entries, setEntries] = useState({});                 // path -> lançamentos | "loading"
  const [classifying, setClassifying] = useState(false);

  const range = periodKey === "custom" ? custom : presets.find((p) => p.key === periodKey);
  const valid = range?.from && range?.to && range.from <= range.to;

  const load = useCallback(() => {
    if (!valid) return;
    setLoading(true);
    finApi.dre({ date_from: range.from, date_to: range.to, compare: compare || undefined })
      .then((d) => { setData(d); setEntries({}); })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [range?.from, range?.to, compare, valid]);
  useEffect(() => { load(); }, [load, version]);

  const toggle = (path, fetchParams) => {
    const willOpen = !open[path];
    setOpen((o) => ({ ...o, [path]: willOpen }));
    if (willOpen && fetchParams && !entries[path]) {
      setEntries((x) => ({ ...x, [path]: "loading" }));
      finApi.dreLancamentos({ date_from: data.period.from, date_to: data.period.to, ...fetchParams })
        .then((d) => setEntries((x) => ({ ...x, [path]: d.items })))
        .catch((e) => { toast.error(apiError(e)); setEntries((x) => ({ ...x, [path]: [] })); });
    }
  };

  const classificar = async () => {
    setClassifying(true);
    try {
      const r = await finApi.dreClassificarPendentes();
      toast.success(r.classificados ? `${r.classificados} lançamento(s) classificado(s) pela estrutura atual` : "Nada a classificar");
      load();
    } catch (e) { toast.error(apiError(e)); } finally { setClassifying(false); }
  };

  const t = data?.totals || {};
  const tp = data?.totals_prev || {};
  const cur = data ? periodLabel(data.period.from, data.period.to) : "";
  const prevLbl = data?.compare_period ? periodLabel(data.compare_period.from, data.compare_period.to) : "";
  const unc = data?.unclassified;
  const cols = compare ? 4 : 2;

  const kpi = (key, label, icon, testid) => {
    const v = t[key] || 0;
    const final = key === "resultado_liquido";
    return (
      <KpiCard testid={testid} icon={icon} tone={v < 0 ? "danger" : "success"} flow={v < 0 ? "out" : v > 0 ? "in" : undefined}
        label={data?.titles?.[key] || label} value={`${v < 0 ? "−" : ""}${money(Math.abs(v))}`}
        sub={compare ? `${prevLbl}: ${v - (tp[key] || 0) >= 0 ? "+" : "−"}${money(Math.abs(v - (tp[key] || 0)))}` : (final ? (v < 0 ? "Prejuízo no período" : v > 0 ? "Lucro no período" : "Sem resultado") : cur)} />
    );
  };

  // Linhas de um nó (categoria/subcategoria) e seus lançamentos.
  const entryRows = (path, depth) => {
    const list = entries[path];
    if (!open[path]) return null;
    if (list === "loading" || list == null) {
      return <tr><td colSpan={cols} style={{ paddingLeft: 16 + depth * 20 }} className="text-xs"><Loader2 size={13} className="mr-1.5 inline animate-spin" />Carregando lançamentos…</td></tr>;
    }
    if (!list.length) return <tr><td colSpan={cols} style={{ paddingLeft: 16 + depth * 20, color: "var(--fin-ink-3)" }} className="text-xs">Nenhum lançamento neste período.</td></tr>;
    return list.map((e) => (
      <tr key={`${path}/${e.id}`} className="dre-entry cursor-pointer hover:bg-[var(--fin-muted-soft)]" onClick={() => acaoLancamento("detail", e)} data-testid={`fin-dre-entry-${e.id}`}>
        <td style={{ paddingLeft: 16 + depth * 20 }}>
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="font-mono-num shrink-0 text-xs" style={{ color: "var(--fin-ink-3)" }}>{fmtDate(e.competence_date)}</span>
            <span className="truncate" style={{ color: "var(--fin-ink-2)" }} title={e.description}>
              {e.description}{e.sequence_total ? ` (${e.sequence_index}/${e.sequence_total})` : ""}
            </span>
          </div>
        </td>
        <td className="text-right text-[13px]">{fmtSigned(e.net_cents)}</td>
        {compare && <><td /><td /></>}
      </tr>
    ));
  };

  const valueCells = (node, strong) => (
    <>
      <td className={cn("text-right", strong && "font-semibold")}>{fmtSigned(node.value)}</td>
      {compare && (
        <>
          <td className={cn("text-right", strong && "font-semibold")} style={{ opacity: 0.85 }}>{fmtSigned(node.prev)}</td>
          <td className="text-right"><Variation cur={node.value} prev={node.prev} /></td>
        </>
      )}
    </>
  );

  const Chevron = ({ on }) => (on ? <ChevronDown size={15} /> : <ChevronRight size={15} />);
  const nodeLabel = (label, count, on, canOpen, depth, onClick, testid, bold) => (
    <td style={{ paddingLeft: 12 + depth * 20 }}>
      {canOpen ? (
        <button type="button" onClick={onClick} data-testid={testid} aria-expanded={on}
          className={cn("inline-flex max-w-full items-center gap-1.5 rounded-md text-left hover:underline", bold && "font-semibold")}
          style={{ color: "var(--fin-ink)" }}>
          <span className="shrink-0" style={{ color: "var(--fin-ink-3)" }}><Chevron on={on} /></span>
          <span className="truncate">{label}</span>
          {count > 0 && <span className="shrink-0 text-[11px] font-normal" style={{ color: "var(--fin-ink-3)" }}>{count}</span>}
        </button>
      ) : (
        <span className={cn("inline-flex items-center gap-1.5 pl-[21px]", bold && "font-semibold")} style={{ color: "var(--fin-ink)" }}>{label}</span>
      )}
    </td>
  );

  // Grupo -> categorias -> subcategorias -> lançamentos.
  const groupRows = (g, groupKey, base = "g") => {
    const gp = `${base}:${groupKey}`;
    return (
      <Fragment key={gp}>
        <tr data-testid={`fin-dre-row-${groupKey}`} className="dre-group">
          {nodeLabel(<>{g.sinal ? <span className="mr-1" style={{ color: "var(--fin-ink-3)" }}>{SINAL_TXT[g.sinal]}</span> : null}{g.label}{g.ativo === false ? " (inativo)" : ""}</>,
            0, !!open[gp], g.children?.length > 0, 0, () => toggle(gp), `fin-dre-toggle-${groupKey}`, true)}
          {valueCells(g, true)}
        </tr>
        {open[gp] && g.children.map((c) => {
          const cp = `${gp}/c:${c.key}`;
          const subs = c.children || [];
          const leaf = subs.length === 0;
          return (
            <Fragment key={cp}>
              <tr data-testid={`fin-dre-cat-${c.key}`}>
                {nodeLabel(c.label, c.count, !!open[cp], true, 1,
                  () => toggle(cp, leaf ? { group: groupKey, category: c.key } : null), `fin-dre-toggle-cat-${c.key}`)}
                {valueCells(c)}
              </tr>
              {leaf ? entryRows(cp, 2) : open[cp] && subs.map((sub) => {
                const sp = `${cp}/s:${sub.key}`;
                return (
                  <Fragment key={sp}>
                    <tr data-testid={`fin-dre-sub-${sub.key}`}>
                      {nodeLabel(sub.label, sub.count, !!open[sp], true, 2,
                        () => toggle(sp, { group: groupKey, category: c.key, subcategory: sub.key }), `fin-dre-toggle-sub-${sub.key}`)}
                      {valueCells(sub)}
                    </tr>
                    {entryRows(sp, 3)}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
      </Fragment>
    );
  };

  return (
    <>
      <PageHeader icon={FileBarChart} title="DRE" subtitle="Análise gerencial de receitas, custos, despesas e resultado."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <FinSelect value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className="w-auto" data-testid="fin-dre-period">
              {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value="custom">Personalizado…</option>
            </FinSelect>
            <FinButton variant={compare ? "primary" : "outline"} onClick={() => setCompare((c) => !c)} data-testid="fin-dre-compare" aria-pressed={compare}>
              <Scale size={15} /> Comparar com período anterior
            </FinButton>
          </div>
        )} />
      {periodKey === "custom" && (
        <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--fin-ink-2)" }}>
          Competência de <DatePickerInput value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} testid="fin-dre-from" className="w-40" />
          até <DatePickerInput value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} testid="fin-dre-to" className="w-40" />
          {!valid && <span className="text-xs" style={{ color: "var(--fin-danger)" }}>Informe um período válido.</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="fin-dre-cards">
        {kpi("receita_liquida", "Receita Líquida", Landmark, "fin-dre-kpi-receita")}
        {kpi("lucro_bruto", "Lucro Bruto", Sparkles, "fin-dre-kpi-lucro-bruto")}
        {kpi("resultado_operacional", "Resultado Operacional", TrendingUp, "fin-dre-kpi-operacional")}
        {kpi("resultado_liquido", "Resultado Líquido", Scale, "fin-dre-kpi-liquido")}
      </div>

      {unc?.count > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border p-3.5 text-sm" style={{ borderColor: "var(--fin-warning)", background: "var(--fin-warning-soft)" }} data-testid="fin-dre-unclassified-alert">
          <AlertTriangle size={18} style={{ color: "var(--fin-warning)" }} className="shrink-0" />
          <p className="min-w-0 flex-1" style={{ color: "var(--fin-ink)" }}>
            <b>Existem {unc.count} lançamento(s) sem classificação DRE</b> neste período ({fmtSigned(unc.value)}). Eles <b>não entram</b> nas linhas de resultado até receberem um Grupo DRE.
          </p>
          <div className="flex flex-wrap gap-2">
            <FinButton variant="outline" className="h-8 text-xs" onClick={() => { setOpen((o) => ({ ...o, [`u:${NONE}`]: true })); document.getElementById("fin-dre-unclassified")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
              data-testid="fin-dre-show-unclassified">Ver registros</FinButton>
            {unc.classificaveis > 0 && (
              <FinButton className="h-8 text-xs" onClick={classificar} loading={classifying} data-testid="fin-dre-classify">
                <Wand2 size={14} /> Classificar {unc.classificaveis} pela estrutura atual
              </FinButton>
            )}
            <FinButton variant="ghost" className="h-8 text-xs" onClick={() => navigate("/financeiro/configuracoes/categorias")}>Configurar categorias</FinButton>
          </div>
        </div>
      )}

      <Panel className="mt-5" icon={FileBarChart} title="Demonstração do Resultado" testid="fin-dre-table"
        subtitle={data ? `Competência ${fmtDate(data.period.from)} a ${fmtDate(data.period.to)} · valores integrais dos lançamentos (pagos ou não), sem cancelados.` : "Carregando…"}>
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--fin-border)" }}>
          <table className="fin-table w-full" style={{ minWidth: compare ? 720 : 420, opacity: loading ? 0.55 : 1 }}>
            <thead>
              <tr>
                <th>Linha</th>
                <th className="text-right">{cur || "Período"}</th>
                {compare && <><th className="text-right">{prevLbl}</th><th className="text-right">Variação</th></>}
              </tr>
            </thead>
            <tbody>
              {(data?.lines || []).map((l) => (l.kind === "calc" ? (
                <tr key={l.key} data-testid={`fin-dre-calc-${l.key}`} style={{ background: "var(--fin-muted-soft)" }}>
                  <td className="font-semibold" style={{ color: "var(--fin-ink)", paddingLeft: 12 }}>
                    <span className="mr-1.5" style={{ color: "var(--fin-ink-3)" }}>=</span>{l.label}
                    {l.key === "resultado_liquido" && l.value !== 0 && (
                      <span className="ml-2 text-xs font-semibold" style={{ color: l.value < 0 ? "var(--fin-danger)" : "var(--fin-success)" }}>{l.value < 0 ? "Prejuízo" : "Lucro"}</span>
                    )}
                  </td>
                  {valueCells(l, true)}
                </tr>
              ) : groupRows(l, l.key)))}
              {unc?.count > 0 && (
                <>
                  <tr><td colSpan={cols} className="!py-1.5" /></tr>
                  <tr id="fin-dre-unclassified" data-testid="fin-dre-row-unclassified" style={{ background: "var(--fin-warning-soft)" }}>
                    {nodeLabel(<span style={{ color: "var(--fin-warning)" }}>Não classificado na DRE</span>, unc.count, !!open[`u:${NONE}`], unc.children.length > 0, 0,
                      () => toggle(`u:${NONE}`), "fin-dre-toggle-unclassified", true)}
                    {valueCells(unc, true)}
                  </tr>
                  {open[`u:${NONE}`] && unc.children.map((c) => {
                    const cp = `u:${NONE}/c:${c.key}`;
                    const subs = c.children || [];
                    const leaf = subs.length === 0;
                    return (
                      <Fragment key={cp}>
                        <tr>
                          {nodeLabel(c.label, c.count, !!open[cp], true, 1, () => toggle(cp, leaf ? { group: NONE, category: c.key } : null), `fin-dre-toggle-ucat-${c.key}`)}
                          {valueCells(c)}
                        </tr>
                        {leaf ? entryRows(cp, 2) : open[cp] && subs.map((sub) => {
                          const sp = `${cp}/s:${sub.key}`;
                          return (
                            <Fragment key={sp}>
                              <tr>
                                {nodeLabel(sub.label, sub.count, !!open[sp], true, 2, () => toggle(sp, { group: NONE, category: c.key, subcategory: sub.key }), `fin-dre-toggle-usub-${sub.key}`)}
                                {valueCells(sub)}
                              </tr>
                              {entryRows(sp, 3)}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
          {!loading && data && !data.lines.some((l) => l.kind === "group" && (l.value || l.prev)) && !unc?.count && (
            <EmptyState icon={FileBarChart} title="Nenhum lançamento com competência neste período">
              Associe suas categorias a um Grupo DRE em Configurações › Categorias para montar a DRE.
            </EmptyState>
          )}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--fin-ink-3)" }}>
          DRE gerencial para gestão interna — não substitui a DRE contábil oficial. Saldo bancário e datas de pagamento ficam no Fluxo de Caixa.
        </p>
      </Panel>
    </>
  );
}
