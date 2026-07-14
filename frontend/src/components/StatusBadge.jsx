import { forwardRef } from "react";
import { colorStyles } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Badge de status padrão do sistema (mesmo visual da Execução & Pós-Venda):
// cápsula arredondada com bolinha, cores derivadas do hex configurado.
// `as` permite usar como <button> (ex.: gatilho de dropdown).
export const StatusBadge = forwardRef(({ color, as: Comp = "span", className, children, ...props }, ref) => {
  const s = colorStyles(color);
  return (
    <Comp
      ref={ref}
      style={s.badge}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold", className)}
      {...props}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={s.dot} />
      {children}
    </Comp>
  );
});
StatusBadge.displayName = "StatusBadge";
