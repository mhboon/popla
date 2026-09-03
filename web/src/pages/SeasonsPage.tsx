import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { createSeason, listSeasons } from '../lib/api';
import type { Season } from '../types/graphql';

export function SeasonsPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);

  const hasActiveSeason = seasons.some((s) => s.status === 'ACTIVE');

  async function refresh() {
    setError(null);
    try {
      const result = await listSeasons(idToken);
      result.sort((a, b) => b.startDate.localeCompare(a.startDate));
      setSeasons(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seasons');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await createSeason(idToken, { name, startDate });
      setName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create season');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Seasons</h1>
      {error && <p className="form-error">{error}</p>}

      {isAdmin && (
        <section>
          <h2>Start a new season</h2>
          {hasActiveSeason && (
            <p>An active season already exists — close it first to start a new one.</p>
          )}
          <form onSubmit={handleCreate} className="inline-form">
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="button-primary" disabled={creating || hasActiveSeason}>
              {creating ? 'Creating…' : 'Create season'}
            </button>
          </form>
        </section>
      )}

      <section>
        <h2>All seasons</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Start date</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={season.seasonId} className="row-clickable">
                    <td>
                      <Link to={`/seasons/${season.seasonId}/ranking`} className="row-link">
                        {season.name}
                      </Link>
                    </td>
                    <td>
                      <span className={`status-badge status-${season.status.toLowerCase()}`}>
                        {season.status}
                      </span>
                    </td>
                    <td>{season.startDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
