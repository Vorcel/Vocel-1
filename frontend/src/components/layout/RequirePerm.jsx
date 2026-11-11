import { Link } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { firstAllowedPath } from "@/lib/permissions";

// Tela de rota sem permissão (URL digitada à mão). É só UX: o backend já nega
// os dados com 403, então nada sensível chegaria à tela de qualquer forma.
export function AccessDenied({ title = "Acesso não autorizado" }) {
  const { user } = useAuth();
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="access-denied">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <ShieldOff className="mx-auto mb-4 text-muted-foreground" size={48} />
        <h2 className="font-heading text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu usuário não tem permissão para acessar esta área. Se precisar, fale com o administrador da conta.
        </p>
        <Link to={firstAllowedPath(user)} data-testid="access-denied-home"
          className="mt-6 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          Ir para a página inicial
        </Link>
      </div>
    </div>
  );
}

// <RequirePerm any={["x.view", "y.view"]}> — qualquer uma das chaves libera.
// `check` (função do user) cobre regras compostas (ex.: qualquer permissão do Financeiro).
export function RequirePerm({ any = [], check, children }) {
  const { user, canAny } = useAuth();
  const ok = check ? check(user) : canAny(any);
  return ok ? children : <AccessDenied />;
}
