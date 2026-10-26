// Desfazer / Refazer da Planilha de Orçamento — histórico LOCAL desta sessão.
//
// - Só entram edições feitas AQUI: a página chama `record` no mesmo ponto em que
//   envia a edição do usuário (updateRow). Eventos remotos (WebSocket/resync) só
//   passam por setRows dentro do useBudgetSync e nunca chegam aqui — então uma
//   sessão jamais desfaz o trabalho de outra.
// - Cada entrada = UMA linha + os campos alterados: { rowId, before, after }.
//   `before` é lido da tela no momento da edição (já com o que veio de outras
//   sessões até ali).
// - Desfazer/Refazer NÃO têm caminho próprio de gravação: `apply(rowId, patch)` é
//   o mesmo envio de uma edição comum (fila granular + WebSocket + recálculo pelo
//   calc.js), sem passar por `record`. Ou seja, é uma nova alteração local válida,
//   que persiste e sincroniza como qualquer outra (last-write-wins por campo).
// - `session`: commits da MESMA edição de célula (salvamento durante a digitação +
//   o commit final no blur/Enter) viram UMA entrada — um clique desfaz a edição.
// - Nova edição depois de desfazer limpa o Refazer (comportamento padrão).
// - Entradas de linhas que deixaram de existir (excluídas aqui ou em outra
//   sessão) são descartadas: nada é recriado pelo Desfazer.
import { useCallback, useEffect, useRef, useState } from "react";

const LIMIT = 100;

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row?.[k]]));
const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

export function useUndoHistory({ rows, rowsRef, apply }) {
  const stacks = useRef({ undo: [], redo: [] });
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const record = useCallback((rowId, patch, session) => {
    const cur = rowsRef.current.find((r) => r._id === rowId);
    if (!cur) return;
    const keys = Object.keys(patch);
    const before = pick(cur, keys);
    if (same(before, patch)) return; // nada mudou
    const s = stacks.current;
    const top = s.undo[s.undo.length - 1];
    if (session && top && top.session === session && top.rowId === rowId) {
      // Mesma edição de célula: mantém o "antes" original e atualiza o "depois".
      const merged = {
        ...top,
        before: { ...pick(cur, keys.filter((k) => !(k in top.before))), ...top.before },
        after: { ...top.after, ...patch },
      };
      if (same(merged.before, merged.after)) s.undo.pop(); // voltou ao valor inicial
      else s.undo[s.undo.length - 1] = merged;
    } else {
      s.undo.push({ rowId, before, after: { ...patch }, session });
      if (s.undo.length > LIMIT) s.undo.shift();
    }
    s.redo = [];
    bump();
  }, [rowsRef]);

  const step = (from, to, side) => {
    const s = stacks.current;
    while (s[from].length) {
      const e = s[from].pop();
      if (!rowsRef.current.some((r) => r._id === e.rowId)) continue; // linha excluída: descarta
      applyRef.current(e.rowId, { ...e[side] });
      s[to].push(e);
      break;
    }
    bump();
  };
  const undo = () => step("undo", "redo", "before");
  const redo = () => step("redo", "undo", "after");

  // Linha removida (aqui ou em outra sessão): as entradas dela saem do histórico,
  // para os botões não ficarem habilitados sem ter o que fazer.
  useEffect(() => {
    const s = stacks.current;
    if (!s.undo.length && !s.redo.length) return;
    const ids = new Set(rows.map((r) => r._id));
    const u = s.undo.filter((e) => ids.has(e.rowId));
    const r = s.redo.filter((e) => ids.has(e.rowId));
    if (u.length !== s.undo.length || r.length !== s.redo.length) {
      s.undo = u;
      s.redo = r;
      bump();
    }
  }, [rows]);

  return {
    record, undo, redo,
    canUndo: stacks.current.undo.length > 0,
    canRedo: stacks.current.redo.length > 0,
  };
}
