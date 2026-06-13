// Pricing engine for the ERP budget table (Tela 2).
// Tax-exclusive ("por fora") markup model: ICMS is applied on top of
// (Valor de Compra + Outros Gastos COM Imposto). Fully reversible between
// MARGEM DESEJADA (markup mode) and VALOR DE VENDA (sale mode).

export function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function computeRow(row) {
  const qtd = num(row.qtd) || 1;
  const icms_rate = num(row.icms) / 100;

  const outrosComUnit = num(row.outros_com_imp) / qtd;
  const outrosSemUnit = num(row.outros_sem_imp) / qtd;
  const freteUnit = (num(row.frete_enviar) - num(row.frete_receber)) / qtd;

  // Custo base por unidade (todos os custos)
  const custo_base_unit = num(row.valor_compra) + outrosComUnit + outrosSemUnit + freteUnit;

  // Imposto "POR FORA": ICMS aplicado sobre (Valor de Compra + Outros Gastos COM Imposto)
  const imposto_base = num(row.valor_compra) + outrosComUnit;
  const imposto_unit = imposto_base * icms_rate;

  const custoMaisImposto = custo_base_unit + imposto_unit;

  let valor_unidade = 0;
  if (row.mode === "venda" && row.valor_venda != null && row.valor_venda !== "") {
    // Gatilho pelo Valor de Venda Desejado
    valor_unidade = num(row.valor_venda);
  } else if (row.margem != null && row.margem !== "") {
    // Gatilho pela Margem Desejada: Preço = (Custo + Imposto) x (1 + Margem%)
    const m = num(row.margem) / 100;
    valor_unidade = custoMaisImposto * (1 + m);
  } else {
    valor_unidade = custoMaisImposto;
  }

  const lucro_unit = valor_unidade - custo_base_unit - imposto_unit;
  const margem_real = valor_unidade > 0 ? (lucro_unit / valor_unidade) * 100 : 0;
  // Markup implícito sobre (Custo + Imposto) — usado para exibir na "Margem Desejada"
  // quando o usuário dirige a linha pelo Valor de Venda.
  const markup = custoMaisImposto > 0 ? (valor_unidade / custoMaisImposto - 1) * 100 : 0;
  const valor_total = valor_unidade * qtd;
  const lucro_total = lucro_unit * qtd;

  return {
    custo_base_unit,
    imposto_unit,
    lucro_unit,
    valor_unidade,
    valor_total,
    lucro_total,
    margem_real,
    markup,
    margem_calc: margem_real,
    custo_total: custo_base_unit * qtd,
  };
}

export function computeTotals(rows) {
  let custo_global = 0;
  let valor_total = 0;
  let lucro_global = 0;
  rows.forEach((r) => {
    if (!r.selecionado) return;
    const c = computeRow(r);
    custo_global += c.custo_total;
    valor_total += c.valor_total;
    lucro_global += c.lucro_total;
  });
  const margem_media = valor_total > 0 ? (lucro_global / valor_total) * 100 : 0;
  return { custo_global, valor_total, lucro_global, margem_media };
}

export function brl(v) {
  return (num(v)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function pct(v) {
  return `${num(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
