import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { DataProvider } from "@/context/DataContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { DocumentTitle } from "@/components/layout/VorcelMark";
import { AppLayout } from "@/components/layout/AppLayout";
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
                <Route path="/" element={<Dashboard />} />
                <Route path="/licitacoes" element={<AllBids />} />
                <Route path="/execucao" element={<Execution />} />
                <Route path="/analises" element={<Analytics />} />
                <Route path="/configuracoes" element={<Settings />} />
                <Route path="/orcamento/:bidId" element={<BidBudget />} />
                <Route path="/orcamento/:bidId/remessa/:remessaId" element={<BidBudget />} />
                <Route path="/rascunho" element={<Budget mode="draft" />} />
              </Route>
              {/* Módulo Financeiro: mesmo login e mesmos dados, layout e identidade próprios */}
              <Route path="/financeiro" element={<FinancialLayout />}>
                <Route index element={<Overview />} />
                {/* Lançamentos foi incorporado à Visão Geral: links antigos continuam funcionando */}
                <Route path="lancamentos" element={<Navigate to="/financeiro" replace />} />
                <Route path="pagar" element={<Pagar />} />
                <Route path="receber" element={<Receber />} />
                <Route path="fluxo" element={<Fluxo />} />
                <Route path="bancos" element={<Bancos />} />
                <Route path="historico" element={<Historico />} />
                <Route path="configuracoes" element={<Configuracoes />} />
                <Route path="configuracoes/:secao" element={<Configuracoes />} />
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
