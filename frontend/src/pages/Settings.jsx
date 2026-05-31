import { useState } from "react";
import { User, Building2, Palette, Calculator, ListChecks, Save, Trash2, Plus, Moon, Sun, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { colorStyles } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FileUpload } from "@/components/FileUpload";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import { useTheme } from "@/context/ThemeContext";
import api, { fileUrl, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function ProfileTab() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user?.name || "", phone: user?.phone || "", cargo: user?.cargo || "", avatar_url: user?.avatar_url || "" });
  const [pwd, setPwd] = useState({ current_password: "", new_password: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveProfile = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/auth/profile", form);
      setUser(data);
      toast.success("Perfil atualizado");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    try {
      await api.post("/auth/change-password", pwd);
      setPwd({ current_password: "", new_password: "" });
      toast.success("Senha alterada");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const initials = (form.name || "U").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 font-heading text-base font-semibold">Dados Pessoais</h3>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex flex-col items-center gap-3">
            <Avatar className="h-24 w-24 border border-border">
              {form.avatar_url && <AvatarImage src={fileUrl(form.avatar_url)} />}
              <AvatarFallback className="bg-brand text-2xl font-semibold text-white">{initials}</AvatarFallback>
            </Avatar>
            <div className="w-40">
              <FileUpload
                testid="avatar-upload" accept="image/*" maxMb={5}
                value={null}
                onUploaded={(f) => { set("avatar_url", f.id); }}
              />
            </div>
          </div>
          <div className="grid flex-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>Nome</Label><Input data-testid="profile-name" value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Telefone</Label><Input data-testid="profile-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Cargo</Label><Input data-testid="profile-cargo" value={form.cargo} onChange={(e) => set("cargo", e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>E-mail</Label><Input value={user?.email || ""} disabled /></div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button data-testid="profile-save" onClick={saveProfile} disabled={saving} className="bg-brand hover:bg-brand-hover">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save size={16} className="mr-2" />} Salvar
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 font-heading text-base font-semibold">Alterar Senha</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Senha atual</Label><Input type="password" data-testid="pwd-current" value={pwd.current_password} onChange={(e) => setPwd((p) => ({ ...p, current_password: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Nova senha</Label><Input type="password" data-testid="pwd-new" value={pwd.new_password} onChange={(e) => setPwd((p) => ({ ...p, new_password: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" data-testid="pwd-save" onClick={changePassword} disabled={!pwd.current_password || !pwd.new_password}>Alterar senha</Button>
        </div>
      </div>
    </div>
  );
}

function CompanyTab() {
  const { company, saveCompany } = useData();
  const [form, setForm] = useState({ ...company });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => { try { await saveCompany(form); toast.success("Dados da empresa salvos"); } catch { toast.error("Erro ao salvar"); } };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-4 font-heading text-base font-semibold">Identificação & Identidade Visual</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label>Razão Social</Label><Input data-testid="company-razao" value={form.razao_social || ""} onChange={(e) => set("razao_social", e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Nome Fantasia</Label><Input data-testid="company-fantasia" value={form.nome_fantasia || ""} onChange={(e) => set("nome_fantasia", e.target.value)} /></div>
        <div className="space-y-1.5"><Label>CNPJ</Label><Input data-testid="company-cnpj" value={form.cnpj || ""} onChange={(e) => set("cnpj", e.target.value)} /></div>
        <div className="space-y-1.5"><Label>E-mail</Label><Input data-testid="company-email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Telefone</Label><Input data-testid="company-tel" value={form.telefone || ""} onChange={(e) => set("telefone", e.target.value)} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>Endereço</Label><Input data-testid="company-end" value={form.endereco || ""} onChange={(e) => set("endereco", e.target.value)} /></div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Logotipo</Label>
          {form.logo_url ? (
            <div className="flex items-center gap-4">
              <img src={fileUrl(form.logo_url)} alt="logo" className="h-16 rounded-md border border-border bg-white object-contain p-1" />
              <Button variant="outline" size="sm" onClick={() => set("logo_url", "")}>Remover</Button>
            </div>
          ) : (
            <FileUpload testid="company-logo" accept="image/*" maxMb={5} value={null} onUploaded={(f) => set("logo_url", f.id)} />
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button data-testid="company-save" onClick={save} className="bg-brand hover:bg-brand-hover"><Save size={16} className="mr-2" /> Salvar</Button>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { savePrefs } = useData();
  const choose = (t) => { setTheme(t); savePrefs({ theme: t }); };
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-4 font-heading text-base font-semibold">Aparência</h3>
      <div className="grid max-w-md grid-cols-2 gap-4">
        {[{ id: "light", label: "Claro", icon: Sun }, { id: "dark", label: "Escuro", icon: Moon }].map((opt) => (
          <button
            key={opt.id}
            data-testid={`theme-${opt.id}`}
            onClick={() => choose(opt.id)}
            className={cn("flex flex-col items-center gap-2 rounded-xl border-2 p-6 transition-colors", theme === opt.id ? "border-brand bg-brand/5" : "border-border hover:border-brand/40")}
          >
            <opt.icon size={28} className={theme === opt.id ? "text-brand" : "text-muted-foreground"} />
            <span className="font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BudgetDefaultsTab() {
  const { prefs, savePrefs } = useData();
  const [icms, setIcms] = useState(prefs.icms_padrao ?? 18);
  const [pis, setPis] = useState(prefs.pis_cofins_padrao ?? 9.25);
  const save = async () => { await savePrefs({ icms_padrao: parseFloat(icms), pis_cofins_padrao: parseFloat(pis) }); toast.success("Padrões salvos"); };
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-1 font-heading text-base font-semibold">Impostos Padrão</h3>
      <p className="mb-4 text-sm text-muted-foreground">Injetados automaticamente nas novas linhas do orçamento (Tela 2).</p>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>ICMS % Padrão</Label><Input type="number" step="0.01" data-testid="default-icms" value={icms} onChange={(e) => setIcms(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>PIS/COFINS % Padrão</Label><Input type="number" step="0.01" data-testid="default-pis" value={pis} onChange={(e) => setPis(e.target.value)} /></div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button data-testid="defaults-save" onClick={save} className="bg-brand hover:bg-brand-hover"><Save size={16} className="mr-2" /> Salvar</Button>
      </div>
    </div>
  );
}

function ListManager({ title, type }) {
  const { lists, addListItem, removeListItem, updateListItem } = useData();
  const [text, setText] = useState("");
  const [cor, setCor] = useState("#0C7B93");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCor, setEditCor] = useState("#0C7B93");

  const add = async () => {
    if (!text.trim()) return;
    await addListItem(type, text.trim(), cor);
    setText("");
    toast.success("Item adicionado");
  };
  const startEdit = (item) => { setEditing(item.nome); setEditName(item.nome); setEditCor(item.cor); };
  const saveEdit = async () => {
    if (!editName.trim()) return;
    await updateListItem(type, editing, editName.trim(), editCor);
    setEditing(null);
    toast.success("Item atualizado");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-4 font-heading text-base font-semibold">{title}</h3>
      <div className="mb-4 flex gap-2">
        <Input data-testid={`list-${type}-input`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={`Novo item em ${title}`} />
        <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} data-testid={`list-${type}-color`} className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5" title="Cor" />
        <Button data-testid={`list-${type}-add`} onClick={add} className="bg-brand hover:bg-brand-hover"><Plus size={16} /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(lists[type] || []).map((item) => (
          <span key={item.nome} data-testid={`list-${type}-tag-${item.nome}`} style={colorStyles(item.cor).badge} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.cor }} />
            <button onClick={() => startEdit(item)} data-testid={`list-${type}-edit-${item.nome}`} className="hover:underline" title="Editar">{item.nome}</button>
            <button data-testid={`list-${type}-remove-${item.nome}`} onClick={() => removeListItem(type, item.nome)} className="opacity-60 transition-opacity hover:opacity-100"><Trash2 size={13} /></button>
          </span>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-testid={`list-${type}-edit-modal`}>
          <DialogHeader><DialogTitle className="font-heading">Editar item</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} data-testid={`list-${type}-edit-name`} />
            <input type="color" value={editCor} onChange={(e) => setEditCor(e.target.value)} data-testid={`list-${type}-edit-color`} className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button data-testid={`list-${type}-edit-save`} onClick={saveEdit} className="bg-brand hover:bg-brand-hover">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Settings() {
  const TABS = [
    { id: "perfil", label: "Meu Perfil e Segurança", icon: User },
    { id: "empresa", label: "Dados da Empresa", icon: Building2 },
    { id: "aparencia", label: "Preferências", icon: Palette },
    { id: "orcamento", label: "Padrões de Orçamento", icon: Calculator },
    { id: "listas", label: "Listas e Parâmetros", icon: ListChecks },
  ];
  return (
    <>
      <Header title="Configurações" subtitle="Painel administrativo" />
      <main className="p-6">
        <Tabs defaultValue="perfil" className="w-full">
          <TabsList className="mb-6 flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`} className="gap-2 rounded-lg border border-border data-[state=active]:border-brand data-[state=active]:bg-brand data-[state=active]:text-white">
                <t.icon size={16} /> <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="perfil"><ProfileTab /></TabsContent>
          <TabsContent value="empresa"><CompanyTab /></TabsContent>
          <TabsContent value="aparencia"><AppearanceTab /></TabsContent>
          <TabsContent value="orcamento"><BudgetDefaultsTab /></TabsContent>
          <TabsContent value="listas" className="space-y-6">
            <ListManager title="Portais de Compra" type="portais" />
            <ListManager title="Modalidades" type="modalidades" />
            <ListManager title="Status Personalizados" type="statuses" />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
