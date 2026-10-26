import { TIMELINE_STEPS } from "@/lib/constants";
import {
  hasRemessas, unitsOf, execView, defaultRemessaId, resumoLabel, comparar, quantidades, fmtUnidades,
} from "../remessas";

// Timeline com `n` etapas concluídas (n = 11 => Pagamento Recebido concluído).
const tl = (n) => TIMELINE_STEPS.map((name, i) => ({
  step: i, name, status: i < n ? "Concluído" : i === n ? "Em Andamento" : "Pendente", files: [],
}));
const rem = (id, n, valor) => ({ id, nome: `Remessa ${id}`, timeline: tl(n), current_step: Math.min(n, 10), valor_empenho: valor });

describe("execução sem remessas (compatibilidade)", () => {
  const e = { bid_id: "b1", timeline: tl(3), current_step: 3, resumo_original: { produto: "Mouse", itens: 1, qtd: 2 } };
  it("vira uma Remessa 1 virtual com a própria execução", () => {
    expect(hasRemessas(e)).toBe(false);
    const [u] = unitsOf(e);
    expect(u.virtual).toBe(true);
    expect(u.nome).toBe("Remessa 1");
    expect(u.resumo).toEqual(e.resumo_original);
  });
  it("progresso e etapa = os de sempre", () => {
    const v = execView(e);
    expect(v.progress).toBe(Math.round((3 / 11) * 100));
    expect(v.stage).toBe(TIMELINE_STEPS[3]);
    expect(defaultRemessaId(e)).toBe(null);
  });
});

describe("licitação com remessas", () => {
  it("uma remessa paga NÃO conclui a licitação", () => {
    const v = execView({ remessas: [rem("1", 11, 5000), rem("2", 7, 6000)] });
    expect(v.progress).toBeLessThan(100);
    expect(v.stage).toBe("Em Transporte");
  });
  it("todas pagas => 100% (Concluídas)", () => {
    const v = execView({ remessas: [rem("1", 11, 5000), rem("2", 11, 6000)] });
    expect(v.progress).toBe(100);
    expect(v.stage).toBe("Pagamento Recebido");
  });
  it("reabrir uma remessa devolve a licitação para em andamento", () => {
    const v = execView({ remessas: [rem("1", 11, 5000), rem("2", 9, 6000)] });
    expect(v.progress).toBeLessThan(100);
    expect(v.stage).toBe("Aguardando Pagamento");
  });
  it("progresso ponderado pelo empenho (não média simples)", () => {
    // R1 100% com R$ 9.000 e R2 0% com R$ 1.000 => 90%, não 50%
    const v = execView({ remessas: [rem("1", 11, 9000), rem("2", 0, 1000)] });
    expect(v.progress).toBe(90);
  });
  it("nunca mostra 100% com remessa pendente", () => {
    const v = execView({ remessas: [rem("1", 11, 1000000), rem("2", 0, 1)] });
    expect(v.progress).toBe(99);
  });
  it("sem valores: média simples", () => {
    expect(execView({ remessas: [rem("1", 11, 0), rem("2", 0, 0)] }).progress).toBe(50);
  });
  it("remessa ativa padrão = primeira em andamento; todas pagas = última", () => {
    expect(defaultRemessaId({ remessas: [rem("1", 11, 1), rem("2", 3, 1), rem("3", 0, 1)] })).toBe("2");
    expect(defaultRemessaId({ remessas: [rem("1", 11, 1), rem("2", 11, 1)] })).toBe("2");
  });
});

describe("rótulos e comparações", () => {
  it("rótulo da remessa numa linha só", () => {
    expect(resumoLabel({ produto: "Telefone IP", itens: 1, qtd: 10 })).toBe("Telefone IP - 10 unidades");
    expect(resumoLabel({ produto: "Telefone IP", itens: 3, qtd: 30 })).toBe("Telefone IP + 2 itens - 30 unidades");
    expect(resumoLabel({ produto: "Mouse", itens: 1, qtd: 1 })).toBe("Mouse - 1 unidade");
    expect(fmtUnidades(2.5)).toBe("2,5 unidades");
  });
  it("saldo, igual e excedente (sem valor negativo)", () => {
    expect(comparar(10000, 8000)).toEqual({ tipo: "saldo", valor: 2000 });
    expect(comparar(10000, 10000)).toEqual({ tipo: "igual", valor: 0 });
    expect(comparar(10000, 11000)).toEqual({ tipo: "excedente", valor: 1000 });
  });
  it("quantidade: 5 + 6 contra 10 => excedente de 1 unidade", () => {
    const q = quantidades({ resumo_original: { qtd: 10 }, remessas: [{ resumo: { qtd: 5 } }, { resumo: { qtd: 6 } }] });
    expect(q).toMatchObject({ original: 10, remessas: 11, tipo: "excedente", valor: 1 });
    const s = quantidades({ resumo_original: { qtd: 10 }, remessas: [{ resumo: { qtd: 7 } }] });
    expect(s).toMatchObject({ tipo: "saldo", valor: 3 });
  });
});
