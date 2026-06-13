import { useCallback, useRef, useState } from "react";

// Hook managing per-column pixel widths, persisted to localStorage.
export function useColumnResize(storageKey, defaults) {
  const [widths, setWidths] = useState(() => {
    try {
      const s = localStorage.getItem(storageKey);
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length === defaults.length) return parsed;
      }
    } catch { /* ignore */ }
    return defaults;
  });

  const ref = useRef(widths);
  ref.current = widths;

  const startResize = useCallback((index, syncIndices = null) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = ref.current[index];
    // Quando a coluna arrastada faz parte de uma seleção múltipla, aplica a
    // mesma largura (em pixels) a todas as colunas selecionadas.
    const targets =
      Array.isArray(syncIndices) && syncIndices.includes(index) ? syncIndices : [index];
    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const w = Math.max(56, startW + delta);
      const next = [...ref.current];
      targets.forEach((i) => { next[i] = w; });
      setWidths(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try { localStorage.setItem(storageKey, JSON.stringify(ref.current)); } catch { /* ignore */ }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [storageKey]);

  const total = widths.reduce((a, b) => a + b, 0);
  return { widths, startResize, total };
}

// Small drag handle rendered at the right edge of a <th>.
export const ColResizer = ({ onMouseDown }) => (
  <span
    onMouseDown={onMouseDown}
    className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none touch-none hover:bg-brand/40"
    data-testid="col-resizer"
  />
);
