import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FinButton } from "./ui";

// Modal base de TODO o Financeiro (lançamento, baixa, aprovação, cadastros,
// confirmações). O conteúdo vai para um portal fora da página, por isso recebe
// a classe .fin-scope para herdar os tokens visuais do módulo.
export function FinModal({ open, onClose, title, description, icon: Icon, children, footer, size = "md", testid, busy }) {
  const width = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-2xl" }[size];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid={testid}
        className={cn("fin-scope flex max-h-[92vh] w-[calc(100vw-24px)] flex-col gap-0 overflow-hidden rounded-2xl border p-0", width)}
        style={{ background: "var(--fin-surface)", borderColor: "var(--fin-border)" }}
        onInteractOutside={(e) => busy && e.preventDefault()}>
        <div className="flex items-start gap-3 px-6 pb-4 pt-5 pr-12">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}>
              <Icon size={19} />
            </span>
          )}
          <div className="min-w-0">
            <DialogTitle className="font-heading text-lg font-semibold" style={{ color: "var(--fin-ink)" }}>{title}</DialogTitle>
            <DialogDescription className={cn("mt-0.5 text-sm", !description && "sr-only")} style={{ color: "var(--fin-ink-3)" }}>
              {description || title}
            </DialogDescription>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "var(--fin-border)", background: "var(--fin-surface-2)" }}>
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Confirmação simples (sim/não) no visual do Financeiro.
export function FinConfirm({ open, onClose, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger, loading, onConfirm, children, testid }) {
  return (
    <FinModal open={open} onClose={onClose} title={title} description={description} size="sm" testid={testid} busy={loading}
      footer={<>
        <FinButton variant="outline" onClick={onClose} disabled={loading} data-testid={testid && `${testid}-cancel`}>{cancelLabel}</FinButton>
        <FinButton variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm} data-testid={testid && `${testid}-confirm`}>{confirmLabel}</FinButton>
      </>}>
      {children}
    </FinModal>
  );
}
