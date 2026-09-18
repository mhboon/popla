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
          <img src="/logo-popla.png" alt="Popla Cup" className="brand-logo" />
        </Link>
        {user && (
          <nav>
            {user.isAdmin && <Link to="/participants">Participants</Link>}
            <Link to="/seasons">Seasons</Link>
            <Link to="/matchdays">Matchdays</Link>
            <Link to="/account">Account</Link>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              aria-label={`Sign out (${user.username})`}
              title={`Sign out (${user.username})`}
            >
              <SignOutIcon />
            </button>
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">Popla Cup</footer>
    </div>
  );
}

function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
