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
  const updateObservacoes = async (id, observacoes) => {
    setBids((prev) => prev.map((b) => (b.id === id ? { ...b, observacoes } : b)));
    await api.patch(`/bids/${id}/observacoes`, { observacoes });
  };
  const deleteBid = async (id) => {
    await api.delete(`/bids/${id}`);
    await refreshBids();
    await refreshExecutions();
  };

  // ---- Lists ----
  const addListItem = async (type, nome, cor) => {
    const { data } = await api.post(`/lists/${type}`, { nome, cor });
    setLists(data);
  };
  const updateListItem = async (type, oldNome, nome, cor) => {
    const { data } = await api.put(`/lists/${type}`, { old_nome: oldNome, nome, cor });
    setLists(data);
    await refreshBids();
  };
  const removeListItem = async (type, nome) => {
    const { data } = await api.delete(`/lists/${type}/${encodeURIComponent(nome)}`);
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
  const inMonth = (dateStr, year, month) => {
    if (!dateStr) return false;
    const d = new Date(dateStr + "T00:00:00");
    return d.getFullYear() === year && d.getMonth() === month;
  };
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const prevY = prev.getFullYear();
  const prevM = prev.getMonth();

  const pctChange = (cur, old) => {
    if (old === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - old) / old) * 100);
  };

  const mesAtual = bids.filter((b) => inMonth(b.data_disputa, curY, curM)).length;
  const mesAnterior = bids.filter((b) => inMonth(b.data_disputa, prevY, prevM)).length;
  const adjMesAtual = bids.filter((b) => b.status === "Adjudicado" && inMonth(b.data_disputa, curY, curM)).length;
  const adjMesAnterior = bids.filter((b) => b.status === "Adjudicado" && inMonth(b.data_disputa, prevY, prevM)).length;

  const summary = {
    licitacoes_mes: mesAtual,
    licitacoes_mes_delta: pctChange(mesAtual, mesAnterior),
    adjudicadas: bids.filter((b) => b.status === "Adjudicado").length,
    adjudicadas_delta: pctChange(adjMesAtual, adjMesAnterior),
    acompanhando: bids.filter((b) => b.favorito).length,
  };

  return (
    <DataContext.Provider
      value={{
        bids, executions, lists, prefs, company, loading, summary,
        refreshBids, refreshExecutions, refreshLists,
        createBid, updateBid, changeStatus, toggleFavorite, updateObservacoes, deleteBid,
        addListItem, removeListItem, updateListItem, savePrefs, saveCompany,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
