import { createContext, useEffect, useState, type ReactNode } from 'react';
import { getCurrentSession, logout as cognitoLogout, toAuthenticatedUser, type AuthenticatedUser } from './auth';

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  setUser: (user: AuthenticatedUser | null) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentSession()
      .then((session) => setUser(session ? toAuthenticatedUser(session) : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    // Keeps `user` (username, admin flag, token) in step with the stored
    // session while a tab stays open. API calls don't depend on this
    // timer for a valid token — graphqlRequest looks the token up itself
    // at request time (see web/src/lib/graphqlClient.ts), because a timer
    // only notices an expired token at its next tick, and browsers pause
    // timers in background tabs.
    const interval = setInterval(
      () => {
        getCurrentSession()
          .then((session) => {
            if (session) setUser(toAuthenticatedUser(session));
          })
          .catch(() => {
            // Refresh token itself expired/revoked — leave the current
            // (now-stale) user in place; the next API call will surface
            // the auth failure naturally.
          });
      },
      5 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, []);

  const logout = () => {
    cognitoLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
