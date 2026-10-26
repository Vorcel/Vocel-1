import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronLeft, ChevronRight, CloudOff, FileDown, FileText, FileX, FolderPlus, Loader2, Pencil, Plus, RefreshCw,
  Trash2, Unplug,
} from "lucide-react";
import { listPropostas } from "@/components/bids/PropostaIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useData } from "@/context/DataContext";
import api, { authedUrl, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const fmtDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

// Botão de ação do cabeçalho — ícone + rótulo, com tooltip nativo (padrão do projeto).
const Acao = ({ icon: Icon, label, testid, title, onClick, href, disabled, className }) => {
  const classes = cn(
    "flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors",
    disabled ? "pointer-events-none opacity-40" : "hover:bg-accent hover:text-foreground",
    className
  );
  const conteudo = (<><Icon size={15} /> <span className="hidden sm:inline">{label}</span></>);
  return href ? (
    <a href={href} title={title || label} className={classes} data-testid={testid}>{conteudo}</a>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} title={title || label} className={classes} data-testid={testid}>
      {conteudo}
    </button>
  );
};

// Estado vazio/erro centralizado, quando não há como renderizar o documento.
const Aviso = ({ icon: Icon, titulo, texto, children }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="proposta-aviso">
    <Icon size={48} className="text-muted-foreground/50" />
    <p className="font-heading text-base font-semibold text-foreground">{titulo}</p>
    <p className="max-w-md text-sm text-muted-foreground">{texto}</p>
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>
  </div>
);

