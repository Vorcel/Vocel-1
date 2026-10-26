import { digitsOnly, matchesDigits } from "../search";

describe("digitsOnly", () => {
  it("mantém só os dígitos", () => {
    expect(digitsOnly("023/2026")).toBe("0232026");
    expect(digitsOnly(" 023 - 2026. ")).toBe("0232026");
    expect(digitsOnly(null)).toBe("");
    expect(digitsOnly(160123)).toBe("160123");
  });
});

describe("matchesDigits — Pregão", () => {
  const salvo = "023/2026";
  it.each(["023/2026", "023 2026", "0232026", "023 / 2026", "023-2026", "023.2026", "2026", "023"])(
    "'%s' encontra 023/2026",
    (q) => expect(matchesDigits(salvo, q)).toBe(true)
  );
  it("não encontra número diferente", () => {
    expect(matchesDigits(salvo, "024/2026")).toBe(false);
    expect(matchesDigits("", "023")).toBe(false);
  });
  it("normaliza também o valor salvo", () => {
    expect(matchesDigits("90.023 / 2026", "900232026")).toBe(true);
  });
});

describe("matchesDigits — UASG", () => {
  it.each(["123 456", "123456", "123-456", "123.456"])("'%s' encontra 123456", (q) => {
    expect(matchesDigits("123456", q)).toBe(true);
    expect(matchesDigits("123 456", q)).toBe(true);
  });
});

describe("matchesDigits — busca sem dígitos", () => {
  it("cai na comparação textual (não 'acha tudo')", () => {
    expect(matchesDigits("SRP 10/2026", "srp")).toBe(true);
    expect(matchesDigits("10/2026", "abc")).toBe(false);
  });
});
