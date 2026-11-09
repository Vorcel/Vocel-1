import { useState } from "react";
import { Check, ChevronDown, CreditCard, History } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { activeOptions, useFinance } from "@/context/FinanceContext";
import { fileUrl } from "@/lib/api";
import { cardLabel, isFormaCartaoGenerica, paymentValue } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import { BankLogo, FinIcon } from "./icons";
import { ChipSelect, keepScroll } from "./ui";

function CardThumb({ card, size = "sm" }) {
  const cls = size === "sm" ? "h-[18px] w-[28px]" : "h-[22px] w-[34px]";
  if (card?.imagem_file_id) return <img src={fileUrl(card.imagem_file_id)} alt="" className={cn(cls, "shrink-0 rounded-[4px] object-cover")} />;
  return (
    <span className={cn(cls, "flex shrink-0 items-center justify-center rounded-[4px]")} style={{ background: "var(--fin-muted-soft)", color: "var(--fin-ink-3)" }}>
      <CreditCard size={13} />
    </span>
  );
}

// "Forma de pagamento" do lançamento: UMA seleção com duas seções — as formas
// cadastradas (Pix, Boleto, Transferência, Dinheiro, Outro…) e, em A Pagar, os
// CARTÕES de crédito ativos (Configurações › Contas e cartões). Escolher um
// cartão grava card_id (payment_method = credit_card); não existe mais campo
// "Cartão de crédito" separado. Lista em popover (não <select>) para mostrar a
// miniatura do cartão; rola dentro do modal (keepScroll).
//   state: { payment_method_id, card_id }   onChange(value "f:<id>" | "c:<id>" | "")
export function PaymentMethodPicker({ type, state, onChange, testid = "fin-entry-method", invalid }) {
  const { cad } = useFinance();
  const [open, setOpen] = useState(false);
  const value = paymentValue(state);
  const formas = activeOptions(cad.forma, state.payment_method_id, (x) => !isFormaCartaoGenerica(x));
  const cartoes = type === "pagar" ? activeOptions(cad.cartao, state.card_id) : [];
  const forma = state.payment_method_id && (cad.forma || []).find((x) => x.id === state.payment_method_id);
  const cartao = state.card_id && (cad.cartao || []).find((x) => x.id === state.card_id);
  const choose = (v) => { onChange(v); setOpen(false); };

  const item = (v, content, extraTestid) => {
    const sel = v === value;
    return (
      <li key={v || "none"} role="option" aria-selected={sel}>
        <button type="button" onClick={() => choose(v)} data-testid={`${testid}-opt-${extraTestid}`}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--fin-muted-soft)]"
          style={{ color: "var(--fin-ink)", background: sel ? "var(--fin-primary-soft)" : undefined }}>
          {content}
          {sel && <Check size={15} className="ml-auto shrink-0" style={{ color: "var(--fin-primary)" }} />}
        </button>
      </li>
    );
  };
  const section = (label) => (
    <li className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }} role="presentation">{label}</li>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid} data-value={value || undefined} aria-invalid={invalid || undefined}
          className="flex h-10 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm outline-none transition-colors focus:border-[var(--fin-primary)] focus:ring-2 focus:ring-[var(--fin-primary-soft)]"
          style={{ borderColor: invalid ? "var(--fin-danger)" : "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink)" }}>
          {cartao ? <><CardThumb card={cartao} /><span className="truncate">{cardLabel(cartao)}</span></>
            : forma ? <><FinIcon name={forma.icone} size={15} style={{ color: "var(--fin-ink-3)" }} /><span className="truncate">{forma.nome}</span></>
            : state.card_id ? <span className="truncate">Cartão</span>
            : <span style={{ color: "var(--fin-ink-3)" }}>—</span>}
          <ChevronDown size={15} className="ml-auto shrink-0" style={{ color: "var(--fin-ink-3)" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} collisionPadding={12} {...keepScroll}
        className="fin-scope w-[var(--radix-popover-trigger-width)] min-w-[260px] max-w-[calc(100vw-24px)] p-1.5"
        style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
        <ul role="listbox" className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain" data-testid={`${testid}-list`}>
          {item("", <span style={{ color: "var(--fin-ink-3)" }}>Não informar</span>, "none")}
          {section("Formas de pagamento")}
          {formas.map((x) => item(`f:${x.id}`, <><FinIcon name={x.icone} size={15} style={{ color: "var(--fin-ink-3)" }} /><span className="truncate">{x.nome}{x.ativo === false ? " (inativa)" : ""}</span></>, x.id))}
          {type === "pagar" && (
            <>
              {section("Cartões de crédito")}
              {cartoes.map((c) => item(`c:${c.id}`, <><CardThumb card={c} /><span className="truncate">{cardLabel(c)}{c.ativo === false ? " (inativo)" : ""}</span></>, c.id))}
              {!cartoes.length && (
                <li className="px-2.5 py-1.5 text-xs" style={{ color: "var(--fin-ink-3)" }}>Nenhum cartão ativo. Cadastre em Configurações › Contas e cartões.</li>
              )}
            </>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// Contas bancárias ativas como botões visíveis (seleção ÚNICA), mesmo padrão
// do Modo de lançamento e das Tags. Usado na baixa (Conta utilizada / Conta de
// entrada): nenhuma vem pré-selecionada.
export function AccountChips({ value, onChange, invalid, testid = "fin-settle-account" }) {
  const { cad } = useFinance();
  const options = (cad.conta || []).filter((c) => c.ativo !== false)
    .map((c) => ({ value: c.id, label: c.nome, icon: <BankLogo item={c} size={18} /> }));
  return <ChipSelect value={value} onChange={onChange} options={options} invalid={invalid} testid={testid} maxCollapsed={10}
    emptyText="Nenhuma conta bancária ativa. Cadastre em Configurações › Contas e cartões." />;
}

// Campo Descrição com memória das últimas descrições do usuário (até 15, sem
// duplicata, guardadas no backend por usuário). Só sugestão: texto livre.
// `recent`: lista vinda do FinanceContext.
export function DescriptionInput({ value, onChange, recent = [], invalid, placeholder, testid = "fin-entry-description" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = (value || "").trim().toLowerCase();
  const items = recent.filter((d) => d.toLowerCase() !== term && (!term || d.toLowerCase().includes(term))).slice(0, 8);
  const show = open && items.length > 0;
  const choose = (d) => { onChange(d); setOpen(false); setActive(-1); };
  const onKeyDown = (e) => {
    if (!show) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
  };
  return (
    <Popover open={show} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <input value={value} data-testid={testid} placeholder={placeholder} autoComplete="off" aria-invalid={invalid || undefined}
          role="combobox" aria-expanded={show} aria-autocomplete="list"
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }} onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border bg-[var(--fin-surface)] px-3 text-sm outline-none transition-colors focus:border-[var(--fin-primary)] focus:ring-2 focus:ring-[var(--fin-primary-soft)]"
          style={{ borderColor: invalid ? "var(--fin-danger)" : "var(--fin-border)", color: "var(--fin-ink)" }} />
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} collisionPadding={12} {...keepScroll}
        onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
        className="fin-scope w-[var(--radix-popover-trigger-width)] min-w-[260px] max-w-[calc(100vw-24px)] p-1.5"
        style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}>
        <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--fin-ink-3)" }}>
          <History size={12} /> Usadas recentemente
        </p>
        <ul role="listbox" className="max-h-[min(260px,40vh)] overflow-y-auto overscroll-contain" data-testid={`${testid}-suggestions`}>
          {items.map((d, i) => (
            <li key={d} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(d)} onMouseEnter={() => setActive(i)}
                className="block w-full truncate rounded-md px-2.5 py-2 text-left text-sm" title={d}
                style={{ color: "var(--fin-ink)", background: i === active ? "var(--fin-muted-soft)" : "transparent" }}>
                {d}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
