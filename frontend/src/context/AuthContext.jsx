import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, getToken } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = anon

  useEffect(() => {
    if (!getToken()) { setUser(false); return; }
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => { setToken(null); setUser(false); });
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-cache" });
    setToken(null);
    setUser(false);
  }, []);

  return <AuthCtx.Provider value={{ user, login, logout, isManager: user?.role === "yonetici" }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
