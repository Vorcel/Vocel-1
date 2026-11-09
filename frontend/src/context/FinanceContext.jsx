import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { finApi } from "@/lib/financeiro";
import { EntryFormModal } from "@/components/financeiro/EntryFormModal";
import { EntryActionModals } from "@/components/financeiro/EntryActions";

// Estado compartilhado do módulo Financeiro: cadastros (categorias, formas,
// contas, cartões), contadores da fila de aprovação e os modais de lançamento
// (novo / editar / duplicar / baixa / detalhes) usados por todas as páginas.
// `version` sobe a cada gravação: as páginas recarregam seus dados por ele.
const FinanceContext = createContext(null);

const EMPTY = { categoria: [], forma: [], conta: [], cartao: [], tag: [], dre_grupo: [], subcategoria: [] };

export function FinanceProvider({ children }) {
  const [cad, setCad] = useState(EMPTY);
  const [cadLoaded, setCadLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [pendentes, setPendentes] = useState({ solicitacoes: 0, atualizacoes: 0 });
  const [form, setForm] = useState(null);       // { mode: new|edit|duplicate, entry?, defaults? }
  const [action, setAction] = useState(null);   // { kind: settle|detail|cancel|delete|reopen, entry }
  const [recentDescriptions, setRecentDescriptions] = useState([]);   // memória do campo Descrição (backend, por usuário)

  const refreshCadastros = useCallback(async () => {
    const data = await finApi.cadastros();
    setCad({ ...EMPTY, ...data });
    setCadLoaded(true);
    return data;
  }, []);
  const refreshPendentes = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([finApi.solicitacoes("pendente"), finApi.atualizacoes()]);
      setPendentes({ solicitacoes: s.length, atualizacoes: a.length });
    } catch { /* contador é acessório */ }
  }, []);
  const refreshDescriptions = useCallback(() => {
    finApi.descricoesRecentes().then(setRecentDescriptions).catch(() => { /* sugestão é acessória */ });
  }, []);
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    refreshPendentes();
    refreshCadastros();
    refreshDescriptions();
  }, [refreshPendentes, refreshCadastros, refreshDescriptions]);

  useEffect(() => { refreshCadastros(); refreshPendentes(); refreshDescriptions(); }, [refreshCadastros, refreshPendentes, refreshDescriptions]);

  const byId = useMemo(() => {
    const m = {};
    for (const k of Object.keys(cad)) for (const it of cad[k] || []) m[it.id] = { ...it, kind: k };
    return m;
  }, [cad]);

  const value = {
    cad, cadLoaded, byId, refreshCadastros, version, bump, pendentes, refreshPendentes, recentDescriptions,
    novoLancamento: (defaults) => setForm({ mode: "new", defaults }),
    editarLancamento: (entry) => setForm({ mode: "edit", entry }),
    duplicarLancamento: (entry) => setForm({ mode: "duplicate", entry }),
    acaoLancamento: (kind, entry) => setAction({ kind, entry }),
  };

  return (
    <FinanceContext.Provider value={value}>
      {children}
      {form && <EntryFormModal {...form} onClose={() => setForm(null)} onSaved={() => { setForm(null); bump(); }} />}
      <EntryActionModals action={action} onClose={() => setAction(null)} onDone={bump}
        onEdit={(e) => { setAction(null); setForm({ mode: "edit", entry: e }); }}
        onDuplicate={(e) => { setAction(null); setForm({ mode: "duplicate", entry: e }); }} />
    </FinanceContext.Provider>
  );
}

export const useFinance = () => useContext(FinanceContext);

// Opções de seleção: só itens ativos, mais o atual (para não sumir ao editar
// um lançamento antigo cuja categoria/conta foi inativada).
export function activeOptions(list, currentId, filter) {
  return (list || []).filter((i) => (i.ativo !== false && (!filter || filter(i))) || i.id === currentId);
}
