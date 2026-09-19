import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand" onClick={closeMenu}>
          <img src="/logo-popla.png" alt="Popla Cup" className="brand-logo" />
        </Link>
        {user && (
          <>
            <button
              type="button"
              className="icon-button menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
            <nav className={menuOpen ? 'nav-open' : undefined}>
              {user.isAdmin && (
                <Link to="/participants" onClick={closeMenu}>
                  Participants
                </Link>
              )}
              <Link to="/seasons" onClick={closeMenu}>
                Seasons
              </Link>
              <Link to="/matchdays" onClick={closeMenu}>
                Matchdays
              </Link>
              <Link to="/account" onClick={closeMenu}>
                Account
              </Link>
            </nav>
          </>
        )}
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">Popla Cup</footer>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
