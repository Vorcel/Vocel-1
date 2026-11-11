import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { makeCan } from "@/lib/permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(false);
      setReady(true);
      return;
    }
    api
      .get("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => {
        localStorage.removeItem("token");
        setUser(false);
      })
      .finally(() => setReady(true));
  }, []);

  // Permissões mudam no servidor sem novo login (o administrador edita o
  // usuário): ao receber um 403, recarrega o /auth/me para menus e botões
  // refletirem o estado real. Limitado a uma vez a cada poucos segundos.
  const lastRefresh = useRef(0);
  const refreshMe = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefresh.current < 3000) return;
    lastRefresh.current = now;
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch { /* 401 já é tratado pelo interceptor */ }
  }, []);
  useEffect(() => {
    const onForbidden = () => refreshMe();
    window.addEventListener("vorcel:forbidden", onForbidden);
    return () => window.removeEventListener("vorcel:forbidden", onForbidden);
  }, [refreshMe]);

  // Aceita e-mail (usuário principal) ou login (usuário interno).
  const login = async (identifier, password) => {
    const { data } = await api.post("/auth/login", { login: identifier, password });
    localStorage.setItem("token", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    localStorage.removeItem("token");
    setUser(false);
  };

  // O perfil salvo (PUT /auth/profile) não traz permissões: mescla com o atual.
  const updateProfile = useCallback((profile) => setUser((u) => (u ? { ...u, ...profile, id: u.id } : u)), []);

  const perms = useMemo(() => makeCan(user), [user]);

  return (
    <AuthContext.Provider value={{ user, setUser: updateProfile, ready, login, logout, refreshMe, ...perms }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
