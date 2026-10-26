import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { DataProvider } from "@/context/DataContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import AllBids from "@/pages/AllBids";
import Execution from "@/pages/Execution";
import Analytics from "@/pages/Analytics";
import Settings from "@/pages/Settings";
import Budget from "@/pages/Budget";

// Uma instância por licitação: trocar de orçamento reinicia estado/sincronização.
function BidBudget() {
  const { bidId, remessaId } = useParams();
  return <Budget key={remessaId ? `${bidId}:${remessaId}` : bidId} />;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <DataProvider>
                    <AppLayout />
                  </DataProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/licitacoes" element={<AllBids />} />
              <Route path="/execucao" element={<Execution />} />
              <Route path="/analises" element={<Analytics />} />
              <Route path="/configuracoes" element={<Settings />} />
              <Route path="/orcamento/:bidId" element={<BidBudget />} />
              <Route path="/orcamento/:bidId/remessa/:remessaId" element={<BidBudget />} />
              <Route path="/rascunho" element={<Budget mode="draft" />} />
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
