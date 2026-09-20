import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { getMatchdayRanking, getSeason, listMatchdaysBySeason, listPlayerNames } from '../lib/api';
import { BackLink } from '../components/BackLink';
import { ClickableRow } from '../components/ClickableRow';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday, MatchdayResult, Player, Season } from '../types/graphql';

interface ResultRow {
  matchday: Matchday;
  result: MatchdayResult;
}

export function PlayerSeasonResultsPage() {
  const { seasonId, playerId } = useParams<{ seasonId: string; playerId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [season, setSeason] = useState<Season | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seasonId || !playerId) return;
    Promise.all([
      getSeason(idToken, seasonId),
      listMatchdaysBySeason(idToken, seasonId),
      listPlayerNames(idToken),
    ])
      .then(async ([s, matchdays, players]) => {
        setSeason(s);
        setPlayer(players.find((p) => p.playerId === playerId) ?? null);

        // Only CLOSED matchdays have a ranking (getMatchdayRanking is
        // backed by MatchdayResults, written by closeMatchday) — no
        // point querying the rest.
        const closed = matchdays.filter((m) => m.status === 'CLOSED');
        const rankings = await Promise.all(
          closed.map((m) => getMatchdayRanking(idToken, m.matchdayId))
        );
        const found: ResultRow[] = [];
        closed.forEach((matchday, i) => {
          const result = rankings[i].find((r) => r.playerId === playerId);
          if (result) found.push({ matchday, result });
        });
        found.sort((a, b) => compareMatchdayWhenDesc(a.matchday, b.matchday));
        setRows(found);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load results'))
      .finally(() => setLoading(false));
  }, [seasonId, playerId, idToken]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!season) return <p className="form-error">Season not found.</p>;

  const playerName = player
    ? player.isGuest
      ? `${player.displayName} (Guest)`
      : player.displayName
    : playerId;

  return (
    <div>
      <BackLink to={`/seasons/${season.seasonId}/ranking`} label={season.name} />
      <h1>{playerName}</h1>
      <p>Results in {season.name}</p>

      {rows.length === 0 ? (
        <p>No closed matchdays with results for this player yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rank</th>
                <th>Games won</th>
                <th>Game diff</th>
                <th>Sets won</th>
                <th>Season points</th>
                <th>Winner point</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ matchday, result }) => (
                <ClickableRow key={matchday.matchdayId} to={`/matchdays/${matchday.matchdayId}`}>
                  <td>
                    <Link to={`/matchdays/${matchday.matchdayId}`} className="row-link">
                      {formatMatchdayWhen(matchday)}
                    </Link>
                  </td>
                  <td>
                    <span className="scoreboard-chip">{result.rank}</span>
                  </td>
                  <td className="num">{result.gamesWon}</td>
                  <td className="num">{result.gameDiff}</td>
                  <td className="num">{result.setsWon}</td>
                  <td className="num">{result.seasonPoints}</td>
                  <td className="num">{result.winnerPoint ? '🏆' : ''}</td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
