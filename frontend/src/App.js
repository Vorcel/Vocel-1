import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { DataProvider } from "@/context/DataContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { DocumentTitle } from "@/components/layout/VorcelMark";
import { AppLayout } from "@/components/layout/AppLayout";
import { RequirePerm } from "@/components/layout/RequirePerm";
import { FIN_SETTINGS_PERMS, hasAnyFinance } from "@/lib/permissions";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import AllBids from "@/pages/AllBids";
import Execution from "@/pages/Execution";
import Analytics from "@/pages/Analytics";
import Settings from "@/pages/Settings";
import Budget from "@/pages/Budget";
import { FinancialLayout } from "@/components/financeiro/FinancialLayout";
import Overview from "@/pages/financeiro/Overview";
import { Pagar, Receber } from "@/pages/financeiro/PagarReceber";
import Fluxo from "@/pages/financeiro/Fluxo";
import Bancos from "@/pages/financeiro/Bancos";
import Dre from "@/pages/financeiro/Dre";
import Historico from "@/pages/financeiro/Historico";
import Configuracoes from "@/pages/financeiro/Configuracoes";

// Uma instância por licitação: trocar de orçamento reinicia estado/sincronização.
function BidBudget() {
  const { bidId, remessaId } = useParams();
  return <Budget key={remessaId ? `${bidId}:${remessaId}` : bidId} />;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <DocumentTitle />
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <DataProvider>
                    <Outlet />
                  </DataProvider>
                </ProtectedRoute>
              }
            >
              {/* Módulo Licitações (layout principal) */}
              <Route element={<AppLayout />}>
                {/* Permissões (UX): a tela some/nega; o backend é quem bloqueia de fato. */}
                <Route path="/" element={<RequirePerm any={["licitacoes.view"]}><Dashboard /></RequirePerm>} />
                <Route path="/licitacoes" element={<RequirePerm any={["licitacoes.view"]}><AllBids /></RequirePerm>} />
                <Route path="/execucao" element={<RequirePerm any={["execution.view"]}><Execution /></RequirePerm>} />
                <Route path="/analises" element={<RequirePerm any={["analytics.view"]}><Analytics /></RequirePerm>} />
                <Route path="/configuracoes" element={<Settings />} />
                <Route path="/orcamento/:bidId" element={<RequirePerm any={["orcamento.view"]}><BidBudget /></RequirePerm>} />
                <Route path="/orcamento/:bidId/remessa/:remessaId" element={<RequirePerm any={["orcamento.view"]}><BidBudget /></RequirePerm>} />
                <Route path="/rascunho" element={<RequirePerm any={["rascunho.use"]}><Budget mode="draft" /></RequirePerm>} />
              </Route>
              {/* Módulo Financeiro: mesmo login e mesmos dados, layout e identidade próprios */}
              <Route path="/financeiro" element={<RequirePerm check={hasAnyFinance}><FinancialLayout /></RequirePerm>}>
                <Route index element={<RequirePerm any={["finance.overview.view"]}><Overview /></RequirePerm>} />
                {/* Lançamentos foi incorporado à Visão Geral: links antigos continuam funcionando */}
                <Route path="lancamentos" element={<Navigate to="/financeiro" replace />} />
                <Route path="pagar" element={<RequirePerm any={["finance.pagar.view"]}><Pagar /></RequirePerm>} />
                <Route path="receber" element={<RequirePerm any={["finance.receber.view"]}><Receber /></RequirePerm>} />
                <Route path="fluxo" element={<RequirePerm any={["finance.cashflow.view"]}><Fluxo /></RequirePerm>} />
                <Route path="bancos" element={<RequirePerm any={["finance.banks.view", "finance.cards.view"]}><Bancos /></RequirePerm>} />
                <Route path="dre" element={<RequirePerm any={["finance.dre.view"]}><Dre /></RequirePerm>} />
                <Route path="historico" element={<RequirePerm any={["finance.history.view"]}><Historico /></RequirePerm>} />
                <Route path="configuracoes" element={<RequirePerm any={Object.values(FIN_SETTINGS_PERMS).flat()}><Configuracoes /></RequirePerm>} />
                <Route path="configuracoes/:secao" element={<RequirePerm any={Object.values(FIN_SETTINGS_PERMS).flat()}><Configuracoes /></RequirePerm>} />
              </Route>
            </Route>
            {/* Cadastro público desativado: qualquer rota antiga/desconhecida (ex: /register, /cadastro) volta ao login */}
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/cadastro" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
