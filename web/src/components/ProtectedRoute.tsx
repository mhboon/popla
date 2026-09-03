import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';

export function ProtectedRoute({
  children,
  requireAdmin = true,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !user.isAdmin) return <p>Your account isn't in the Admins group.</p>;

  return <>{children}</>;
}
