import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useUndoHistory } from "../useUndoHistory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Simula a Planilha: `edit` = edição local (record + apply), `remote` = evento de
// outra sessão (só setRows, como o useBudgetSync faz), `applied` = o que o
// Desfazer/Refazer mandou gravar.
function mount(initialRows) {
  const api = {};
  const applied = [];
  function Harness() {
    const [rows, setRows] = useState(initialRows);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const apply = (id, patch) => {
      applied.push({ id, patch });
      setRows((p) => p.map((r) => (r._id === id ? { ...r, ...patch } : r)));
    };
    const h = useUndoHistory({ rows, rowsRef, apply });
    Object.assign(api, {
      rows, h,
      edit: (id, patch, ses) => { h.record(id, patch, ses); setRows((p) => p.map((r) => (r._id === id ? { ...r, ...patch } : r))); },
      remote: (id, patch) => setRows((p) => p.map((r) => (r._id === id ? { ...r, ...patch } : r))),
      drop: (id) => setRows((p) => p.filter((r) => r._id !== id)),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  return { api, applied, root };
}

const rowsBase = () => [
  { _id: "a", frete_enviar: "0", valor_compra: "500", produto: "" },
  { _id: "b", frete_enviar: "0", valor_compra: "700", produto: "" },
];

test("desfaz só a alteração local; a remota permanece", () => {
  const { api, applied } = mount(rowsBase());
  act(() => api.edit("a", { frete_enviar: "100" }));
  act(() => api.remote("a", { valor_compra: "850" })); // outra sessão
  act(() => api.h.undo());
  expect(applied).toEqual([{ id: "a", patch: { frete_enviar: "0" } }]);
  const a = api.rows.find((r) => r._id === "a");
  expect(a.frete_enviar).toBe("0");
  expect(a.valor_compra).toBe("850");
  expect(api.h.canUndo).toBe(false);
  expect(api.h.canRedo).toBe(true);
});

test("alterações remotas não entram no histórico", () => {
  const { api } = mount(rowsBase());
  act(() => {
    ["1", "2", "3", "4", "5"].forEach((v) => api.remote("b", { frete_enviar: v }));
  });
  expect(api.h.canUndo).toBe(false);
  expect(api.h.canRedo).toBe(false);
});

test("refazer reaplica e grava pelo mesmo caminho", () => {
  const { api, applied } = mount(rowsBase());
  act(() => api.edit("a", { frete_enviar: "100" }));
  act(() => api.h.undo());
  act(() => api.h.redo());
  expect(applied[1]).toEqual({ id: "a", patch: { frete_enviar: "100" } });
  expect(api.rows[0].frete_enviar).toBe("100");
  expect(api.h.canUndo).toBe(true);
  expect(api.h.canRedo).toBe(false);
});

test("nova edição depois de desfazer limpa o Refazer", () => {
  const { api } = mount(rowsBase());
  act(() => api.edit("a", { frete_enviar: "100" }));
  act(() => api.h.undo());
  act(() => api.edit("b", { produto: "Mouse" }));
  expect(api.h.canRedo).toBe(false);
  expect(api.h.canUndo).toBe(true);
});

test("commits da mesma edição de célula viram um passo só", () => {
  const { api, applied } = mount(rowsBase());
  act(() => api.edit("a", { produto: "mou" }, 7));      // salvamento durante a digitação
  act(() => api.edit("a", { produto: "mouse" }, 7));
  act(() => api.edit("a", { produto: "Mouse" }, 7));    // commit final (Title Case)
  act(() => api.h.undo());
  expect(applied).toEqual([{ id: "a", patch: { produto: "" } }]);
  expect(api.h.canUndo).toBe(false);
});

test("venda/margem/mode voltam juntos", () => {
  const { api, applied } = mount([{ _id: "a", valor_venda: "", margem: "30", mode: "margem" }]);
  act(() => api.edit("a", { valor_venda: "120", margem: "", mode: "venda" }));
  act(() => api.h.undo());
  expect(applied[0].patch).toEqual({ valor_venda: "", margem: "30", mode: "margem" });
});

test("linha excluída sai do histórico (nada é recriado)", () => {
  const { api, applied } = mount(rowsBase());
  act(() => api.edit("a", { frete_enviar: "100" }));
  act(() => api.drop("a"));
  expect(api.h.canUndo).toBe(false);
  act(() => api.h.undo());
  expect(applied).toEqual([]);
});

test("edição sem mudança de valor não gera histórico", () => {
  const { api } = mount(rowsBase());
  act(() => api.edit("a", { frete_enviar: "0" }));
  expect(api.h.canUndo).toBe(false);
});
