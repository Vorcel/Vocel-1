import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/bids/FilterBar";
import { AdvancedFilterSidebar } from "@/components/bids/AdvancedFilterSidebar";
import { BidsTable } from "@/components/bids/BidsTable";
import { BidFormModal } from "@/components/bids/BidFormModal";
import { useData } from "@/context/DataContext";
import { toast } from "sonner";

const EMPTY_FILTERS = {
  objeto: "", pregao: "", uasg: "", data: { from: "", to: "" },
  portal: "", itens: "", modalidade: "", status: "", favoritos: false,
};

export const BidsSection = () => {
  const { bids, deleteBid } = useData();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [advOpen, setAdvOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [hiddenIds, setHiddenIds] = useState([]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const activeAdvanced = useMemo(
    () => ["portal", "itens", "modalidade", "status"].filter((k) => filters[k]).length + (filters.favoritos ? 1 : 0),
    [filters]
  );

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
      if (filters.status && b.status !== filters.status) return false;
      if (filters.favoritos && !b.favorito) return false;
      if (filters.itens && !(b.itens_list || []).includes(filters.itens.trim())) return false;
      return true;
    });
  }, [bids, filters, hiddenIds]);

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (bid) => { setEditing(bid); setModalOpen(true); };

  const handleDelete = (bid) => {
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

      <BidsTable bids={filtered} onEdit={openEdit} onDelete={handleDelete} />

      <AdvancedFilterSidebar open={advOpen} onOpenChange={setAdvOpen} filters={filters} setFilter={setFilter} onClear={clearFilters} />
      <BidFormModal open={modalOpen} onOpenChange={setModalOpen} editing={editing} />
    </div>
  );
};
