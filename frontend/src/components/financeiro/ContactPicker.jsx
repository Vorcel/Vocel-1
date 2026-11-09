import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { PAPEIS, finApi, fmtDocument } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { keepScroll } from "./ui";

const PAPEL_DO_TIPO = { pagar: "fornecedor", receber: "cliente" };

// Autocomplete de Cliente/Fornecedor do lançamento: SÓ seleciona cadastros.
// Busca no servidor (nome ou CPF/CNPJ, debounce 300 ms), filtrada pelo tipo
// do lançamento (A Pagar: fornecedor | ambos; A Receber: cliente | ambos) e
// sem inativos. O texto digitado nunca vira vínculo: quem usa o componente
// recebe `text` + `value` e bloqueia o salvar se houver texto sem seleção.
//   value: { id, name, role, ativo? } | null
//   onCreate(text): abre o cadastro rápido (mesmo ContactModal das Configurações)
export function ContactPicker({ type, value, onSelect, text, onText, invalid, onCreate, testid = "fin-contact-picker", disabled }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const papel = PAPEL_DO_TIPO[type] || "cliente";
  const query = value ? "" : text;

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      finApi.contatos({ q: query || undefined, type, page_size: 50 })
        .then((d) => { if (alive) { setItems(d.items); setActive(0); } })
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [open, query, type]);

  const choose = (c) => {
    onSelect(c);
    onText(c.name);
    setOpen(false);
  };
  const clear = () => { onSelect(null); onText(""); inputRef.current?.focus(); };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    }
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: value ? "var(--fin-primary)" : "var(--fin-ink-3)" }}>
            {value ? <UserRound size={15} /> : <Search size={15} />}
          </span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            disabled={disabled}
            value={text}
            data-testid={testid}
            placeholder="Digite para buscar..."
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onChange={(e) => { if (value) onSelect(null); onText(e.target.value); setOpen(true); }}
            className={cn("h-10 w-full rounded-lg border bg-[var(--fin-surface)] pl-9 pr-9 text-sm outline-none transition-colors focus:border-[var(--fin-primary)] focus:ring-2 focus:ring-[var(--fin-primary-soft)] disabled:opacity-60",
              value && "font-medium")}
            style={{ borderColor: invalid ? "var(--fin-danger)" : "var(--fin-border)", color: "var(--fin-ink)" }}
          />
          {(value || text) && !disabled && (
            <button type="button" onClick={clear} title="Limpar" data-testid={`${testid}-clear`}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md hover:bg-[var(--fin-muted-soft)]"
              style={{ color: "var(--fin-ink-3)" }}>
              <X size={14} />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} collisionPadding={12} {...keepScroll}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => { if (e.target === inputRef.current) e.preventDefault(); }}
        className="fin-scope w-[var(--radix-popover-trigger-width)] min-w-[260px] max-w-[calc(100vw-24px)] p-1.5"
        style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
        <ul role="listbox" className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]" data-testid={`${testid}-list`}>
          {items.map((c, i) => (
            <li key={c.id} role="option" aria-selected={value?.id === c.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c)} onMouseEnter={() => setActive(i)}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                data-testid={`${testid}-opt-${c.id}`}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm"
                style={{ background: i === active ? "var(--fin-muted-soft)" : "transparent", color: "var(--fin-ink)" }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--fin-ink-3)" }}>
                    {[c.document && fmtDocument(c.document), PAPEIS[c.role]].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {value?.id === c.id && <Check size={15} style={{ color: "var(--fin-primary)" }} />}
              </button>
            </li>
          ))}
        </ul>
        {loading && !items.length && (
          <p className="flex items-center gap-2 px-2.5 py-2 text-xs" style={{ color: "var(--fin-ink-3)" }}><Loader2 size={13} className="animate-spin" /> Buscando…</p>
        )}
        {!loading && !items.length && (
          <p className="px-2.5 py-2 text-xs" style={{ color: "var(--fin-ink-3)" }}>
            {query ? `Nenhum ${papel} encontrado para "${query}".` : `Nenhum ${papel} cadastrado ainda.`}
          </p>
        )}
        {onCreate && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onCreate(value ? "" : text); }}
            data-testid={`${testid}-create`}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t px-2.5 pb-1.5 pt-2 text-sm font-semibold hover:bg-[var(--fin-primary-soft)]"
            style={{ color: "var(--fin-primary)", borderColor: "var(--fin-border)" }}>
            <Plus size={15} /> Cadastrar {papel}{query ? ` "${query}"` : ""}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Rótulo do campo com o atalho discreto "+ Cadastrar fornecedor/cliente".
export function ContactFieldLabel({ type, onCreate, testid = "fin-contact-quick" }) {
  const papel = PAPEL_DO_TIPO[type] || "cliente";
  return (
    <span className="flex items-center justify-between gap-2">
      <span>{papel === "fornecedor" ? "Fornecedor" : "Cliente"}</span>
      {onCreate && (
        <button type="button" onClick={(e) => { e.preventDefault(); onCreate(); }} data-testid={testid}
          className="inline-flex items-center gap-0.5 text-xs font-semibold hover:underline" style={{ color: "var(--fin-primary)" }}>
          <Plus size={13} /> Cadastrar {papel}
        </button>
      )}
    </span>
  );
}
