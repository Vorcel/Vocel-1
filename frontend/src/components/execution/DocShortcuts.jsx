import { useState } from "react";
import { Receipt, FileSpreadsheet, Folder, Plus } from "lucide-react";
import { PropostaIcon, PROPOSTA_COLOR, listPropostas } from "@/components/bids/PropostaIcon";
import { CountBadge } from "@/components/CountBadge";
import { DocsDialog, abrirCategoria, buildDocCategories } from "@/components/execution/DocumentHub";
import { useData } from "@/context/DataContext";
import { cn } from "@/lib/utils";

/* Atalhos compactos para os documentos da licitação — hoje no cabeçalho da
 * Planilha de Orçamento, ao lado do ícone vermelho de Arquivos.
 *
 * NÃO é outro sistema de documentos: lê e grava exatamente o que o hub da
 * Execução & Pós-Venda usa (`buildDocCategories` + `DocsDialog` + rotas
 * /executions/:id/documentos) e a Proposta abre o mesmo `usePropostaFlow`.
 * Mesmas regras visuais: vazio = cinza desbotado, com arquivo = cor da
 * categoria, 2+ = badge com a quantidade real.
 *
 * Nota de Empenho / Nota Fiscal / Outros pertencem à execução, que só existe
 * depois da adjudicação: antes disso ficam desabilitados (com aviso no tooltip).
 */
function Atalho({ testid, icon: Icon, label, color, count, disabled, title, onClick, onManage }) {
  const ativo = !disabled && count > 0;
  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        data-testid={testid}
        data-count={count}
        data-filled={ativo ? "1" : "0"}
        title={title || (count > 1 ? `${label} (${count})` : label)}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
          disabled ? "cursor-not-allowed" : "hover:bg-accent",
          !ativo && "text-muted-foreground/40",
          !ativo && !disabled && "hover:text-muted-foreground/70"
        )}
        style={ativo ? { color } : undefined}
      >
        <Icon size={20} />
        {!disabled && <CountBadge count={count} color={color} testid={`${testid}-badge`} small />}
      </button>
      {/* Igual ao hub: com 1 arquivo o clique abre o arquivo; o "+" abre a lista
          para adicionar outro / remover. */}
      {onManage && !disabled && count === 1 && (
        <button
          type="button"
          data-testid={`${testid}-manage`}
          title={`Gerenciar ${label.toLowerCase()}`}
          onClick={onManage}
          className="absolute -bottom-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <Plus size={9} />
        </button>
      )}
    </div>
  );
}

export function DocShortcuts({ bid, execution, onProposta }) {
  const { addExecutionDoc, removeExecutionDoc } = useData();
  const [aberta, setAberta] = useState(null);

  const semExecucao = !execution;
  const cats = buildDocCategories(execution, bid);
  // Anexos antigos das etapas (em Outros) só são removíveis pela própria
  // Execução, onde estão gravados — aqui ficam só para abrir.
  cats.outros = { ...cats.outros, files: cats.outros.files.map((f) => (f.origem === "timeline" ? { ...f, removivel: false } : f)) };
  const totalPropostas = listPropostas(bid).length;
  const avisoSemExecucao = "Disponível depois que a licitação for adjudicada (Execução & Pós-Venda)";

  const docTitle = (cat) => {
    if (semExecucao) return `${cat.label} — ${avisoSemExecucao}`;
    const n = cat.files.length;
    return n === 0 ? `${cat.label} — adicionar` : n === 1 ? `${cat.label} — abrir` : `${cat.label} (${n})`;
  };

  return (
    <div data-testid="budget-doc-shortcuts" className="flex shrink-0 items-center gap-0.5">
      <Atalho
        testid="budget-doc-proposta" icon={PropostaIcon} label="Proposta" color={PROPOSTA_COLOR}
        count={totalPropostas}
        title={totalPropostas > 1 ? `Propostas (${totalPropostas})` : totalPropostas ? "Proposta" : "Proposta — adicionar"}
        onClick={() => onProposta(bid)}
      />
      {[
        { cat: cats.nota_empenho, icon: Receipt, testid: "budget-doc-nota-empenho" },
        { cat: cats.nota_fiscal, icon: FileSpreadsheet, testid: "budget-doc-nota-fiscal" },
        { cat: cats.outros, icon: Folder, testid: "budget-doc-outros" },
      ].map(({ cat, icon, testid }) => (
        <Atalho
          key={cat.key} testid={testid} icon={icon} label={cat.label} color={cat.color}
          count={cat.files.length} disabled={semExecucao} title={docTitle(cat)}
          onClick={() => abrirCategoria(cat, setAberta)}
          onManage={() => setAberta(cat.key)}
        />
      ))}

      <DocsDialog
        open={!!aberta}
        categoria={aberta ? cats[aberta] : null}
        onClose={() => setAberta(null)}
        onUpload={(key, file) => addExecutionDoc(bid.id, key, file)}
        onRemove={(key, f) => removeExecutionDoc(bid.id, key, f.id)}
      />
    </div>
  );
}
