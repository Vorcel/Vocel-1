import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFinance } from "@/context/FinanceContext";
import { apiError, finApi } from "@/lib/financeiro";

// Seleção múltipla de tags (cadastro central em Configurações › Tags).
// Busca, remoção e — no formulário — criação rápida de uma tag nova, que entra
// no MESMO cadastro (sem texto solto). Tags inativas só aparecem se já estavam
// selecionadas (lançamentos antigos), nunca como opção nova.
export function TagPicker({ value = [], onChange, allowCreate = false, placeholder = "Selecionar tags", testid = "fin-tag-picker", includeInactive = false }) {
  const { cad, byId, refreshCadastros } = useFinance();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (cad.tag || [])
      .filter((t) => includeInactive || t.ativo !== false || value.includes(t.id))
      .filter((t) => !term || t.nome.toLowerCase().includes(term));
  }, [cad.tag, q, value, includeInactive]);
  const exact = (cad.tag || []).some((t) => t.nome.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const criar = async () => {
    const nome = q.trim();
    if (!nome) return;
    setBusy(true);
    try {
      const t = await finApi.criarCadastro("tag", { nome, cor: "#2563EB" });
      await refreshCadastros();
      onChange([...value, t.id]);
      setQ("");
      toast.success(`Tag "${nome}" criada`);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid}
          className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-lg border px-2.5 py-1.5 text-left text-sm"
          style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink)" }}>
          {value.length === 0 && <span className="flex items-center gap-1.5" style={{ color: "var(--fin-ink-3)" }}><Tags size={15} /> {placeholder}</span>}
          {value.map((id) => {
            const t = byId[id];
            const cor = t?.cor || "#64748B";
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium" style={{ background: `${cor}1A`, color: cor }}>
                {t?.nome || "Tag"}
                <span role="button" tabIndex={0} title="Remover" className="rounded-full p-0.5 hover:bg-black/10"
                  onClick={(e) => { e.stopPropagation(); toggle(id); }} onKeyDown={(e) => e.key === "Enter" && toggle(id)}><X size={11} /></span>
              </span>
            );
          })}
          <ChevronDown size={15} className="ml-auto shrink-0" style={{ color: "var(--fin-ink-3)" }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="fin-scope w-[280px] p-2" style={{ background: "var(--fin-surface)" }} align="start">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tag..." data-testid={`${testid}-search`}
          onKeyDown={(e) => { if (e.key === "Enter" && allowCreate && q.trim() && !exact) { e.preventDefault(); criar(); } }}
          className="mb-1.5 h-9 w-full rounded-md border px-2.5 text-sm outline-none focus:border-[var(--fin-primary)]"
          style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface)", color: "var(--fin-ink)" }} />
        <ul className="max-h-56 overflow-y-auto">
          {options.map((t) => {
            const sel = value.includes(t.id);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => toggle(t.id)} data-testid={`${testid}-opt-${t.id}`}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--fin-muted-soft)]" style={{ color: "var(--fin-ink)" }}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.cor || "#64748B" }} />
                  <span className="flex-1 truncate text-left">{t.nome}{t.ativo === false ? " (inativa)" : ""}</span>
                  {sel && <Check size={15} style={{ color: "var(--fin-primary)" }} />}
                </button>
              </li>
            );
          })}
          {!options.length && !allowCreate && <li className="px-2 py-2 text-xs" style={{ color: "var(--fin-ink-3)" }}>Nenhuma tag. Cadastre em Configurações › Tags.</li>}
        </ul>
        {allowCreate && q.trim() && !exact && (
          <button type="button" onClick={criar} disabled={busy} data-testid={`${testid}-create`}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-[var(--fin-primary-soft)] disabled:opacity-50"
            style={{ color: "var(--fin-primary)" }}>
            <Plus size={15} /> Criar tag "{q.trim()}"
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
