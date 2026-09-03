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

    // The refresh token is valid for 30 days (see backend-stack.ts) so a
    // participant isn't re-verifying by SMS on every visit — but that's
    // pointless unless the short-lived (~1hr) cached ID token actually
    // gets renewed in the background while a tab stays open. getSession()
    // silently refreshes via the stored refresh token when the cached
    // tokens are stale.
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
