import { useState } from "react";
import { FileText, Calculator, Receipt, FileSpreadsheet, Folder, Plus, X, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileUpload } from "@/components/FileUpload";
import { PropostaIcon, PROPOSTA_COLOR, listPropostas } from "@/components/bids/PropostaIcon";
import { CountBadge } from "@/components/CountBadge";
import { fileUrl, formatApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* Hub central de documentos da Execução & Pós-Venda (ref 2).
 *
 * Seis portas, cada uma com lógica própria — NÃO é uma categoria genérica:
 *   Edital           → anexos da licitação (bid.termo_referencia + bid.anexos)
 *   Orçamento        → abre a Planilha de Orçamento existente (/orcamento/:bidId)
 *   Proposta         → fluxo da proposta de Todas as Licitações (usePropostaFlow)
 *   Nota de Empenho  } documentos da execução (execution.documentos[categoria]),
 *   Nota Fiscal      } gravados pelas rotas /executions/:id/documentos/:categoria
 *   Outros           } + compatibilidade com os anexos antigos das etapas
 *
 * Com REMESSAS, `execution` é a remessa ativa (Nota de Empenho / Nota Fiscal /
 * Outros e o Orçamento são dela); Edital e Proposta continuam os da licitação.
 * `orcamentoPath` = planilha a abrir (padrão: orçamento original).
 *
 * Vazio = ícone cinza/desbotado e clique abre o envio. Preenchido = cor própria;
 * mais de um arquivo = badge com a quantidade REAL (vem do dado persistido) e o
 * clique abre a lista. Cores amostradas da ref 2.
 */

export const COLORS = {
  edital: "#EF4444",        // vermelho
  orcamento: "#059669",     // verde
  proposta: PROPOSTA_COLOR, // azul #0114FF (a mesma cor em todas as telas)
  nota_empenho: "#F97316",  // laranja
  nota_fiscal: "#7C3AED",   // roxo/violeta
  outros: "#475569",        // grafite
};

// Abre o documento no navegador (nova aba), pelo MESMO endpoint autenticado das
// demais telas: /api/files/{id}?auth=<token>. Nada vira público.
export const openFile = (id) => {
  const url = fileUrl(id);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
};

