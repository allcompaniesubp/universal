/**
 * Session context.
 *
 * The signed-in user is fetched from the server on load. There is no user
 * object in localStorage and no client-side role that the server would trust:
 * this state only drives which UI is shown. Every protected action is
 * re-authorised on the server.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type ConfigStatus, type PublicUser } from './api.ts';

interface AuthState {
  user: PublicUser | null;
  config: ConfigStatus | null;
  loading: boolean;
  setUser: (user: PublicUser | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [session, status] = await Promise.all([api.session(), api.configStatus()]);
      setUser(session.user);
      setConfig(status);
    } catch {
      // A failed session lookup means "not signed in" for UI purposes.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, config, loading, setUser, refresh, signOut }),
    [user, config, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
