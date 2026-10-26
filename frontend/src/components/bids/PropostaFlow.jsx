import { useState } from "react";
import { PropostaUploadModal } from "@/components/bids/PropostaUploadModal";
import { PropostaViewerModal } from "@/components/bids/PropostaViewerModal";
import { hasProposta, listPropostas } from "@/components/bids/PropostaIcon";
import { useData } from "@/context/DataContext";

// Fluxo da Proposta (upload / leitura rápida / substituição) extraído de
// Todas as Licitações para ser usado tal e qual em outras telas — hoje também
// no hub de documentos da Execução & Pós-Venda e na Planilha de Orçamento. Uma
// única fonte de verdade: as propostas ficam na própria licitação
// (`bid.propostas`), então abrir por qualquer porta mostra e grava exatamente
// as mesmas propostas.
//
// `abrirProposta(bid)` decide o modo como sempre decidiu: sem documento abre o
// upload; com documento vai direto para a visualização rápida (a primeira; com
// várias, as setas do visualizador navegam entre elas).
export function usePropostaFlow() {
  const { bids } = useData();
  // Guardamos só ids: o objeto vem sempre do `bids` do contexto, para o modal
  // refletir a atualização (upload/substituição) sem F5.
  const [propostaBidId, setPropostaBidId] = useState(null);
  const [propostaModo, setPropostaModo] = useState(null); // "upload" | "viewer" | "substituir"
  const [propostaId, setPropostaId] = useState(null);     // proposta exibida/alvo da substituição

  const propostaBid = bids.find((b) => b.id === propostaBidId) || null;

  const abrirProposta = (bid) => {
    if (!bid) return;
    setPropostaBidId(bid.id);
    setPropostaId(listPropostas(bid)[0]?.id ?? null);
    setPropostaModo(hasProposta(bid) ? "viewer" : "upload");
  };
  // Fechar o envio/substituição volta para a leitura quando já existe proposta.
  const fecharEnvio = (aberto) => {
    if (aberto) return;
    setPropostaModo(hasProposta(propostaBid) ? "viewer" : null);
  };
  const fecharViewer = (aberto) => { if (!aberto) setPropostaModo(null); };

  const propostaModals = (
    <>
      <PropostaUploadModal
        open={propostaModo === "upload" || propostaModo === "substituir"}
        onOpenChange={fecharEnvio}
        bid={propostaBid}
        modo={propostaModo === "substituir" ? "substituir" : "novo"}
        pid={propostaModo === "substituir" ? propostaId : null}
        // Salvou: abre a leitura da proposta recém-enviada (adicionada = a última).
        onSaved={(atualizada) => {
          if (propostaModo !== "substituir") setPropostaId(listPropostas(atualizada).slice(-1)[0]?.id ?? null);
          setPropostaModo("viewer");
        }}
      />
      <PropostaViewerModal
        open={propostaModo === "viewer"}
        onOpenChange={fecharViewer}
        bid={propostaBid}
        pid={propostaId}
        onSelect={setPropostaId}
        onSubstituir={(pid) => { setPropostaId(pid); setPropostaModo("substituir"); }}
        onAdicionar={() => setPropostaModo("upload")}
      />
    </>
  );

  return { abrirProposta, propostaModals };
}