/* ---------------------------------- Item ---------------------------------- */
function HubItem({ testid, icon: Icon, label, title, color, count = 0, filled, onClick, onManage }) {
  const ativo = filled ?? count > 0;
  return (
    <div className="group flex min-w-0 flex-col items-center">
      <div className="relative">
        <button
          type="button"
          data-testid={testid}
          data-filled={ativo ? "1" : "0"}
          data-count={count}
          title={title}
          onClick={onClick}
          className="flex h-14 w-14 items-center justify-center rounded-xl transition-all duration-200 hover:bg-accent group-hover:scale-105"
        >
          <Icon
            size={26}
            className={cn("transition-colors duration-200", !ativo && "text-muted-foreground/40")}
            style={ativo ? { color } : undefined}
          />
        </button>
        <CountBadge count={count} color={color} testid={`${testid}-badge`} />
        {/* Gerenciar (adicionar outro arquivo / excluir) quando existe exatamente
            um documento — com 2+ o próprio clique no ícone já abre a lista. */}
        {onManage && count === 1 && (
          <button
            type="button"
            data-testid={`${testid}-manage`}
            title={`Gerenciar ${label.toLowerCase()}`}
            onClick={onManage}
            className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            <Plus size={11} />
          </button>
        )}
      </div>
      <span
        className={cn(
          "mt-1 max-w-[112px] text-balance text-center text-xs font-semibold leading-tight transition-colors",
          ativo ? "text-[#312E81] dark:text-indigo-300" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  );
}

/* ------------------------------ Lista + envio ------------------------------ */
// Mesma janela para as três situações: lista dos documentos da categoria, envio
// do primeiro arquivo e "+ Adicionar arquivo" com a categoria já preenchida.
export function DocsDialog({ open, categoria, onClose, onUpload, onRemove }) {
  const [enviando, setEnviando] = useState(false);
  if (!categoria) return null;
  const { key, label, files, color, aceita, multiplos } = categoria;

  const enviar = async (file) => {
    setEnviando(true);
    try {
      await onUpload(key, file);
      toast.success("Documento adicionado");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setEnviando(false);
    }
  };

  const remover = async (f) => {
    try {
      await onRemove(key, f);
      toast.success("Documento removido da licitação");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !enviando && onClose()}>
      <DialogContent data-testid="exec-docs-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading" style={{ color }}>{label}</DialogTitle>
          <DialogDescription>
            {files.length === 0
              ? "Nenhum documento nesta categoria. Envie o primeiro arquivo abaixo."
              : `${files.length} documento${files.length > 1 ? "s" : ""} — clique para abrir no navegador.`}
          </DialogDescription>
        </DialogHeader>

        {files.length > 0 && (
          <div className="max-h-72 space-y-1.5 overflow-y-auto py-1">
            {files.map((f, i) => (
              <div key={f.id || i} className="flex items-center gap-2 rounded-lg border border-border p-2.5 transition-colors hover:bg-accent">
                <button
                  type="button"
                  data-testid={`exec-doc-item-${key}-${i}`}
                  onClick={() => openFile(f.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FileText size={16} className="shrink-0" style={{ color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{f.filename}</span>
                    {f.tipo && <span className="block truncate text-xs text-muted-foreground">{f.tipo}</span>}
                  </span>
                  <ExternalLink size={13} className="ml-auto shrink-0 text-muted-foreground" />
                </button>
                {f.removivel !== false && (
                  <button
                    type="button"
                    data-testid={`exec-doc-remove-${key}-${i}`}
                    title="Remover da licitação (o arquivo continua guardado)"
                    onClick={() => remover(f)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-alert/10 hover:text-alert"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {(files.length === 0 || multiplos) && (
          <div className="pt-1">
            <FileUpload
              testid={`exec-doc-upload-${key}`}
              accept={aceita}
              value={null}
              onUploaded={enviar}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Categorias -------------------------------- */
// Arquivos de cada porta, lidos da fonte de verdade de cada uma. Exportado para
// que outros acessos aos MESMOS documentos (ex.: atalhos da Planilha de
// Orçamento) contem e listem exatamente o que o hub mostra.
export function buildDocCategories(execution, bid) {
  const docs = execution?.documentos || {};

  // EDITAL — fonte de verdade: a própria licitação (mesmos arquivos da coluna
  // Arquivos em Todas as Licitações). O Termo de Referência vem do formulário da
  // licitação e por isso não é removível daqui.
  const edital = [
    ...(bid?.termo_referencia ? [{ ...bid.termo_referencia, tipo: "Termo de Referência", removivel: false }] : []),
    ...(bid?.anexos || []).map((a) => ({ ...a, tipo: "Anexo / Edital", origem: "anexo" })),
  ];

  // OUTROS — documentos da categoria + compatibilidade: os anexos enviados no
  // modelo antigo (por etapa da timeline) continuam visíveis e acessíveis aqui,
  // exatamente onde estão gravados (nada é movido, copiado ou apagado).
  const legados = (execution?.timeline || []).flatMap((n, step) =>
    (n.files || []).map((f) => ({ ...f, tipo: `Anexo da etapa "${n.name}"`, origem: "timeline", step }))
  );
  const outros = [...(docs.outros || []), ...legados];

  const notaEmpenho = docs.nota_empenho || [];
  const notaFiscal = docs.nota_fiscal || [];

  return {
    edital: { key: "edital", label: "Edital", files: edital, color: COLORS.edital, aceita: ".pdf,image/*,.docx,.xlsx", multiplos: true },
    nota_empenho: { key: "nota_empenho", label: "Nota de Empenho", files: notaEmpenho, color: COLORS.nota_empenho, aceita: ".pdf,image/*,.docx,.xlsx", multiplos: true },
    nota_fiscal: { key: "nota_fiscal", label: "Nota Fiscal", files: notaFiscal, color: COLORS.nota_fiscal, aceita: ".pdf,image/*,.docx,.xlsx,.xml", multiplos: true },
    outros: { key: "outros", label: "Outros", files: outros, color: COLORS.outros, aceita: ".pdf,image/*,.docx,.xlsx,.xml,.zip", multiplos: true },
  };
}

// Clique no ícone: vazio abre o envio, 1 arquivo abre direto no navegador,
// vários abrem a lista compacta. `abrirLista(key)` abre o DocsDialog.
export const abrirCategoria = (cat, abrirLista) => {
  if (cat.files.length === 1) openFile(cat.files[0].id);
  else abrirLista(cat.key);
};

/* ----------------------------------- Hub ----------------------------------- */
export function DocumentHub({ execution, bid, orcamentoPath, onUploadDoc, onRemoveDoc, onAddEdital, onRemoveEdital, onRemoveLegacyFile, onProposta }) {
  const navigate = useNavigate();
  const [aberta, setAberta] = useState(null); // chave da categoria com a janela aberta

  const bidId = execution?.bid_id;
  const CATS = buildDocCategories(execution, bid);
  const { edital: { files: edital }, nota_empenho: { files: notaEmpenho }, nota_fiscal: { files: notaFiscal }, outros: { files: outros } } = CATS;
  const abrir = (cat) => abrirCategoria(cat, setAberta);

  const enviar = (key, file) => {
    if (key === "edital") return onAddEdital(file);
    return onUploadDoc(key, file);
  };
  const remover = (key, f) => {
    if (key === "edital") return onRemoveEdital(f.id);
    if (f.origem === "timeline") return onRemoveLegacyFile(f.step, f.id);   // anexo antigo, onde está
    return onRemoveDoc(key, f.id);
  };

  const totalPropostas = listPropostas(bid).length;

  return (
    <>
      <div
        data-testid="exec-doc-hub"
        className="mx-auto grid w-full min-w-0 max-w-4xl grid-cols-3 justify-items-center gap-x-2 gap-y-4 pt-7 sm:grid-cols-6"
      >
        <HubItem
          testid="hub-edital" icon={FileText} label="Edital" color={COLORS.edital}
          title="Abrir edital e documentos da licitação"
          count={edital.length} onClick={() => abrir(CATS.edital)} onManage={() => setAberta("edital")}
        />
        <HubItem
          testid="hub-orcamento" icon={Calculator} label="Orçamento" color={COLORS.orcamento}
          title={orcamentoPath ? "Abrir orçamento da remessa" : "Abrir planilha de orçamento"} filled
          onClick={() => bidId && navigate(orcamentoPath || `/orcamento/${bidId}`)}
        />
        <HubItem
          testid="hub-proposta" icon={PropostaIcon} label="Proposta" color={COLORS.proposta}
          title={totalPropostas > 1 ? `Abrir propostas (${totalPropostas})` : totalPropostas ? "Abrir proposta" : "Adicionar proposta"}
          count={totalPropostas}
          onClick={() => onProposta(bid)}
        />
        <HubItem
          testid="hub-nota-empenho" icon={Receipt} label="Nota de Empenho" color={COLORS.nota_empenho}
          title="Gerenciar documentos de empenho"
          count={notaEmpenho.length} onClick={() => abrir(CATS.nota_empenho)} onManage={() => setAberta("nota_empenho")}
        />
        <HubItem
          testid="hub-nota-fiscal" icon={FileSpreadsheet} label="Nota Fiscal" color={COLORS.nota_fiscal}
          title="Gerenciar notas fiscais"
          count={notaFiscal.length} onClick={() => abrir(CATS.nota_fiscal)} onManage={() => setAberta("nota_fiscal")}
        />
        <HubItem
          testid="hub-outros" icon={Folder} label="Outros" color={COLORS.outros}
          title="Gerenciar outros documentos"
          count={outros.length} onClick={() => abrir(CATS.outros)} onManage={() => setAberta("outros")}
        />
      </div>

      <DocsDialog
        open={!!aberta}
        categoria={aberta ? CATS[aberta] : null}
        onClose={() => setAberta(null)}
        onUpload={enviar}
        onRemove={remover}
      />
    </>
  );
}
