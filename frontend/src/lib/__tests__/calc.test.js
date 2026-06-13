import { computeRow } from "../calc";

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

test("PIS/COFINS por dentro (gross-up) no Custo Base Un.", () => {
  const c = computeRow({ ...base, valor_compra: "2500", pis_cofins: "10", margem: "0" });
  expect(c.custo_base_unit).toBeCloseTo(2777.78, 2);
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
