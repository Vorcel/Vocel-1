import { cn } from "@/lib/utils";

// Moldura dos blocos da página Análises (Ref 1): cabeçalho compacto com ícone
// pastel, título de 13px e subtítulo de 10px; corpo com padding curto.
// Cores e raio vêm dos tokens `.an-scope` (index.css) — nada hardcoded aqui.
export function Panel({ icon: Icon, title, subtitle, right, className, bodyClassName, testid, children }) {
  return (
    <section data-testid={testid} className={cn("an-card flex min-w-0 flex-col", className)}>
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#E8F2FF] text-[#1478F2] dark:bg-white/10">
            <Icon size={15} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 title={title} className="truncate text-[13px] font-bold leading-tight text-[var(--an-text)]">{title}</h2>
          {subtitle && <p title={subtitle} className="truncate text-[10px] leading-tight text-[var(--an-muted)]">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className={cn("min-w-0 flex-1 px-3 pb-3", bodyClassName)}>{children}</div>
    </section>
  );
}

// Legenda compartilhada pelos gráficos (bolinha + rótulo), 10px.
export function LegendDots({ items, className }) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-[var(--an-muted)]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// Estado vazio (período sem dados) — nunca quebra o gráfico/tabela.
export function EmptyState({ message = "Nenhuma licitação encontrada para este período.", className }) {
  return (
    <div className={cn("flex min-h-[7rem] items-center justify-center px-4 text-center text-[11px] text-[var(--an-muted)]", className)}>
      {message}
    </div>
  );
}
