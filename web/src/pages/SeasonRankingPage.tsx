import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { getSeason, getSeasonStanding, listPlayers } from '../lib/api';
import type { Player, Season, SeasonStanding } from '../types/graphql';

export function SeasonRankingPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [season, setSeason] = useState<Season | null>(null);
  const [standings, setStandings] = useState<SeasonStanding[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonId) return;
    Promise.all([getSeason(idToken, seasonId), getSeasonStanding(idToken, seasonId), listPlayers(idToken)])
      .then(([s, standing, playerList]) => {
        setSeason(s);
        setStandings(standing);
        setPlayers(new Map(playerList.map((p) => [p.playerId, p])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ranking'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!season) return <p className="form-error">Season not found.</p>;

  return (
    <div>
      <h1>{season.name} — season ranking</h1>
      {standings.length === 0 ? (
        <p>No matchdays have been closed yet this season.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Points</th>
                <th>Matchdays played</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((standing, index) => (
                <tr key={standing.playerId}>
                  <td>
                    <span className="scoreboard-chip">{index + 1}</span>
                  </td>
                  <td>{players.get(standing.playerId)?.displayName ?? standing.playerId}</td>
                  <td className="num">{standing.totalPoints}</td>
                  <td className="num">{standing.matchdaysPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
