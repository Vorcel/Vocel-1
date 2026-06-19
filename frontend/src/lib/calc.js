// Pricing engine for the ERP budget table (Tela 2).
// Cost model: PIS/COFINS embutido "por dentro" (gross-up) no Custo Base Un.;
// ICMS somado "por fora" sobre (Valor Compra + Outros C/ Imposto), formando o
// Custo Total. Margem "por dentro": Preço = Custo Total / (1 - Margem%/100);
// Margem Real = (Preço - Custo Total) / Preço.

export function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function computeRow(row) {
  const qtdRaw = num(row.qtd);
  const active = qtdRaw > 0;            // Trava: quantidade 0/vazia não calcula totais
  const qtd = active ? qtdRaw : 1;      // divisor seguro p/ rateio por unidade
  const icms_rate = num(row.icms) / 100;
  const pis_rate = num(row.pis_cofins) / 100;

  const outrosComUnit = num(row.outros_com_imp) / qtd;
  const outrosSemUnit = num(row.outros_sem_imp) / qtd;
  // Frete: tanto "Frete Enviar" quanto "Frete Receber" SOMAM ao custo (mesma mecânica).
  const freteUnit = (num(row.frete_enviar) + num(row.frete_receber)) / qtd;

  // Custo Inicial (sem imposto): Produto + Frete + Outros Gastos
  const custo_inicial = num(row.valor_compra) + outrosComUnit + outrosSemUnit + freteUnit;

  // Custo Base Un.: PIS/COFINS "POR DENTRO" (gross-up) embutido na própria base.
  // Custo Base = Custo Inicial / (1 - PIS%/100)
  const pis_div = 1 - pis_rate;
  const custo_base_unit = pis_div > 0 ? custo_inicial / pis_div : custo_inicial;

  // ICMS "POR FORA": aplicado sobre (Valor de Compra + Outros Gastos COM Imposto).
  // Não é exibido isoladamente; entra no Custo Total que serve de base para a margem.
  const imposto_icms = (num(row.valor_compra) + outrosComUnit) * icms_rate;

  // Custo Total = Custo Base Un. (com PIS por dentro) + ICMS por fora
  const custoMaisImposto = custo_base_unit + imposto_icms;

  let valor_unidade = 0;
  if (row.mode === "venda" && row.valor_venda != null && row.valor_venda !== "") {
    // Gatilho pelo Valor de Venda Desejado
    valor_unidade = num(row.valor_venda);
  } else if (row.margem != null && row.margem !== "") {
    // Margem "POR DENTRO" (markup divisor / gross-up):
    // Preço = Custo Total / (1 - Margem%/100)
    const m = num(row.margem) / 100;
    valor_unidade = m < 1 ? custoMaisImposto / (1 - m) : 0;
  } else {
    valor_unidade = custoMaisImposto;
  }

  const lucro_unit = valor_unidade - custoMaisImposto;
  // Margem Real "por dentro" (sobre o Preço de Venda): (Preço - Custo Total) / Preço
  const margem_real = valor_unidade > 0 ? (lucro_unit / valor_unidade) * 100 : 0;
  // Totais zerados quando a quantidade é 0/vazia (Req: trava de cálculo).
  const valor_total = active ? valor_unidade * qtd : 0;
  const lucro_total = active ? lucro_unit * qtd : 0;

  return {
    custo_base_unit,
    imposto_icms,
    lucro_unit,
    valor_unidade,
    valor_total,
    lucro_total,
    margem_real,
    margem_calc: margem_real,
    custo_total: active ? custo_base_unit * qtd : 0,
    investido: active ? custoMaisImposto * qtd : 0,
  };
}

// Agrega valores de um lote específico considerando APENAS linhas marcadas
// (selecionado) E pertencentes àquele lote.
export function computeLote(rows, lote) {
  let valor_total = 0;
  let lucro = 0;
  let investido = 0;
  rows.forEach((r) => {
    if (!r.selecionado) return;
    if ((num(r.lote) || 1) !== lote) return;
    const c = computeRow(r);
    valor_total += c.valor_total;
    lucro += c.lucro_total;
    investido += c.investido;
  });
  const margem = valor_total > 0 ? (lucro / valor_total) * 100 : 0;
  return { lote, valor_total, lucro, investido, margem };
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
