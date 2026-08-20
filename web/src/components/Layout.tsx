import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { listMatchdaysBySeason, listSeasons } from '../lib/api';
import type { Matchday } from '../types/graphql';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentMatchday, setCurrentMatchday] = useState<Matchday | null>(null);

  useEffect(() => {
    if (!user) {
      setCurrentMatchday(null);
      return;
    }
    let cancelled = false;
    listSeasons(user.idToken)
      .then((seasons) => {
        const active = seasons.find((s) => s.status === 'ACTIVE');
        if (!active) return [];
        return listMatchdaysBySeason(user.idToken, active.seasonId);
      })
      .then((matchdays) => {
        if (cancelled) return;
        const open = matchdays
          .filter((m) => m.status !== 'CLOSED')
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        setCurrentMatchday(open ?? null);
      })
      .catch(() => setCurrentMatchday(null));
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Popla Cup
        </Link>
        {user && (
          <nav>
            <Link to="/participants">Participants</Link>
            <Link to="/seasons">Seasons</Link>
            <Link to="/matchdays/new">New matchday</Link>
            {currentMatchday && (
              <Link to={`/matchdays/${currentMatchday.matchdayId}`} className="nav-current-matchday">
                Current matchday
              </Link>
            )}
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
    </div>
  );
}
