import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/bids/FilterBar";
import { AdvancedFilterSidebar } from "@/components/bids/AdvancedFilterSidebar";
import { BidsTable } from "@/components/bids/BidsTable";
import { BidFormModal } from "@/components/bids/BidFormModal";
import { PropostaUploadModal } from "@/components/bids/PropostaUploadModal";
import { PropostaViewerModal } from "@/components/bids/PropostaViewerModal";
import { hasProposta } from "@/components/bids/PropostaIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useData } from "@/context/DataContext";
import { toast } from "sonner";

const EMPTY_FILTERS = {
  objeto: "", pregao: "", uasg: "", data: { from: "", to: "" },
  portal: "", itens: "", modalidade: "", status: [], proposta: "all", favoritos: false,
};

export const BidsSection = () => {
  const { bids, deleteBid } = useData();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [advOpen, setAdvOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [hiddenIds, setHiddenIds] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null); // licitação aguardando confirmação
  // Proposta: `propostaBid` é o id da licitação em foco (o objeto vem sempre do
  // `bids` do contexto, para o modal refletir a atualização sem F5).
  const [propostaBidId, setPropostaBidId] = useState(null);
  const [propostaModo, setPropostaModo] = useState(null); // "upload" | "viewer" | "substituir"

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const activeAdvanced = useMemo(() => {
    let n = 0;
    if (filters.portal) n++;
    if (filters.itens) n++;
    if (filters.modalidade) n++;
    n += Array.isArray(filters.status) ? filters.status.length : filters.status ? 1 : 0;
    if (filters.proposta && filters.proposta !== "all") n++;
    if (filters.favoritos) n++;
    return n;
  }, [filters]);

  const filtered = useMemo(() => {
    return bids.filter((b) => {
      if (hiddenIds.includes(b.id)) return false;
      if (filters.objeto && !b.objeto?.toLowerCase().includes(filters.objeto.toLowerCase())) return false;
      if (filters.pregao && !(b.pregao || "").toLowerCase().includes(filters.pregao.toLowerCase())) return false;
      if (filters.uasg && !(b.uasg || "").toLowerCase().includes(filters.uasg.toLowerCase())) return false;
      if (filters.data && (filters.data.from || filters.data.to)) {
        const d = b.data_disputa || "";
        if (!d) return false;
        if (filters.data.from && d < filters.data.from) return false;
        if (filters.data.to && d > filters.data.to) return false;
      }
      if (filters.portal && b.portal !== filters.portal) return false;
      if (filters.modalidade && b.modalidade !== filters.modalidade) return false;
      if (Array.isArray(filters.status) ? filters.status.length && !filters.status.includes(b.status) : filters.status && b.status !== filters.status) return false;
      if (filters.favoritos && !b.favorito) return false;
      // O filtro segue o MESMO critério do ícone "P" da tabela: existe documento
      // de proposta? Assim a listagem nunca discorda do que o ícone mostra —
      // inclusive nas licitações marcadas à mão no modelo antigo, antes do upload.
      if (filters.proposta === "sent" && !hasProposta(b)) return false;
      if (filters.proposta === "notsent" && hasProposta(b)) return false;
      if (filters.itens && !(b.itens_list || []).includes(filters.itens.trim())) return false;
      return true;
    });
  }, [bids, filters, hiddenIds]);

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (bid) => { setEditing(bid); setModalOpen(true); };

  // Clique no "P": sem proposta abre o upload; com proposta vai direto para a leitura.
  const propostaBid = bids.find((b) => b.id === propostaBidId) || null;
  const openProposta = (bid) => {
    setPropostaBidId(bid.id);
    setPropostaModo(hasProposta(bid) ? "viewer" : "upload");
  };
  const fecharProposta = (aberto) => { if (!aberto) setPropostaModo(null); };

  // Exclusão real (soft-delete otimista + undo de 7s). Chamada só após a
  // confirmação no modal — a lógica interna permanece inalterada.
  const performDelete = (bid) => {
    setHiddenIds((prev) => [...prev, bid.id]);
    const timeout = setTimeout(async () => {
      try {
        await deleteBid(bid.id);
      } finally {
        setHiddenIds((prev) => prev.filter((id) => id !== bid.id));
      }
    }, 7000);
    toast("Licitação removida", {
      description: bid.objeto,
      duration: 7000,
      action: {
        label: "Desfazer",
        onClick: () => {
          clearTimeout(timeout);
          setHiddenIds((prev) => prev.filter((id) => id !== bid.id));
          toast.success("Exclusão desfeita");
        },
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Button onClick={openNew} data-testid="new-bid-button" className="shrink-0 bg-brand hover:bg-brand-hover">
          <Plus size={18} className="mr-1.5" /> Nova Licitação
        </Button>
        <div className="flex-1">
          <FilterBar filters={filters} setFilter={setFilter} onOpenAdvanced={() => setAdvOpen(true)} activeAdvanced={activeAdvanced} />
        </div>
      </div>

      <BidsTable bids={filtered} onEdit={openEdit} onDelete={setPendingDelete} onProposta={openProposta} />

      <AdvancedFilterSidebar open={advOpen} onOpenChange={setAdvOpen} filters={filters} setFilter={setFilter} onClear={clearFilters} />
      <BidFormModal open={modalOpen} onOpenChange={setModalOpen} editing={editing} />

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

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Excluir esta licitação?"
        description="Tem certeza que deseja excluir esta licitação? Esta ação não poderá ser desfeita."
        testid="bid-delete-dialog"
        onConfirm={() => { if (pendingDelete) performDelete(pendingDelete); setPendingDelete(null); }}
      />
    </div>
  );
};
