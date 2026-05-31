import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gavel, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("admin@licita.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
      toast.success("Bem-vindo!");
      navigate("/");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
            <Gavel size={24} />
          </div>
          <span className="font-heading text-2xl font-bold">LicitaSys</span>
        </div>
        <div className="relative z-10">
          <h2 className="font-heading text-4xl font-bold leading-tight tracking-tight">
            Gestão completa das suas licitações públicas.
          </h2>
          <p className="mt-4 max-w-md text-white/80">
            Do monitoramento diário ao pós-venda. Orçamentos, precificação avançada e
            lucratividade em um só lugar.
          </p>
        </div>
        <div className="relative z-10 text-sm text-white/70">© {new Date().getFullYear()} LicitaSys</div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" />
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
              <Gavel size={20} />
            </div>
            <span className="font-heading text-xl font-bold">LicitaSys</span>
          </div>

          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {mode === "login" ? "Entrar na sua conta" : "Criar conta"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login" ? "Acesse o painel de licitações" : "Comece a gerenciar suas licitações"}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Nome completo</Label>
                <Input id="name" data-testid="login-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Seu nome" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" data-testid="login-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>

            {error && <p data-testid="login-error" className="text-sm text-alert">{error}</p>}

            <Button type="submit" data-testid="login-submit" disabled={loading} className="w-full bg-brand hover:bg-brand-hover">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "Não tem conta?" : "Já tem conta?"}{" "}
            <button
              data-testid="login-toggle-mode"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="font-medium text-brand hover:underline"
            >
              {mode === "login" ? "Cadastre-se" : "Entrar"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
