import { deadlineInfo, formatDueFull, formatSpan } from "@/lib/tasks";

const NOW = new Date(2026, 10, 19, 10, 0, 0); // 19/11/2026 10:00 local
const pad = (n) => String(n).padStart(2, "0");
const task = (minutes, extra = {}) => {
  const d = new Date(NOW.getTime() + minutes * 60000);
  return {
    status: "pendente", priority: "media",
    due_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    due_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    ...extra,
  };
};

describe("deadlineInfo (régua do prazo)", () => {
  test("mais de 6h: neutro", () => {
    expect(deadlineInfo(task(8 * 60), NOW)).toEqual({ tone: "neutral", text: "Hoje, 18:00" });
  });
  test("entre 6h e 2h: aviso discreto", () => {
    expect(deadlineInfo(task(4 * 60), NOW)).toMatchObject({ tone: "near", text: "Prazo próximo · 4h" });
  });
  test("prioridade Alta antecipa o amarelo para 4h", () => {
    expect(deadlineInfo(task(3 * 60 + 50, { priority: "alta" }), NOW)).toMatchObject({ tone: "soft" });
    expect(deadlineInfo(task(4 * 60 + 30, { priority: "alta" }), NOW)).toMatchObject({ tone: "near" });
  });
  test("faltam 1h40: amarelo suave", () => {
    expect(deadlineInfo(task(100), NOW)).toEqual({ tone: "soft", text: "Faltam 1h40" });
  });
  test("faltam 25 min: laranja com pulse", () => {
    expect(deadlineInfo(task(25), NOW)).toEqual({ tone: "warn", text: "Faltam 25 min", pulse: true });
  });
  test("venceu há 42 min: vermelho", () => {
    expect(deadlineInfo(task(-42), NOW)).toEqual({ tone: "late", text: "Atrasada há 42 min" });
  });
  test("concluída não tem alerta", () => {
    expect(deadlineInfo(task(-42, { status: "concluida" }), NOW).tone).toBe("done");
  });
  test("amanhã e outros dias", () => {
    expect(deadlineInfo(task(24 * 60), NOW).text).toBe("Amanhã, 10:00");
    expect(deadlineInfo(task(3 * 24 * 60), NOW).text).toBe("22/11, 10:00");
  });
});

test("Data final mostra a data/hora cadastrada", () => {
  expect(formatDueFull({ due_date: "2026-11-25", due_time: "17:00" })).toBe("25/11/2026 17:00");
});

test("formatSpan", () => {
  expect(formatSpan(42 * 60000)).toBe("42 min");
  expect(formatSpan(120 * 60000)).toBe("2h");
  expect(formatSpan(26 * 3600000)).toBe("1 dia");
});

describe("tag do pregão", () => {
  const { pregaoTag, modalidadeSigla } = require("@/lib/tasks");
  test("modalidade real abreviada + número com 3 dígitos", () => {
    expect(pregaoTag({ bid_id: "x", bid_pregao: "39/2026", bid_modalidade: "Pregão Eletrônico" })).toBe("PE 039/2026");
    expect(pregaoTag({ bid_id: "x", bid_pregao: "012/2026", bid_modalidade: "Pregão Presencial" })).toBe("PP 012/2026");
    expect(pregaoTag({ bid_id: "x", bid_pregao: "5/2026", bid_modalidade: "Concorrência Eletrônica" })).toBe("CE 005/2026");
  });
  test("sem vínculo ou sem número: sem tag", () => {
    expect(pregaoTag({ bid_id: null, bid_pregao: "1/2026" })).toBeNull();
    expect(pregaoTag({ bid_id: "x", bid_pregao: "" })).toBeNull();
  });
  test("siglas", () => {
    expect(modalidadeSigla("Tomada de Preços")).toBe("TP");
    expect(modalidadeSigla("Dispensa")).toBe("DL");
    expect(modalidadeSigla("Inexigibilidade")).toBe("IN");
    expect(modalidadeSigla("Registro de Preço Novo")).toBe("RPN");
    expect(modalidadeSigla("")).toBe("");
  });
});