// Visualizador da proposta — modal grande, página de licitações ao fundo.
// A leitura usa a representação PDF da versão ATUAL do Google Docs; o Google Docs
// em si serve para EDIÇÃO, aberto em outra aba. Quando o Google não está
// disponível, o modal não quebra: oferece o DOCX original guardado no Vorcel.
//
// Várias propostas: UMA área de leitura só; as setas ← → trocam a proposta
// exibida (desabilitadas nas pontas) e o contador mostra "2 de 3". Todas as
// ações do cabeçalho valem para a proposta selecionada (`pid`).
export const PropostaViewerModal = ({ open, onOpenChange, bid, pid, onSelect, onSubstituir, onAdicionar }) => {
  const { removeProposta, syncProposta } = useData();
  const navigate = useNavigate();
  const [situacao, setSituacao] = useState(null);   // null = consultando
  const [carregandoPdf, setCarregandoPdf] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  const propostas = listPropostas(bid);
  const total = propostas.length;
  // Proposta selecionada; se ela sumiu (removida em outra tela), fica a primeira.
  const posicao = Math.max(0, propostas.findIndex((p) => p.id === pid));
  const prop = propostas[posicao] || {};
  const propId = prop.id;
  const bidId = bid?.id;
  const googleFileId = prop.google_file_id;
  const estado = situacao?.state;
  const pronto = estado === "synced";
  const linkEdicao = situacao?.web_view_link || prop.google_web_view_link;

  const pidQs = propId ? `pid=${encodeURIComponent(propId)}` : "";
  const previewUrl = bidId ? authedUrl(`/bids/${bidId}/proposta/preview.pdf?${pidQs}`) : null;
  const docxUrl = bidId ? authedUrl(`/bids/${bidId}/proposta/download?format=docx&${pidQs}`) : null;
  const pdfUrl = bidId ? authedUrl(`/bids/${bidId}/proposta/download?format=pdf&${pidQs}`) : null;
  const atualizado = fmtDateTime(prop.updated_at);

  const irPara = (i) => { if (propostas[i]) onSelect?.(propostas[i].id); };

  // Situação real do documento AGORA (ele pode ter sido apagado no Drive à mão).
  const consultar = useCallback(async () => {
    if (!bidId || !propId) return;
    setSituacao(null);
    try {
      const { data } = await api.get(`/bids/${bidId}/proposta/status`, { params: { pid: propId } });
      setSituacao(data);
    } catch {
      setSituacao({ state: "unavailable" });
    }
  }, [bidId, propId]);

  useEffect(() => {
    if (!open) return;
    setCarregandoPdf(true);
    consultar();
  }, [open, googleFileId, consultar]);

  // Setas do teclado também navegam (quando há mais de uma proposta).
  useEffect(() => {
    if (!open || total < 2) return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.("input, textarea, [contenteditable='true']")) return;
      if (e.key === "ArrowLeft" && posicao > 0) irPara(posicao - 1);
      if (e.key === "ArrowRight" && posicao < total - 1) irPara(posicao + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total, posicao]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const atualizada = await syncProposta(bidId, propId);
      if (listPropostas(atualizada).find((p) => p.id === propId)?.google_sync_status === "synced") {
        toast.success("Proposta sincronizada com o Google Drive");
      } else {
        toast.error("Não foi possível sincronizar com o Google Drive.");
      }
      await consultar();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSincronizando(false);
    }
  };

  const irParaConfiguracoes = () => { onOpenChange(false); navigate("/configuracoes?tab=integracoes"); };

  const remover = async () => {
    setRemovendo(true);
    try {
      const atualizada = await removeProposta(bidId, propId);
      toast.success("Proposta removida da licitação");
      setConfirmarRemocao(false);
      // Sobrou alguma: continua na leitura, na vizinha (a anterior, ou a nova primeira).
      const restantes = listPropostas(atualizada);
      if (restantes.length) onSelect?.(restantes[Math.max(0, posicao - 1)].id);
      else onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setRemovendo(false);
    }
  };

  const BotaoSincronizar = ({ label }) => (
    <Button size="sm" onClick={sincronizar} disabled={sincronizando} className="bg-brand hover:bg-brand-hover" data-testid="proposta-sincronizar">
      {sincronizando ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
      {label}
    </Button>
  );
  const BaixarOriginal = () => (
    <Button asChild variant="outline" size="sm"><a href={docxUrl}>Baixar DOCX original</a></Button>
  );

  if (!bid) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="proposta-viewer-modal"
          className="flex h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0"
        >
          {/* Cabeçalho: identificação + ações. O X fica no canto (padrão do Dialog). */}
          <DialogHeader className="shrink-0 space-y-0 border-b border-border px-5 py-3 pr-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <DialogTitle className="truncate font-heading text-base" title={bid.objeto}>
                    {bid.pregao ? `Proposta — Pregão ${bid.pregao}` : "Proposta"}
                  </DialogTitle>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="truncate" title={prop.filename}>{prop.filename}</span>
                    {atualizado && <span>· Atualizado em {atualizado}</span>}
                  </p>
                </div>
                {/* Navegação entre propostas: só com 2+. Pontas desabilitadas. */}
                {total > 1 && (
                  <div data-testid="proposta-nav" className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1 py-0.5">
                    <button
                      type="button" data-testid="proposta-nav-prev" title="Proposta anterior"
                      disabled={posicao === 0} onClick={() => irPara(posicao - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span data-testid="proposta-nav-counter" className="min-w-[48px] text-center text-xs font-semibold tabular-nums text-foreground">
                      {posicao + 1} de {total}
                    </span>
                    <button
                      type="button" data-testid="proposta-nav-next" title="Próxima proposta"
                      disabled={posicao === total - 1} onClick={() => irPara(posicao + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Acao
                  icon={Plus} label="Adicionar" testid="proposta-acao-adicionar"
                  title="Adicionar outra proposta a esta licitação (as atuais continuam)"
                  onClick={() => onAdicionar?.()}
                  className="border-[#0114FF]/40 text-[#0114FF]"
                />
                <Acao
                  icon={Pencil} label="Editar" testid="proposta-acao-editar"
                  title={pronto ? "Editar no Google Docs (nova aba)" : "Disponível quando a proposta estiver no Google Drive"}
                  disabled={!pronto}
                  onClick={() => window.open(linkEdicao, "_blank", "noopener,noreferrer")}
                  className={pronto ? "border-brand/40 text-brand" : undefined}
                />
                <Acao icon={FileDown} label="DOCX" testid="proposta-acao-docx" title="Baixar em Word (.docx)" href={docxUrl} />
                <Acao
                  icon={FileText} label="PDF" testid="proposta-acao-pdf"
                  title={pronto ? "Baixar em PDF" : "Disponível quando a proposta estiver no Google Drive"}
                  href={pdfUrl} disabled={!pronto}
                />
                <Acao icon={RefreshCw} label="Substituir" testid="proposta-acao-substituir" title="Enviar outro arquivo no lugar DESTA proposta" onClick={() => onSubstituir?.(propId)} />
                <Acao icon={Trash2} label="Remover" testid="proposta-acao-remover" title="Remover a proposta desta licitação" onClick={() => setConfirmarRemocao(true)} className="text-muted-foreground hover:text-alert" />
              </div>
            </div>
          </DialogHeader>

          {/* Corpo: leitura rápida do documento */}
          <div className="relative min-h-0 flex-1 bg-muted/40">
            {situacao === null && (
              <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                <Loader2 size={20} className="animate-spin" /> Abrindo a proposta...
              </div>
            )}

            {pronto && (
              <>
                {carregandoPdf && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 size={20} className="animate-spin" /> Carregando a proposta...
                  </div>
                )}
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  title="Visualização da proposta"
                  data-testid="proposta-preview"
                  className={cn("h-full w-full border-0", carregandoPdf && "opacity-0")}
                  onLoad={() => setCarregandoPdf(false)}
                />
              </>
            )}

            {estado === "not_connected" && (
              <Aviso
                icon={CloudOff}
                titulo="Proposta salva no Vorcel"
                texto="Conecte sua conta Google para visualizar aqui, editar no Google Docs e baixar em PDF a versão mais recente."
              >
                <Button size="sm" className="bg-brand hover:bg-brand-hover" data-testid="proposta-configurar-google" onClick={irParaConfiguracoes}>
                  Configurar Google Drive
                </Button>
                <BaixarOriginal />
              </Aviso>
            )}

            {estado === "no_folder" && (
              <Aviso
                icon={FolderPlus}
                titulo="Falta definir a pasta de propostas"
                texto="Sua conta Google está conectada, mas ainda não há uma pasta padrão para onde enviar as propostas."
              >
                <Button size="sm" className="bg-brand hover:bg-brand-hover" onClick={irParaConfiguracoes}>Definir pasta padrão</Button>
                <BaixarOriginal />
              </Aviso>
            )}

            {estado === "failed" && (
              <Aviso
                icon={AlertTriangle}
                titulo="Proposta salva no Vorcel, mas não sincronizada"
                texto="O arquivo está seguro aqui — não foi possível enviar a cópia para o seu Google Drive."
              >
                <BotaoSincronizar label="Tentar sincronizar novamente" />
                <BaixarOriginal />
              </Aviso>
            )}

            {estado === "missing" && (
              <Aviso
                icon={FileX}
                titulo="Este documento não foi encontrado no Google Drive"
                texto="Ele pode ter sido excluído ou movido para a lixeira. O original continua guardado no Vorcel e pode ser enviado de novo."
              >
                <BotaoSincronizar label="Recriar no Google Drive" />
                <BaixarOriginal />
              </Aviso>
            )}

            {estado === "unauthorized" && (
              <Aviso
                icon={Unplug}
                titulo="Conexão com Google Drive expirada"
                texto="A autorização foi revogada ou expirou. Reconecte sua conta para voltar a visualizar e editar a proposta."
              >
                <Button size="sm" className="bg-brand hover:bg-brand-hover" onClick={irParaConfiguracoes}>Reconectar</Button>
                <BaixarOriginal />
              </Aviso>
            )}

            {estado === "unavailable" && (
              <Aviso
                icon={AlertTriangle}
                titulo="Versão online indisponível"
                texto="Não foi possível falar com o Google Drive agora. Você ainda pode baixar o arquivo original salvo no Vorcel."
              >
                <BotaoSincronizar label="Tentar novamente" />
                <BaixarOriginal />
              </Aviso>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmarRemocao}
        onOpenChange={setConfirmarRemocao}
        title="Remover a proposta desta licitação?"
        description="O arquivo continua guardado no Vorcel e no Google Drive — apenas o vínculo com esta licitação é desfeito."
        confirmLabel="Remover"
        loadingLabel="Removendo..."
        loading={removendo}
        onConfirm={remover}
        testid="proposta-remove-dialog"
      />
    </>
  );
};
