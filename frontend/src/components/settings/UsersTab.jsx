import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckSquare, KeyRound, Loader2, LogOut, MoreVertical, PencilLine, Plus, Power, Shield, ShieldCheck, Square, UserCog,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";

// Configurações › Usuários — EXCLUSIVO do usuário principal (o backend também
// recusa qualquer outro). Usuário interno: nome + login + senha, sem e-mail,
// dentro da MESMA conta; permissões marcadas uma a uma (nada é liberado por padrão).

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MIN_PASSWORD = 8;

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

// Ação que não é "ver" exige o "ver" do próprio módulo (o backend aplica a mesma regra).
function viewKeyOf(module) {
  return module.actions.find((a) => a.key.endsWith(".view"))?.key;
}
function toggleKey(perms, module, key, on) {
  const next = new Set(perms);
  const view = viewKeyOf(module);
  if (on) {
    next.add(key);
    if (view && key !== view) next.add(view);
  } else {
    next.delete(key);
    if (view && key === view) module.actions.forEach((a) => next.delete(a.key));
  }
  return next;
}

function PermissionMatrix({ catalog, value, onChange }) {
  const total = (m) => m.actions.filter((a) => value.has(a.key)).length;
  return (
    <Accordion type="multiple" defaultValue={catalog.map((g) => g.group)} className="rounded-lg border border-border">
      {catalog.map((g) => {
        const keys = g.modules.flatMap((m) => m.actions.map((a) => a.key));
        const on = keys.filter((k) => value.has(k)).length;
        return (
          <AccordionItem key={g.group} value={g.group} className="border-border px-4 last:border-b-0">
            <AccordionTrigger className="py-3 hover:no-underline" data-testid={`perm-group-${g.group}`}>
              <span className="flex items-center gap-2 text-sm font-semibold">
                {g.group}
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                  on ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground")}>{on}/{keys.length}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              {g.modules.map((m) => (
                <div key={m.id} className="rounded-lg border border-border bg-background p-3" data-testid={`perm-module-${m.id}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{m.label}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{total(m)}/{m.actions.length}</span>
                    </span>
                    <span className="flex gap-1">
                      <button type="button" data-testid={`perm-all-${m.id}`}
                        onClick={() => { const n = new Set(value); m.actions.forEach((a) => n.add(a.key)); onChange(n); }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                        <CheckSquare size={13} /> Selecionar todas
                      </button>
                      <button type="button" data-testid={`perm-none-${m.id}`}
                        onClick={() => { const n = new Set(value); m.actions.forEach((a) => n.delete(a.key)); onChange(n); }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Square size={13} /> Limpar
                      </button>
                    </span>
                  </div>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {m.actions.map((a) => {
                      const id = `perm-${a.key}`;
                      return (
                        <label key={a.key} htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
                          <Checkbox id={id} data-testid={id} checked={value.has(a.key)} className="mt-0.5"
                            onCheckedChange={(c) => onChange(toggleKey(value, m, a.key, !!c))} />
                          <span>{a.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function UserModal({ open, onOpenChange, catalog, user, onSaved }) {
  const editing = !!user;
  const [form, setForm] = useState({ name: "", login: "", password: "", confirm: "", active: true });
  const [perms, setPerms] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm({ name: user?.name || "", login: user?.login || "", password: "", confirm: "", active: user ? user.active : true });
    setPerms(new Set(user?.permissions || []));
    setError("");
  }, [open, user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const login = form.login.trim().toLowerCase();

  const validate = () => {
    if (!form.name.trim()) return "Informe o nome.";
    if (!LOGIN_RE.test(login)) return "Login: 2 a 32 caracteres — letras minúsculas, números, ponto, hífen ou sublinhado.";
    if (!editing) {
      if (form.password.length < MIN_PASSWORD) return `A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`;
      if (form.password !== form.confirm) return "A confirmação não confere com a senha.";
    }
    return "";
  };

  const save = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setSaving(true);
    setError("");
    try {
      const permissions = [...perms];
      const { data } = editing
        ? await api.put(`/users/${user.id}`, { name: form.name.trim(), login, active: form.active, permissions })
        : await api.post("/users", { name: form.name.trim(), login, password: form.password, active: form.active, permissions });
      toast.success(editing ? "Usuário atualizado" : "Usuário criado");
      onSaved(data);
      onOpenChange(false);
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="user-modal">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            O usuário entra com login e senha (sem e-mail) e trabalha nos dados desta conta, só com as permissões marcadas abaixo.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados do usuário</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="user-name">Nome *</Label>
              <Input id="user-name" data-testid="user-name" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-login">Login *</Label>
              <Input id="user-login" data-testid="user-login" maxLength={32} autoCapitalize="none" spellCheck={false}
                value={form.login} onChange={(e) => set("login", e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="ex.: ia, hygor" />
              {editing && login !== user.login && (
                <p className="text-xs text-amber-600">Trocar o login encerra as sessões abertas deste usuário.</p>
              )}
            </div>
            <div className="flex items-end justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div>
                <Label htmlFor="user-active">Status</Label>
                <p className="text-xs text-muted-foreground">{form.active ? "Ativo — pode entrar no Vorcel" : "Inativo — sem acesso"}</p>
              </div>
              <Switch id="user-active" data-testid="user-active" checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </div>
            {!editing && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="user-password">Senha *</Label>
                  <Input id="user-password" type="password" autoComplete="new-password" data-testid="user-password"
                    value={form.password} onChange={(e) => set("password", e.target.value)} />
                  <p className="text-xs text-muted-foreground">Mínimo de {MIN_PASSWORD} caracteres. Não será exibida de novo.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-confirm">Confirmar senha *</Label>
                  <Input id="user-confirm" type="password" autoComplete="new-password" data-testid="user-password-confirm"
                    value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Permissões</h4>
            <span className="text-xs text-muted-foreground" data-testid="user-perm-count">{perms.size} permissão(ões) marcada(s)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Nada é liberado por padrão. Marcar uma ação marca também o “Visualizar” do módulo. Usuários e permissões
            são sempre exclusivos do administrador.
          </p>
          <PermissionMatrix catalog={catalog} value={perms} onChange={setPerms} />
        </section>

        {error && <p className="text-sm text-alert" data-testid="user-modal-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button data-testid="user-save" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }) {
  const [pwd, setPwd] = useState({ password: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPwd({ password: "", confirm: "" }); setError(""); }, [user]);

  const save = async () => {
    if (pwd.password.length < MIN_PASSWORD) { setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`); return; }
    if (pwd.password !== pwd.confirm) { setError("A confirmação não confere com a senha."); return; }
    setSaving(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { password: pwd.password });
      toast.success("Senha redefinida. As sessões abertas do usuário foram encerradas.");
      onOpenChange(false);
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="reset-password-modal">
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            Nova senha para <strong>{user?.name}</strong> ({user?.login}). O usuário será desconectado de todas as sessões.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-pwd">Nova senha</Label>
            <Input id="reset-pwd" type="password" autoComplete="new-password" data-testid="reset-password"
              value={pwd.password} onChange={(e) => setPwd((p) => ({ ...p, password: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirmar nova senha</Label>
            <Input id="reset-confirm" type="password" autoComplete="new-password" data-testid="reset-password-confirm"
              value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button data-testid="reset-password-save" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Redefinir senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab() {
  const [data, setData] = useState({ owner: null, users: [] });
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, user: null });
  const [resetFor, setResetFor] = useState(null);
  const [confirm, setConfirm] = useState(null);   // { kind: "deactivate"|"revoke", user }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([api.get("/users"), api.get("/users/permissions-catalog")]);
      setData(u.data);
      setCatalog(c.data.groups);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalKeys = useMemo(() => catalog.reduce((n, g) => n + g.modules.reduce((m, x) => m + x.actions.length, 0), 0), [catalog]);

  const setActive = async (user, active) => {
    setBusy(true);
    try {
      await api.put(`/users/${user.id}`, { active });
      toast.success(active ? "Usuário ativado" : "Usuário desativado");
      setConfirm(null);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };
  const revoke = async (user) => {
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/revoke-sessions`);
      toast.success("Sessões encerradas");
      setConfirm(null);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const owner = data.owner;

  return (
    <div className="space-y-4" data-testid="users-tab">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold">Usuários e permissões</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Usuários internos usam os dados desta conta. Cada um só faz o que você marcar.
            </p>
          </div>
          <Button data-testid="new-user-button" onClick={() => setModal({ open: true, user: null })} disabled={loading || !catalog.length}
            className="bg-brand hover:bg-brand-hover">
            <Plus size={16} className="mr-2" /> Novo usuário
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm" data-testid="users-table">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">Nome</th>
                  <th className="px-3 py-2.5">Login</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Permissões</th>
                  <th className="px-3 py-2.5">Último acesso</th>
                  <th className="px-3 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {owner && (
                  <tr className="border-t border-border" data-testid="user-row-owner">
                    <td className="px-3 py-2.5 font-medium">{owner.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{owner.email}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                        <ShieldCheck size={13} /> Administrador
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Ativo</span></td>
                    <td className="px-3 py-2.5 text-muted-foreground">Acesso total</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtDateTime(owner.last_login_at)}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">Protegido</td>
                  </tr>
                )}
                {data.users.map((u) => (
                  <tr key={u.id} className="border-t border-border" data-testid={`user-row-${u.login}`}>
                    <td className="px-3 py-2.5 font-medium">{u.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{u.login}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <Shield size={13} /> Usuário interno
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {u.active
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Ativo</span>
                        : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Inativo</span>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{u.permissions.length}/{totalKeys}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtDateTime(u.last_login_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button data-testid={`user-actions-${u.login}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`user-edit-${u.login}`} onClick={() => setModal({ open: true, user: u })}>
                            <PencilLine size={15} className="mr-2" /> Editar e permissões
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid={`user-reset-${u.login}`} onClick={() => setResetFor(u)}>
                            <KeyRound size={15} className="mr-2" /> Redefinir senha
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid={`user-revoke-${u.login}`} onClick={() => setConfirm({ kind: "revoke", user: u })}>
                            <LogOut size={15} className="mr-2" /> Encerrar sessões
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {u.active ? (
                            <DropdownMenuItem data-testid={`user-deactivate-${u.login}`} className="text-alert focus:text-alert"
                              onClick={() => setConfirm({ kind: "deactivate", user: u })}>
                              <Power size={15} className="mr-2" /> Desativar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem data-testid={`user-activate-${u.login}`} onClick={() => setActive(u, true)}>
                              <Power size={15} className="mr-2" /> Ativar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {!data.users.length && (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      <UserCog className="mx-auto mb-2 text-muted-foreground" size={28} />
                      Nenhum usuário interno ainda. Clique em “Novo usuário”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserModal open={modal.open} user={modal.user} catalog={catalog}
        onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))} onSaved={() => load()} />
      <ResetPasswordDialog user={resetFor} onOpenChange={(o) => { if (!o) setResetFor(null); }} />
      <ConfirmDialog
        open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }} loading={busy}
        testid="user-confirm"
        title={confirm?.kind === "deactivate" ? "Desativar este usuário?" : "Encerrar as sessões deste usuário?"}
        description={confirm?.kind === "deactivate"
          ? "O usuário perderá acesso ao Vorcel. O histórico das ações realizadas será preservado."
          : "O usuário será desconectado em todos os dispositivos e precisará entrar de novo."}
        confirmLabel={confirm?.kind === "deactivate" ? "Desativar" : "Encerrar sessões"}
        onConfirm={() => (confirm?.kind === "deactivate" ? setActive(confirm.user, false) : revoke(confirm.user))}
      />
    </div>
  );
}
