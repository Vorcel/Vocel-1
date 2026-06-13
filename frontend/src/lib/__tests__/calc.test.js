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
  expect(c.margem_real).toBeCloseTo((100 / 1100) * 100, 2);
});

test("Margem Real = Margem Desejada (markup sobre Custo Total)", () => {
  const c = computeRow({ ...base, valor_compra: "100", margem: "30" });
  expect(c.valor_unidade).toBeCloseTo(130, 2);
  expect(c.margem_real).toBeCloseTo(30, 2);
});

test("Lucro negativo quando preço de venda < custo total", () => {
  const c = computeRow({ ...base, valor_compra: "1000", mode: "venda", valor_venda: "500" });
  expect(c.lucro_unit).toBeLessThan(0);
  expect(c.lucro_total).toBeLessThan(0);
});
