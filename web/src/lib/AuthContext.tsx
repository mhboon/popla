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
