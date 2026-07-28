import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Barra de rolagem horizontal fixa no rodapé da viewport para tabelas largas.
// Recebe `targetRef` — o elemento com overflow-x (o container rolável da tabela).
// Controla SOMENTE a rolagem horizontal desse container, sincronizada nos dois
// sentidos. Aparece apenas quando (1) há overflow horizontal real e (2) a barra
// nativa do container está abaixo da viewport (a rolagem vertical a escondeu) —
// por isso não duplica a barra em tabelas de altura fixa (ex.: Orçamento).
export function StickyHorizontalScrollbar({ targetRef }) {
  const barRef = useRef(null);
  const lock = useRef(false);
  const [box, setBox] = useState({ visible: false, left: 0, width: 0, scrollWidth: 0 });

  // Evita loop de eventos: enquanto sincronizamos um lado, ignoramos o eco do outro.
  const withLock = (fn) => {
    if (lock.current) return;
    lock.current = true;
    fn();
    requestAnimationFrame(() => { lock.current = false; });
  };

  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;

    const recompute = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const overflow = el.scrollWidth > el.clientWidth + 1;
      const nativeBelow = rect.bottom > vh - 1;      // barra nativa fora da tela
      const inView = rect.top < vh && rect.bottom > 0;
      const left = Math.max(rect.left, 0);
      setBox({
        visible: overflow && nativeBelow && inView,
        left,
        width: Math.max(0, Math.min(rect.right, vw) - left),
        scrollWidth: el.scrollWidth,
      });
      if (barRef.current && !lock.current) barRef.current.scrollLeft = el.scrollLeft;
    };

    const onTargetScroll = () => withLock(() => {
      if (barRef.current) barRef.current.scrollLeft = el.scrollLeft;
    });

    recompute();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(recompute) : null;
    ro?.observe(el);
    el.addEventListener("scroll", onTargetScroll, { passive: true });
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onTargetScroll);
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [targetRef]);

  const onBarScroll = () => withLock(() => {
    const el = targetRef.current;
    if (el && barRef.current) el.scrollLeft = barRef.current.scrollLeft;
  });

  return (
    <div
      ref={barRef}
      data-testid="sticky-hscroll"
      onScroll={onBarScroll}
      aria-hidden="true"
      className="fixed bottom-0 z-30 h-4 overflow-x-auto overflow-y-hidden border-t border-border bg-card/95 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur"
      style={{
        left: box.left,
        width: box.width,
        display: box.visible ? "block" : "none",
      }}
    >
      <div style={{ width: box.scrollWidth, height: 1 }} />
    </div>
  );
}
