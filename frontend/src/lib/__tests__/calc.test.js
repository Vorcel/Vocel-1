import { computeRow, computeLote } from "../calc";

const base = {
  qtd: "1", valor_compra: "0", outros_sem_imp: "0", outros_com_imp: "0",
  frete_receber: "0", frete_enviar: "0", icms: "0", pis_cofins: "0",
  valor_venda: "", margem: "", mode: "margem",
};

test("Frete Receber SOMA ao custo (mesma mecânica do Frete Enviar)", () => {
  const c = computeRow({ ...base, valor_compra: "100", frete_receber: "50", margem: "0" });
  expect(c.custo_base_unit).toBeCloseTo(150, 2);
  // frete_enviar deve produzir o mesmo efeito
  const d = computeRow({ ...base, valor_compra: "100", frete_enviar: "50", margem: "0" });
  expect(d.custo_base_unit).toBeCloseTo(150, 2);
});

// PIS/COFINS "por dentro" (gross-up) embutido no PREÇO FINAL quando o preço é
// formado automaticamente. Base antes do PIS = Custo Total (margem 0 => = custo).
test("Teste A — gross-up PIS 10%: base 2000 => preço 2222,22, líquido preservado", () => {
  const c = computeRow({ ...base, valor_compra: "2000", pis_cofins: "10", margem: "0" });
  expect(c.valor_unidade).toBeCloseTo(2222.2222, 2);        // 2000 / (1 - 0,10)
  expect(c.pis_cofins_unit).toBeCloseTo(222.2222, 2);       // 2222,22 * 10%
  // Valor líquido preservado após pagar o imposto:
  expect(c.valor_unidade - c.pis_cofins_unit).toBeCloseTo(2000, 2);
});

test("Teste B — gross-up PIS 5,6%: base 2000 => preço 2118,64, líquido preservado", () => {
  const c = computeRow({ ...base, valor_compra: "2000", pis_cofins: "5.6", margem: "0" });
  expect(c.valor_unidade).toBeCloseTo(2118.6441, 2);        // 2000 / (1 - 0,056)
  expect(c.pis_cofins_unit).toBeCloseTo(118.6441, 2);
  expect(c.valor_unidade - c.pis_cofins_unit).toBeCloseTo(2000, 2);
});

test("Teste C — valor de venda MANUAL: 305 permanece, PIS 5,6% = 17,08 (sem gross-up)", () => {
  const c = computeRow({ ...base, mode: "venda", valor_venda: "305", pis_cofins: "5.6" });
  expect(c.valor_unidade).toBeCloseTo(305, 2);              // não vira outro preço
  expect(c.pis_cofins_unit).toBeCloseTo(17.08, 2);          // 305 * 5,6%
});

test("Teste D — alíquota zero: preço = base, PIS = 0 (sem NaN/Infinity)", () => {
  const c = computeRow({ ...base, valor_compra: "2000", pis_cofins: "0", margem: "0" });
  expect(c.valor_unidade).toBeCloseTo(2000, 2);
  expect(c.pis_cofins_unit).toBeCloseTo(0, 2);
  expect(Number.isFinite(c.valor_unidade)).toBe(true);
});

test("Cenário de referência (169/305, ICMS 18%, PIS 5,6%, frete 600, qtd 36, manual)", () => {
  const c = computeRow({
    ...base, qtd: "36", valor_compra: "169", icms: "18", pis_cofins: "5.6",
    frete_enviar: "600", mode: "venda", valor_venda: "305",
  });
  expect(c.pis_cofins_unit).toBeCloseTo(17.08, 2);
  expect(c.lucro_unit).toBeCloseTo(71.83, 2);   // 305 - (185,67 + 30,42) - 17,08
  expect(c.lucro_total).toBeCloseTo(2586.0, 1);
  expect(c.valor_total).toBeCloseTo(10980, 2);
});

test("ICMS por fora entra no Custo Total (preço/lucro)", () => {
  const c = computeRow({ ...base, valor_compra: "1000", icms: "10", mode: "venda", valor_venda: "1200" });
  expect(c.custo_base_unit).toBeCloseTo(1000, 2); // PIS=0 não altera
  // custoMaisImposto = 1000 + 100 (ICMS) = 1100 ; lucro = 1200 - 1100 = 100
  expect(c.lucro_unit).toBeCloseTo(100, 2);
  // Margem Real "por dentro" (sobre o preço): 100 / 1200
  expect(c.margem_real).toBeCloseTo((100 / 1200) * 100, 2);
});

test("Margem por dentro (markup divisor): Custo 100 + 10% = 111,11", () => {
  const c = computeRow({ ...base, valor_compra: "100", margem: "10" });
  expect(c.valor_unidade).toBeCloseTo(111.11, 2);
  expect(c.lucro_unit).toBeCloseTo(11.11, 2);
  expect(c.margem_real).toBeCloseTo(10, 2); // margem real = margem desejada
});

test("Lucro negativo quando preço de venda < custo total", () => {
  const c = computeRow({ ...base, valor_compra: "1000", mode: "venda", valor_venda: "500" });
  expect(c.lucro_unit).toBeLessThan(0);
  expect(c.lucro_total).toBeLessThan(0);
});

test("computeLote.valor_unitario soma o Valor da Unidade sem multiplicar pela quantidade", () => {
  // 3 linhas no lote 1, com quantidades diferentes; valor_unidade = valor_venda.
  const rows = [
    { ...base, selecionado: true, lote: 1, qtd: "30", mode: "venda", valor_venda: "1000" },
    { ...base, selecionado: true, lote: 1, qtd: "5", mode: "venda", valor_venda: "850" },
    { ...base, selecionado: true, lote: 1, qtd: "2", mode: "venda", valor_venda: "450" },
  ];
  const l = computeLote(rows, 1);
  expect(l.valor_unitario).toBeCloseTo(2300, 2); // 1000 + 850 + 450 (sem qtd)
  expect(l.valor_total).toBeCloseTo(1000 * 30 + 850 * 5 + 450 * 2, 2);
});

test("computeLote.valor_unitario separa por lote e ignora linhas não selecionadas", () => {
  const rows = [
    { ...base, selecionado: true, lote: 1, qtd: "1", mode: "venda", valor_venda: "1261.19" },
    { ...base, selecionado: true, lote: 2, qtd: "1", mode: "venda", valor_venda: "1363.25" },
    { ...base, selecionado: false, lote: 1, qtd: "1", mode: "venda", valor_venda: "9999" },
  ];
  expect(computeLote(rows, 1).valor_unitario).toBeCloseTo(1261.19, 2);
  expect(computeLote(rows, 2).valor_unitario).toBeCloseTo(1363.25, 2);
});

test("computeLote.valor_unitario = 0 quando o lote não tem linhas válidas", () => {
  expect(computeLote([], 1).valor_unitario).toBe(0);
});
