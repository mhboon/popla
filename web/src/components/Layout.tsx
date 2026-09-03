import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Popla Cup
        </Link>
        {user && (
          <nav>
            {user.isAdmin && <Link to="/participants">Participants</Link>}
            <Link to="/seasons">Seasons</Link>
            <Link to="/matchdays">Matchdays</Link>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Sign out ({user.username})
            </button>
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">Popla Cup</footer>
    </div>
  );
}
