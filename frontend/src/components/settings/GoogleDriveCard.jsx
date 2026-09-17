import { useState } from "react";
import { ExternalLink, FolderPlus, HardDrive, Loader2, Link2, RefreshCw, Unplug } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useData } from "@/context/DataContext";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Selo de situação. Verde sólido só quando a conexão está realmente funcionando.
const Selo = ({ variante, texto }) => (
  <span
    className={cn(
      "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
      variante === "ok" && "border-positive/30 bg-positive/10 text-positive",
      variante === "alerta" && "border-warning/30 bg-warning/10 text-warning",
      variante === "off" && "border-border text-muted-foreground"
    )}
  >
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        variante === "ok" && "bg-positive",
        variante === "alerta" && "bg-warning",
        variante === "off" && "bg-inactive"
      )}
    />
    {texto}
  </span>
);

const Campo = ({ label, children }) => (
  <div className="space-y-1">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <div className="text-sm text-foreground">{children}</div>
  </div>
);

export function GoogleDriveCard() {
  const { googleStatus, connectGoogle, createDriveFolder, disconnectGoogle, refreshGoogle } = useData();
  const [ocupado, setOcupado] = useState(null); // "conectar" | "pasta" | "desconectar" | "verificar"
  const [pastaAberta, setPastaAberta] = useState(false);
  const [nomePasta, setNomePasta] = useState("Propostas");
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);

  const { configured, connected, email, folder_id, folder_name, folder_link, status, unreachable, httpStatus } = googleStatus || {};
  const expirado = connected && status === "expired";

  const rodar = async (chave, fn, sucesso) => {
    setOcupado(chave);
    try {
      await fn();
      if (sucesso) toast.success(sucesso);
      return true;
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const conectar = () => rodar("conectar", connectGoogle);
  // Reconsulta o servidor sem exigir F5 (o status só era buscado ao montar o app).
  const verificar = async () => {
    setOcupado("verificar");
    const dados = await refreshGoogle();
    setOcupado(null);
    if (!dados) toast.error("Servidor não respondeu. Tente de novo em alguns segundos.");
    else if (!dados.configured) toast.error("O servidor respondeu, mas as credenciais do Google não estão no ambiente.");
    else toast.success("Integração configurada no servidor");
  };
  const criarPasta = async () => {
    const ok = await rodar("pasta", () => createDriveFolder(nomePasta), "Pasta de propostas criada no seu Drive");
    if (ok) setPastaAberta(false);
  };
  const desconectar = async () => {
    const ok = await rodar("desconectar", disconnectGoogle, "Google Drive desconectado");
    if (ok) setConfirmarDesconexao(false);
  };

  const abrirDialogoPasta = () => {
    setNomePasta(folder_name ? folder_name.split("/").pop().trim() : "Propostas");
    setPastaAberta(true);
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-6" data-testid="google-drive-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <HardDrive size={20} />
            </span>
            <div>
              <h3 className="font-heading text-base font-semibold">Google Drive</h3>
              <p className="text-sm text-muted-foreground">
                Envia uma cópia das propostas para o seu Drive e converte em Google Docs para edição.
              </p>
            </div>
          </div>
          {unreachable ? (
            <Selo variante="alerta" texto="Não verificado" />
          ) : !configured ? (
            <Selo variante="off" texto="Não configurado" />
          ) : expirado ? (
            <Selo variante="alerta" texto="Conexão expirada" />
          ) : connected ? (
            <Selo variante="ok" texto="Conectado" />
          ) : (
            <Selo variante="off" texto="Não conectado" />
          )}
        </div>

        <div className="mt-5 border-t border-border pt-5">
          {/* Não conseguimos falar com o servidor: é diferente de "não configurado",
              e some sozinho quando o backend responde (deploy/cold start do Render). */}
          {unreachable && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Não foi possível verificar a integração com o servidor
                {httpStatus ? ` (erro ${httpStatus})` : ""}. Isso costuma acontecer logo após um deploy ou
                quando o servidor está reiniciando.
              </p>
              <Button size="sm" variant="outline" onClick={verificar} disabled={ocupado === "verificar"} data-testid="google-retry">
                {ocupado === "verificar" ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
                Tentar novamente
              </Button>
            </div>
          )}

          {!unreachable && !configured && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A integração com o Google ainda não foi configurada neste servidor. É preciso cadastrar
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_ID</code>,
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code> e
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_REDIRECT_URI</code>
                no ambiente do servidor. Assim que estiverem lá, o botão de conexão aparece aqui.
              </p>
              <Button size="sm" variant="outline" onClick={verificar} disabled={ocupado === "verificar"} data-testid="google-retry">
                {ocupado === "verificar" ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
                Verificar novamente
              </Button>
            </div>
          )}

          {!unreachable && configured && !connected && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                data-testid="google-connect"
                onClick={conectar}
                disabled={ocupado === "conectar"}
                className="bg-brand hover:bg-brand-hover"
              >
                {ocupado === "conectar" ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Link2 size={16} className="mr-2" />}
                Conectar com Google
              </Button>
              <p className="text-xs text-muted-foreground">
                Sua conta, sua pasta. Cada usuário do Vorcel conecta o próprio Google Drive.
              </p>
            </div>
          )}

          {!unreachable && configured && connected && (
            <div className="space-y-5">
              {expirado && (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  Conexão com Google Drive expirada. Clique em <strong>Reconectar</strong> para autorizar novamente.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Conta">
                  <span data-testid="google-email">{email || "--"}</span>
                </Campo>
                <Campo label="Pasta de propostas">
                  {folder_id ? (
                    <span data-testid="google-folder">{folder_name}</span>
                  ) : (
                    <span className="text-muted-foreground">Nenhuma pasta definida ainda</span>
                  )}
                </Campo>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {folder_id ? (
                  <>
                    {folder_link && (
                      <Button asChild variant="outline" size="sm" data-testid="google-open-folder">
                        <a href={folder_link} target="_blank" rel="noreferrer">
                          <ExternalLink size={15} className="mr-1.5" /> Abrir pasta
                        </a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={abrirDialogoPasta} data-testid="google-change-folder">
                      <FolderPlus size={15} className="mr-1.5" /> Alterar pasta
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={abrirDialogoPasta} className="bg-brand hover:bg-brand-hover" data-testid="google-create-folder">
                    <FolderPlus size={15} className="mr-1.5" /> Criar pasta padrão
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={conectar} disabled={ocupado === "conectar"} data-testid="google-reconnect">
                  <RefreshCw size={15} className="mr-1.5" /> Reconectar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmarDesconexao(true)}
                  data-testid="google-disconnect"
                  className="text-muted-foreground hover:text-alert"
                >
                  <Unplug size={15} className="mr-1.5" /> Desconectar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Criar/alterar a pasta padrão. O Vorcel cria "Vorcel / <nome>" no Meu Drive
          — com o escopo mínimo, o app só enxerga o que ele mesmo cria. */}
      <Dialog open={pastaAberta} onOpenChange={(o) => ocupado !== "pasta" && setPastaAberta(o)}>
        <DialogContent data-testid="google-folder-modal">
          <DialogHeader>
            <DialogTitle className="font-heading">{folder_id ? "Alterar pasta de propostas" : "Criar pasta padrão"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Nome da pasta</Label>
            <Input
              data-testid="google-folder-name"
              value={nomePasta}
              onChange={(e) => setNomePasta(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criarPasta()}
            />
            <p className="text-xs text-muted-foreground">
              Será criada em <strong>Meu Drive › Vorcel › {nomePasta || "Propostas"}</strong>. A partir daí, toda
              proposta enviada vai automaticamente para lá.
            </p>
            {folder_id && (
              <p className="text-xs text-muted-foreground">
                A pasta atual continua no seu Drive com os documentos já enviados — só os próximos passam a ir para a nova.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPastaAberta(false)} disabled={ocupado === "pasta"}>Cancelar</Button>
            <Button
              data-testid="google-folder-save"
              onClick={criarPasta}
              disabled={!nomePasta.trim() || ocupado === "pasta"}
              className="bg-brand hover:bg-brand-hover"
            >
              {ocupado === "pasta" ? <Loader2 size={16} className="mr-2 animate-spin" /> : <FolderPlus size={16} className="mr-2" />}
              {folder_id ? "Criar e usar" : "Criar pasta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmarDesconexao}
        onOpenChange={setConfirmarDesconexao}
        title="Desconectar o Google Drive?"
        description="Nada é apagado: as propostas, os arquivos no Vorcel e os documentos já criados no seu Google Drive continuam onde estão. Apenas a conexão é removida."
        confirmLabel="Desconectar"
        loadingLabel="Desconectando..."
        loading={ocupado === "desconectar"}
        onConfirm={desconectar}
        testid="google-disconnect-dialog"
      />
    </>
  );
}
