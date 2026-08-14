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

  // Silent refresh on mount using the httpOnly refresh cookie
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          credentials: 'include', // send the httpOnly cookie
        });
        if (res.ok) {
          const data = await res.json();
          setAccessToken(data.access_token);
        }
      } catch (_) {
        // No valid cookie — user must log in
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
