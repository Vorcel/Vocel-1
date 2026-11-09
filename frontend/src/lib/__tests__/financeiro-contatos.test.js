// A camada HTTP não entra nestes testes (axios é ESM e não roda no Jest do CRA).
jest.mock("@/lib/api", () => ({ __esModule: true, default: {} }));

import {
  contatoServe, dueAlert, flowOf, flowOfModule, fmtDocument, maskCep, maskDocument, maskPhone, validCnpj, validCpf,
} from "@/lib/financeiro";

describe("alerta de vencimento (saldo em aberto)", () => {
  const today = "2026-11-08";
  const e = (o) => ({ status: "pendente", amount_cents: 100000, settled_cents: 0, open_cents: 100000, due_date: today, ...o });
  test("vence hoje com saldo", () => expect(dueAlert(e(), today)).toBe("hoje"));
  test("atrasado com saldo", () => expect(dueAlert(e({ due_date: "2026-11-07" }), today)).toBe("atrasado"));
  test("futuro sem alerta", () => expect(dueAlert(e({ due_date: "2026-11-09" }), today)).toBeNull());
  test("parcial atrasado usa o saldo restante", () => {
    expect(dueAlert(e({ status: "parcial", amount_cents: 1000000, settled_cents: 800000, open_cents: 200000, due_date: "2026-11-07" }), today)).toBe("atrasado");
  });
  test("quitado/cancelado nunca destaca", () => {
    expect(dueAlert(e({ status: "pago", open_cents: 0, due_date: "2026-11-01" }), today)).toBeNull();
    expect(dueAlert(e({ status: "recebido", open_cents: 0, due_date: "2026-11-01" }), today)).toBeNull();
    expect(dueAlert(e({ status: "cancelado", due_date: "2026-11-01" }), today)).toBeNull();
    expect(dueAlert(e({ open_cents: 0, due_date: "2026-11-01" }), today)).toBeNull();
  });
});

describe("cor do valor", () => {
  test("pagar = saída, receber = entrada", () => {
    expect(flowOf("pagar")).toBe("out");
    expect(flowOf("receber")).toBe("in");
    expect(flowOf(undefined)).toBe("neutral");
    expect(flowOfModule("bancos")).toBe("neutral");
  });
});

describe("clientes e fornecedores", () => {
  test("papel compatível com o tipo do lançamento", () => {
    expect(contatoServe({ role: "fornecedor" }, "pagar")).toBe(true);
    expect(contatoServe({ role: "cliente" }, "pagar")).toBe(false);
    expect(contatoServe({ role: "ambos" }, "pagar")).toBe(true);
    expect(contatoServe({ role: "cliente" }, "receber")).toBe(true);
    expect(contatoServe({ role: "fornecedor" }, "receber")).toBe(false);
    expect(contatoServe({ role: "ambos" }, "receber")).toBe(true);
  });
  test("máscaras", () => {
    expect(maskDocument("52998224725", "pf")).toBe("529.982.247-25");
    expect(maskDocument("11222333000181", "pj")).toBe("11.222.333/0001-81");
    expect(maskDocument("1122233", "pj")).toBe("11.222.33");
    expect(fmtDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(fmtDocument("")).toBe("—");
    expect(maskPhone("11988887777")).toBe("(11) 98888-7777");
    expect(maskPhone("1133334444")).toBe("(11) 3333-4444");
    expect(maskCep("01310100")).toBe("01310-100");
  });
  test("dígitos verificadores", () => {
    expect(validCpf("529.982.247-25")).toBe(true);
    expect(validCpf("123.456.789-00")).toBe(false);
    expect(validCpf("111.111.111-11")).toBe(false);
    expect(validCnpj("11.222.333/0001-81")).toBe(true);
    expect(validCnpj("11.222.333/0001-80")).toBe(false);
  });
});
