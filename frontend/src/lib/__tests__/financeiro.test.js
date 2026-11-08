// A camada HTTP não entra nestes testes (axios é ESM e não roda no Jest do CRA).
jest.mock("@/lib/api", () => ({ __esModule: true, default: {} }));

import { centsToInput, changeValue, fmtDate, money, parseMoney, splitInstallments } from "@/lib/financeiro";

describe("dinheiro em centavos", () => {
  test("parseMoney aceita formato brasileiro e ponto decimal", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney("R$ 1.000,00")).toBe(100000);
    expect(parseMoney("0,1")).toBe(10);
    expect(parseMoney("-1.500,00")).toBe(-150000);
    expect(parseMoney("19,995")).toBe(2000);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  test("parcelado: soma exata, diferença na última", () => {
    expect(splitInstallments(100000, 10)).toEqual(Array(10).fill(10000));
    expect(splitInstallments(100000, 3)).toEqual([33333, 33333, 33334]);
    const p = splitInstallments(999999, 7);
    expect(p.reduce((a, b) => a + b, 0)).toBe(999999);
  });

  test("formatação BRL", () => {
    expect(money(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(centsToInput(100000)).toBe("1.000,00");
    expect(fmtDate("2026-11-07")).toBe("07/11/2026");
    expect(changeValue("amount_cents", 500000).replace(/\s/g, " ")).toBe("R$ 5.000,00");
    expect(changeValue("due_date", "2026-11-20")).toBe("20/11/2026");
  });
});
