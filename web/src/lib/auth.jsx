import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

/** Who is signed in, from the session cookie. `null` while unknown, `false` when nobody. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const refresh = useCallback(async () => {
    try { const r = await api.get('/api/auth/me'); setUser(r.user || false); }
    // Only a definite "not signed in" logs the user out; a hiccup (rate limit, network) keeps the current state.
    catch (e) { setUser((u) => (e.status === 401 || e.status === 403 || u === null ? false : u)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = useCallback(async (email, password) => { const r = await api.post('/api/auth/login', { email, password }); setUser(r.user); return r.user; }, []);
  const logout = useCallback(async () => { try { await api.post('/api/auth/logout'); } catch { /* leaving anyway */ } setUser(false); }, []);
  const value = useMemo(() => ({ user, login, logout, refresh }), [user, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
