import { useState } from "react";
import { PropostaUploadModal } from "@/components/bids/PropostaUploadModal";
import { PropostaViewerModal } from "@/components/bids/PropostaViewerModal";
import { hasProposta } from "@/components/bids/PropostaIcon";
import { useData } from "@/context/DataContext";

// Fluxo da Proposta (upload / leitura rápida / substituição) extraído de
// Todas as Licitações para ser usado tal e qual em outras telas — hoje também
// no hub de documentos da Execução & Pós-Venda. Uma única fonte de verdade: o
// documento fica na própria licitação (`bid.proposta`), então abrir por
// qualquer porta mostra e grava exatamente a mesma proposta.
//
// `abrirProposta(bid)` decide o modo como sempre decidiu: sem documento abre o
// upload; com documento vai direto para a visualização rápida.
export function usePropostaFlow() {
  const { bids } = useData();
  // Guardamos só o id: o objeto vem sempre do `bids` do contexto, para o modal
  // refletir a atualização (upload/substituição) sem F5.
  const [propostaBidId, setPropostaBidId] = useState(null);
  const [propostaModo, setPropostaModo] = useState(null); // "upload" | "viewer" | "substituir"

  const propostaBid = bids.find((b) => b.id === propostaBidId) || null;

  const abrirProposta = (bid) => {
    if (!bid) return;
    setPropostaBidId(bid.id);
    setPropostaModo(hasProposta(bid) ? "viewer" : "upload");
  };
  const fecharProposta = (aberto) => { if (!aberto) setPropostaModo(null); };

  const propostaModals = (
    <>
      <PropostaUploadModal
        open={propostaModo === "upload" || propostaModo === "substituir"}
        onOpenChange={fecharProposta}
        bid={propostaBid}
        modo={propostaModo === "substituir" ? "substituir" : "novo"}
        // Salvou: já abre a leitura da proposta recém-enviada.
        onSaved={() => setPropostaModo("viewer")}
      />
      <PropostaViewerModal
        open={propostaModo === "viewer"}
        onOpenChange={fecharProposta}
        bid={propostaBid}
        onSubstituir={() => setPropostaModo("substituir")}
      />
    </>
  );

  return { abrirProposta, propostaModals };
}
