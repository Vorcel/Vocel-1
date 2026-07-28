import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Modal de confirmação reutilizável — mesmo padrão/estilo do modal "Excluir esta
// linha?" do Orçamento (título, mensagem, Cancelar, botão vermelho de confirmação).
// Enquanto `loading`, os botões ficam desabilitados (evita duplo clique).
export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = "Excluir", cancelLabel = "Cancelar", loadingLabel,
  onConfirm, loading = false, testid = "confirm-dialog",
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <AlertDialogContent data-testid={testid}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testid}-cancel`} disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            data-testid={`${testid}-confirm`}
            disabled={loading}
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            className="bg-alert text-white hover:bg-alert/90"
          >
            {loading ? (loadingLabel || "Excluindo...") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
