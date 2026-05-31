// Pricing engine for the ERP budget table (Tela 2).
// Tax-inclusive ("por dentro") markup model that is fully reversible
// between MARGEM % (margin mode) and VALOR DE VENDA (sale mode).

export function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function computeRow(row) {
  const qtd = num(row.qtd) || 1;
  const t = (num(row.icms) + num(row.pis_cofins)) / 100; // total tax rate
  const extras =
    (num(row.outros_sem_imp) + num(row.outros_com_imp) + num(row.frete_enviar) - num(row.frete_receber)) / qtd;
  const custo_base_unit = num(row.valor_compra) + extras;

  let valor_unidade = 0;
  let margem = 0;

  if (row.mode === "venda" && row.valor_venda != null && row.valor_venda !== "") {
    valor_unidade = num(row.valor_venda);
    margem = valor_unidade > 0 ? ((valor_unidade * (1 - t) - custo_base_unit) / valor_unidade) * 100 : 0;
  } else if (row.margem != null && row.margem !== "") {
    const m = num(row.margem) / 100;
    const denom = 1 - t - m;
    valor_unidade = denom > 0 ? custo_base_unit / denom : 0;
    margem = num(row.margem);
  }

  const lucro_unit = valor_unidade * (1 - t) - custo_base_unit;
  const valor_total = valor_unidade * qtd;
  const lucro_total = lucro_unit * qtd;

  return {
    custo_base_unit,
    lucro_unit,
    valor_unidade,
    valor_total,
    lucro_total,
    margem_calc: margem,
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
