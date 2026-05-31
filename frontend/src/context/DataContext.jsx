import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [bids, setBids] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [lists, setLists] = useState({ modalidades: [], portais: [], statuses: [] });
  const [prefs, setPrefs] = useState({ theme: "light", icms_padrao: 18, pis_cofins_padrao: 9.25 });
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(true);

  const refreshBids = useCallback(async () => {
    const { data } = await api.get("/bids");
    setBids(data);
  }, []);

  const refreshExecutions = useCallback(async () => {
    const { data } = await api.get("/executions");
    setExecutions(data);
  }, []);

  const refreshLists = useCallback(async () => {
    const { data } = await api.get("/lists");
    setLists(data);
  }, []);

  const refreshPrefs = useCallback(async () => {
    const { data } = await api.get("/preferences");
    setPrefs(data);
  }, []);

  const refreshCompany = useCallback(async () => {
    const { data } = await api.get("/company");
    setCompany(data || {});
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([refreshBids(), refreshExecutions(), refreshLists(), refreshPrefs(), refreshCompany()])
      .finally(() => setLoading(false));
  }, [user, refreshBids, refreshExecutions, refreshLists, refreshPrefs, refreshCompany]);

  // ---- Bid operations ----
  const createBid = async (payload) => {
    const { data } = await api.post("/bids", payload);
    await refreshBids();
    if (payload.status === "Adjudicado") await refreshExecutions();
    return data;
  };
  const updateBid = async (id, payload) => {
    const { data } = await api.put(`/bids/${id}`, payload);
    await refreshBids();
    if (payload.status === "Adjudicado") await refreshExecutions();
    return data;
  };
  const changeStatus = async (id, status) => {
    await api.patch(`/bids/${id}/status`, { status });
    await refreshBids();
    if (status === "Adjudicado") await refreshExecutions();
  };
  const toggleFavorite = async (id, favorito) => {
    setBids((prev) => prev.map((b) => (b.id === id ? { ...b, favorito } : b)));
    await api.patch(`/bids/${id}/favorite`, { favorito });
  };
  const deleteBid = async (id) => {
    await api.delete(`/bids/${id}`);
    await refreshBids();
    await refreshExecutions();
  };

  // ---- Lists ----
  const addListItem = async (type, value) => {
    const { data } = await api.post(`/lists/${type}`, { value });
    setLists(data);
  };
  const removeListItem = async (type, value) => {
    const { data } = await api.delete(`/lists/${type}/${encodeURIComponent(value)}`);
    setLists(data);
  };

  // ---- Settings ----
  const savePrefs = async (payload) => {
    const { data } = await api.put("/preferences", payload);
    setPrefs(data);
    return data;
  };
  const saveCompany = async (payload) => {
    const { data } = await api.put("/company", payload);
    setCompany(data);
    return data;
  };

  // ---- Summary (computed client-side for reactivity) ----
  const now = new Date();
  const summary = {
    licitacoes_mes: bids.filter((b) => {
      if (!b.data_disputa) return false;
      const d = new Date(b.data_disputa + "T00:00:00");
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length,
    adjudicadas: bids.filter((b) => b.status === "Adjudicado").length,
    acompanhando: bids.filter((b) => b.favorito).length,
  };

  return (
    <DataContext.Provider
      value={{
        bids, executions, lists, prefs, company, loading, summary,
        refreshBids, refreshExecutions, refreshLists,
        createBid, updateBid, changeStatus, toggleFavorite, deleteBid,
        addListItem, removeListItem, savePrefs, saveCompany,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
