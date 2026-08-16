/**
 * authContext.tsx
 *
 * Holds the JWT access token in React state (never in localStorage).
 * On mount, silently POSTs /auth/refresh using the httpOnly refresh cookie.
 * Exposes login(), logout(), and accessToken for the rest of the app.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface AuthContextValue {
  accessToken: string | null;
  loading: boolean;
  login: (token: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  accessToken: null,
  loading: true,
  login: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const doRefresh = useCallback(async () => {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setAccessToken(data.access_token);
        return true;
      }
    } catch (_) {}
    return false;
  }, []);

  // Silent refresh on mount
  useEffect(() => {
    doRefresh().finally(() => setLoading(false));
  }, [doRefresh]);

  // Auto-refresh every 12 minutes (token expires in 15)
  useEffect(() => {
    const interval = setInterval(() => { doRefresh(); }, 12 * 60 * 1000);
    return () => clearInterval(interval);
  }, [doRefresh]);

  const login = useCallback((token: string) => {
    setAccessToken(token);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_) {}
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ accessToken, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
