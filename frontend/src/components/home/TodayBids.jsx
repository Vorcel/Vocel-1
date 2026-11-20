import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Gavel, Landmark, Layers } from "lucide-react";
import { useData } from "@/context/DataContext";
import { fileUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

// Cards "Licitações do Dia" (REF1): interior claro, borda fina em gradiente ao
// redor de todo o card + faixa mais espessa à esquerda, logo do portal em bloco
// branco, horário em destaque, data, objeto, itens e (secundários) UASG/Pregão.
// As cores alternam entre os cards; a cor fica na borda, na faixa e em detalhes.
const PALETTE = [
  { a: "#2563EB", b: "#60A5FA", light: "#BFDBFE", bg: "#F3F8FF", chip: "#E2ECFD", ink: "#1E3A8A" },  // azul
  { a: "#EA7A0C", b: "#F6B042", light: "#FDE3B8", bg: "#FFF8F0", chip: "#FBE9D3", ink: "#7C3A06" },  // laranja/dourado
  { a: "#16A34A", b: "#4ADE80", light: "#BBF7D0", bg: "#F2FBF4", chip: "#DDF3E3", ink: "#14532D" },  // verde
  { a: "#7C3AED", b: "#A78BFA", light: "#DDD6FE", bg: "#F7F5FF", chip: "#EAE5FC", ink: "#4C1D95" },  // violeta
  { a: "#0D9488", b: "#2DD4BF", light: "#B6EFE6", bg: "#F0FBF9", chip: "#D9F2EE", ink: "#134E4A" },  // teal
  { a: "#E11D48", b: "#FB7185", light: "#FECDD3", bg: "#FFF5F7", chip: "#FCE3E8", ink: "#881337" },  // rosa
];

// Densidade conforme a quantidade de cards na linha (até 5 cabem lado a lado).
const DENSITY = {
  normal: { pad: "pl-[18px] pr-3.5 py-3", logo: 56, gap: "gap-3.5", time: "text-[22px]", date: "text-[13px]", obj: "text-[16px]", meta: "text-[12.5px]", icon: 19, chev: 28, metaGap: "gap-x-2" },
  compact: { pad: "pl-[16px] pr-3 py-2.5", logo: 48, gap: "gap-3", time: "text-[20px]", date: "text-[12px]", obj: "text-[15px]", meta: "text-[11.5px]", icon: 17, chev: 26, metaGap: "gap-x-1.5", stack: true },
  tight: { pad: "pl-[13px] pr-2 py-2.5", logo: 40, gap: "gap-2", time: "text-[18px]", date: "text-[11.5px]", obj: "text-[14px]", meta: "text-[10.5px]", icon: 15, chev: 22, metaGap: "gap-x-1.5", shortDate: true, stack: true },
};

function layoutFor(n, narrow) {
  // Celular/tablet estreito: cards compactos, ~82% da tela, rolagem com swipe.
  if (narrow) return { density: "compact", flex: n === 1 ? "1 1 auto" : "0 0 auto", minW: 290, width: n === 1 ? undefined : "min(340px, 82vw)", gap: 12 };
  if (n <= 1) return { density: "normal", flex: "0 1 560px", minW: 300, gap: 16 };
  if (n <= 3) return { density: "normal", flex: "1 1 0", minW: 300, gap: 16 };
  if (n === 4) return { density: "compact", flex: "1 1 0", minW: 255, gap: 12 };
  if (n === 5) return { density: "tight", flex: "1 1 0", minW: 222, gap: 10 };
  return { density: "compact", flex: "0 0 290px", minW: 290, gap: 12 };   // 6+: rolagem horizontal
}

const fmtDate = (s, short) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return short ? `${d}/${m}` : `${d}/${m}/${y}`;
};

function PortalLogo({ portal, item, size, color }) {
  const [broken, setBroken] = useState(false);
  const src = item?.logo && !broken ? fileUrl(item.logo) : null;
  useEffect(() => setBroken(false), [item?.logo]);
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.18)] ring-1 ring-black/5"
      style={{ width: size, height: size }}
      title={portal}
    >
      {src ? (
        <img src={src} alt={portal || "Portal"} onError={() => setBroken(true)}
          className="h-full w-full object-contain p-1.5" draggable={false} />
      ) : (
        // Sem logo (ou imagem indisponível): ícone genérico + nome curto do portal.
        <>
          <Landmark size={Math.round(size * 0.42)} style={{ color }} aria-hidden />
          {size >= 48 && portal && (
            <span className="mt-0.5 w-full truncate px-1 text-center text-[8.5px] font-semibold leading-tight text-slate-500">{portal}</span>
          )}
        </>
      )}
    </div>
  );
}

