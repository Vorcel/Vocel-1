import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [bids, setBids] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [lists, setLists] = useState({ modalidades: [], portais: [], statuses: [] });
  const [prefs, setPrefs] = useState({ theme: "light", icms_padrao: 18, pis_cofins_padrao: 9.25, margem_padrao: 30 });
  const [company, setCompany] = useState({});
  // Integração Google do usuário logado. Nunca contém tokens — só o que o
  // backend expõe publicamente (conectado, e-mail, pasta).
  const [googleStatus, setGoogleStatus] = useState({ configured: false, connected: false });
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

  // A integração pode não estar configurada no servidor — falhar aqui não pode
  // derrubar o carregamento do resto do app.
  const refreshGoogle = useCallback(async () => {
    try {
      const { data } = await api.get("/integrations/google/status");
      setGoogleStatus(data);
    } catch {
      setGoogleStatus({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([refreshBids(), refreshExecutions(), refreshLists(), refreshPrefs(), refreshCompany(), refreshGoogle()])
      .finally(() => setLoading(false));
  }, [user, refreshBids, refreshExecutions, refreshLists, refreshPrefs, refreshCompany, refreshGoogle]);

  // ---- Bid operations ----
  // A execução é sincronizada pelo status no backend (Adjudicado cria; outro status
  // remove), então sempre recarregamos as execuções para a página refletir na hora.
  const createBid = async (payload) => {
    const { data } = await api.post("/bids", payload);
    await refreshBids();
    await refreshExecutions();
    return data;
  };
  const updateBid = async (id, payload) => {
    const { data } = await api.put(`/bids/${id}`, payload);
    await refreshBids();
    await refreshExecutions();
    return data;
  };
  const changeStatus = async (id, status) => {
    await api.patch(`/bids/${id}/status`, { status });
    await refreshBids();
    await refreshExecutions();
  };
  const toggleFavorite = async (id, favorito) => {
    setBids((prev) => prev.map((b) => (b.id === id ? { ...b, favorito } : b)));
    await api.patch(`/bids/${id}/favorite`, { favorito });
  };
  const updateObservacoes = async (id, observacoes) => {
    setBids((prev) => prev.map((b) => (b.id === id ? { ...b, observacoes } : b)));
    await api.patch(`/bids/${id}/observacoes`, { observacoes });
  };

  // ---- Proposta (documento .docx da licitação) ----
  // O backend devolve a licitação inteira já atualizada; trocamos o item no array
  // para o ícone "P" acender/apagar na hora, sem F5 e sem recarregar tudo.
  const applyBid = (bid) => {
    setBids((prev) => prev.map((b) => (b.id === bid.id ? bid : b)));
    return bid;
  };
  const sendProposta = async (method, id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api[method](`/bids/${id}/proposta`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return applyBid(data);
  };
  const uploadProposta = (id, file) => sendProposta("post", id, file);
  const replaceProposta = (id, file) => sendProposta("put", id, file);
  const removeProposta = async (id) => {
    const { data } = await api.delete(`/bids/${id}/proposta`);
    return applyBid(data);
  };
  // Enviar/tentar de novo/recriar no Drive — o backend usa sempre o original do R2.
  const syncProposta = async (id) => {
    const { data } = await api.post(`/bids/${id}/proposta/sync`);
    return applyBid(data);
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
  // Ordem manual (drag-and-drop): aplica localmente na hora (sem F5) e persiste.
  const reorderList = async (type, names) => {
    setLists((prev) => {
      const byName = Object.fromEntries((prev[type] || []).map((i) => [i.nome, i]));
      const ordered = names.map((n) => byName[n]).filter(Boolean);
      const rest = (prev[type] || []).filter((i) => !names.includes(i.nome));
      return { ...prev, [type]: [...ordered, ...rest] };
    });
    const { data } = await api.put(`/lists/${type}/reorder`, { names });
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
  // Ordenação persistida por tabela (por usuário, via /preferences -> owner_id).
  // Aplica localmente na hora (sem F5) e persiste o objeto table_sorts completo.
  const saveTableSort = useCallback(async (page, sort) => {
    let nextSorts;
    setPrefs((p) => {
      nextSorts = { ...(p.table_sorts || {}), [page]: sort };
      return { ...p, table_sorts: nextSorts };
    });
    try {
      const { data } = await api.put("/preferences", { table_sorts: nextSorts });
      setPrefs(data);
    } catch {
      /* mantém o estado otimista; próxima carga reconcilia */
    }
  }, []);

  // ---- Integração Google Drive ----
  // O consentimento acontece no Google, então é uma navegação de página inteira;
  // o backend traz o usuário de volta para /configuracoes?google=ok.
  const connectGoogle = async () => {
    const { data } = await api.get("/integrations/google/auth-url");
    window.location.href = data.url;
  };
  const createDriveFolder = async (name) => {
    const { data } = await api.post("/integrations/google/folder", { name });
    setGoogleStatus(data);
    return data;
  };
  const disconnectGoogle = async () => {
    const { data } = await api.post("/integrations/google/disconnect");
    setGoogleStatus(data);
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
        bids, executions, lists, prefs, company, googleStatus, loading, summary,
        refreshBids, refreshExecutions, refreshLists, refreshGoogle,
        connectGoogle, createDriveFolder, disconnectGoogle,
        createBid, updateBid, changeStatus, toggleFavorite, updateObservacoes, deleteBid,
        uploadProposta, replaceProposta, removeProposta, syncProposta,
        addListItem, removeListItem, updateListItem, reorderList, savePrefs, saveCompany, saveTableSort,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
