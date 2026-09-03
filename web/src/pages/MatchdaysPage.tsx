import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { listMatchdaysBySeason, listSeasons } from '../lib/api';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday, Season } from '../types/graphql';

export function MatchdaysPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSeasons(idToken)
      .then(async (seasonList) => {
        setSeasons(seasonList);
        const bySeasonId = await Promise.all(
          seasonList.map((s) => listMatchdaysBySeason(idToken, s.seasonId))
        );
        setMatchdays(bySeasonId.flat());
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load matchdays'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function seasonName(seasonId: string): string {
    return seasons.find((s) => s.seasonId === seasonId)?.name ?? seasonId;
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;

  const active = matchdays.filter((m) => m.status !== 'CLOSED').sort(compareMatchdayWhenDesc);
  const history = matchdays.filter((m) => m.status === 'CLOSED').sort(compareMatchdayWhenDesc);
  const activeSeason = seasons.find((s) => s.status === 'ACTIVE');

  return (
    <div>
      <h1>Matchdays</h1>

      {isAdmin && (
        <div className="page-actions">
          {activeSeason ? (
            <Link to="/matchdays/new" className="button-primary">
              New matchday
            </Link>
          ) : (
            <p>
              No active season — <Link to="/seasons">start one</Link> first.
            </p>
          )}
        </div>
      )}

      <section>
        <h2>Active matchdays</h2>
        {active.length === 0 ? (
          <p>No matchday in progress right now.</p>
        ) : (
          <ul className="matchday-list">
            {active.map((matchday) => (
              <li key={matchday.matchdayId}>
                <Link to={`/matchdays/${matchday.matchdayId}`}>
                  <span className="matchday-list-season">{seasonName(matchday.seasonId)}</span>
                  <span className="matchday-list-date">{formatMatchdayWhen(matchday)}</span>
                  <span>{matchday.format}</span>
                  <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
                    {matchday.status.replace('_', ' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>History</h2>
        {history.length === 0 ? (
          <p>No matchdays closed yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Date</th>
                  <th>Format</th>
                </tr>
              </thead>
              <tbody>
                {history.map((matchday) => (
                  <tr key={matchday.matchdayId} className="row-clickable">
                    <td>
                      <Link to={`/matchdays/${matchday.matchdayId}`} className="row-link">
                        {seasonName(matchday.seasonId)}
                      </Link>
                    </td>
                    <td>{formatMatchdayWhen(matchday)}</td>
                    <td>{matchday.format}</td>
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