function BidCard({ bid, index, layout, portalItem }) {
  const navigate = useNavigate();
  const c = PALETTE[index % PALETTE.length];
  const d = DENSITY[layout.density];
  const nItens = (bid.itens_list || []).length;
  const open = () => navigate(`/orcamento/${bid.id}`);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
      data-testid={`today-alert-${bid.id}`}
      aria-label={`${bid.hora || ""} ${bid.objeto || ""} — abrir orçamento`}
      title="Abrir orçamento"
      className="today-bid-card group relative flex min-w-0 shrink-0 snap-start cursor-pointer items-center rounded-2xl transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        flex: layout.flex,
        width: layout.width,
        minWidth: `min(${layout.minW}px, 82vw)`,
        "--tb-bg": c.bg,
        "--tb-border": `linear-gradient(115deg, ${c.a} 0%, ${c.light} 38%, ${c.b} 62%, ${c.a} 100%)`,
        "--tb-shadow": `0 8px 18px -12px ${c.a}88, 0 2px 6px -3px ${c.a}33`,
        "--tw-ring-color": c.a,
      }}
    >
      {/* Faixa extra, mais espessa, na lateral esquerda */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[7px] rounded-l-[14px]"
        style={{ background: `linear-gradient(180deg, ${c.b}, ${c.a} 55%, ${c.a})` }} />

      <div className={cn("flex w-full min-w-0 items-center", d.pad, d.gap)}>
        <PortalLogo portal={bid.portal} item={portalItem} size={d.logo} color={c.a} />
        <span aria-hidden className="h-[70%] w-px shrink-0 self-center bg-slate-300/70 dark:bg-border" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[#0F1B3D] dark:text-foreground" style={{ paddingRight: d.chev + 4 }}>
            <Clock size={d.icon} strokeWidth={2.2} className="shrink-0" style={{ color: c.ink }} aria-hidden />
            <span className={cn("font-mono-num font-extrabold leading-none tracking-tight", d.time)}>{bid.hora || "--:--"}</span>
            {bid.data_disputa && (
              <span className={cn("truncate font-semibold leading-none", d.date)}>
                <span className="mx-1 opacity-70">•</span>{fmtDate(bid.data_disputa, d.shortDate)}
              </span>
            )}
          </div>
          <h3 className={cn("mt-1 truncate font-bold leading-snug text-[#0F1B3D] dark:text-foreground", d.obj)} title={bid.objeto}>
            {bid.objeto}
          </h3>
          {(() => {
            const chip = nItens > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-[1px] font-bold" style={{ backgroundColor: c.chip, color: c.ink }}>
                <Layers size={d.stack ? 11 : 12} aria-hidden /> {nItens} {nItens === 1 ? "item" : "itens"}
              </span>
            );
            const sec = [
              bid.uasg && { k: "u", text: `UASG ${bid.uasg}` },
              bid.pregao && { k: "p", text: `${d.shortDate ? "PE" : "Pregão"} ${bid.pregao}` },
            ].filter(Boolean);
            const sep = <span aria-hidden className="h-3 w-px shrink-0 bg-slate-300 dark:bg-border" />;
            const secSpans = sec.map((x, i) => (
              <span key={x.k} className="contents">
                {(i > 0 || (!d.stack && chip)) && sep}
                <span className="min-w-0 truncate font-mono-num" title={x.text}>{x.text}</span>
              </span>
            ));
            const row = cn("flex min-w-0 flex-nowrap items-center whitespace-nowrap text-slate-600 dark:text-muted-foreground", d.metaGap, d.meta);
            // 5 cards (tight): itens numa linha e UASG · Pregão logo abaixo — nada é cortado.
            return d.stack ? (
              <>
                {chip && <div className={cn("mt-1", row)}>{chip}</div>}
                {sec.length > 0 && <div className={cn("mt-1", row)}>{secSpans}</div>}
              </>
            ) : (
              <div className={cn("mt-1.5", row)}>{chip}{secSpans}</div>
            );
          })()}
        </div>

        <span aria-hidden style={{ width: d.chev, height: d.chev }}
          className="absolute right-2.5 top-2.5 flex items-center justify-center rounded-full bg-slate-900/[0.06] text-[#0F1B3D] transition-colors group-hover:bg-slate-900/10 dark:bg-white/10 dark:text-foreground">
          <ChevronDown size={d.chev > 24 ? 16 : 14} strokeWidth={2.4} />
        </span>
      </div>
    </div>
  );
}

// Faixa dos cards: 1–5 lado a lado (compactando 4 e 5); 6+ = rolagem horizontal
// (nenhum card é escondido). Telas estreitas também rolam na horizontal.
export function TodayBids({ bids }) {
  const { lists } = useData();
  const scrollRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const layout = layoutFor(bids.length, narrow);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [bids.length]);

  const scrollBy = (dir) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };

  const portalOf = (nome) => (lists.portais || []).find((p) => p.nome === nome);

  return (
    <section data-testid="today-bids" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Gavel size={21} className="text-[#1E3A8A] dark:text-sky-400" aria-hidden />
        <h2 className="font-heading text-lg font-bold text-foreground">Licitações do Dia</h2>
        <span data-testid="today-bids-count" className="min-w-[22px] rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-semibold text-foreground/80">
          {bids.length}
        </span>
      </div>

      {bids.length === 0 ? (
        <div className="flex h-[88px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          Nenhuma sessão de disputa agendada para hoje.
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollRef}
            data-testid="today-bids-strip"
            data-count={bids.length}
            className="today-bids-scroll flex snap-x snap-mandatory overflow-x-auto px-0.5 pb-2 pt-0.5"
            style={{ gap: layout.gap }}
          >
            {bids.map((b, i) => (
              <BidCard key={b.id} bid={b} index={i} layout={layout} portalItem={portalOf(b.portal)} />
            ))}
          </div>
          {edges.left && (
            <button type="button" onClick={() => scrollBy(-1)} aria-label="Ver licitações anteriores" data-testid="today-bids-prev"
              className="absolute left-0 top-1/2 flex h-8 w-8 -translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-md hover:bg-accent">
              <ChevronLeft size={17} />
            </button>
          )}
          {edges.right && (
            <button type="button" onClick={() => scrollBy(1)} aria-label="Ver próximas licitações" data-testid="today-bids-next"
              className="absolute right-0 top-1/2 flex h-8 w-8 translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-md hover:bg-accent">
              <ChevronRight size={17} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
