import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { getSeason, listMatchdaysBySeason } from '../lib/api';
import type { Matchday, Season } from '../types/graphql';

export function MatchdaysPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [season, setSeason] = useState<Season | null>(null);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    Promise.all([getSeason(idToken, seasonId), listMatchdaysBySeason(idToken, seasonId)])
      .then(([s, matchdayList]) => {
        setSeason(s);
        setMatchdays([...matchdayList].sort((a, b) => b.date.localeCompare(a.date)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load matchdays'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!season) return <p className="form-error">Season not found.</p>;

  return (
    <div>
      <h1>{season.name} — matchdays</h1>
      {matchdays.length === 0 ? (
        <p>No matchdays yet in this season.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Format</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {matchdays.map((matchday) => (
              <tr key={matchday.matchdayId}>
                <td>{matchday.date}</td>
                <td>{matchday.format}</td>
                <td>
                  <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
                    {matchday.status.replace('_', ' ')}
                  </span>
                </td>
                <td>
                  <Link to={`/matchdays/${matchday.matchdayId}`}>
                    {matchday.status === 'CLOSED' ? 'View' : 'Open'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
