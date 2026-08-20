import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  closeMatchday,
  generateRound,
  getMatchday,
  getMatchdayRanking,
  listMatches,
  listPlayers,
  recordSetResult,
} from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Match, Matchday, MatchdayResult, Player } from '../types/graphql';

export function MatchdayPage() {
  const { matchdayId } = useParams<{ matchdayId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [matchday, setMatchday] = useState<Matchday | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [ranking, setRanking] = useState<MatchdayResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  async function refresh() {
    if (!matchdayId) return;
    setError(null);
    try {
      const [md, matchList, playerList] = await Promise.all([
        getMatchday(idToken, matchdayId),
        listMatches(idToken, matchdayId),
        listPlayers(idToken),
      ]);
      setMatchday(md);
      setMatches(matchList);
      setPlayers(new Map(playerList.map((p) => [p.playerId, p])));
      if (md?.status === 'CLOSED') {
        setRanking(await getMatchdayRanking(idToken, matchdayId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matchday');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchdayId]);

  async function handleGenerateRound() {
    if (!matchdayId) return;
    setError(null);
    setGenerating(true);
    try {
      await generateRound(idToken, matchdayId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate the next round');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCloseMatchday() {
    if (!matchdayId) return;
    setError(null);
    setClosing(true);
    try {
      await closeMatchday(idToken, matchdayId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close matchday');
    } finally {
      setClosing(false);
    }
  }

  function playerName(playerId: string): string {
    return players.get(playerId)?.displayName ?? playerId;
  }

  if (loading) return <p>Loading…</p>;
  if (!matchday) return <p className="form-error">Matchday not found.</p>;

  const matchesByRound = new Map<number, Match[]>();
  for (const match of matches) {
    const list = matchesByRound.get(match.round) ?? [];
    list.push(match);
    matchesByRound.set(match.round, list);
  }
  const roundNumbers = [...matchesByRound.keys()].sort((a, b) => a - b);
  const currentRound = roundNumbers.at(-1) ?? 0;
  const currentRoundMatches = matchesByRound.get(currentRound) ?? [];
  const currentRoundComplete =
    currentRound > 0 && currentRoundMatches.every((m) => m.status === 'COMPLETE');

  return (
    <div>
      <h1>Matchday — {matchday.date}</h1>
      <p>
        Tournament style: {matchday.format} ·{' '}
        <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
          {matchday.status.replace('_', ' ')}
        </span>
        {matchday.status === 'SETUP' && (
          <>
            {' · '}
            <Link to={`/matchdays/${matchday.matchdayId}/edit`}>Edit</Link>
          </>
        )}
      </p>
      {error && <p className="form-error">{error}</p>}

      {matchday.status === 'CLOSED' ? (
        <section>
          <h2>Ranking</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Sets won</th>
                  <th>Game diff</th>
                  <th>Season points</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((result) => (
                  <tr key={result.playerId}>
                    <td>
                      <span className="scoreboard-chip">{result.rank}</span>
                    </td>
                    <td>{playerName(result.playerId)}</td>
                    <td className="num">{result.setsWon}</td>
                    <td className="num">{result.gameDiff}</td>
                    <td className="num">{result.seasonPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        currentRoundComplete && (
          <div className="matchday-next-actions">
            <button
              type="button"
              className="button-primary"
              onClick={handleGenerateRound}
              disabled={generating}
            >
              {generating ? 'Generating…' : `Generate round ${currentRound + 1}`}
            </button>
            <button
              type="button"
              className="button-danger"
              onClick={() => setConfirmingClose(true)}
              disabled={closing}
            >
              Finish matchday
            </button>
          </div>
        )
      )}

      <ConfirmDialog
        open={confirmingClose}
        title="Close this matchday?"
        message="This finalizes the day ranking and adds season points for every participant. It can't be undone."
        confirmLabel="Close matchday"
        danger
        busy={closing}
        onCancel={() => setConfirmingClose(false)}
        onConfirm={() => {
          setConfirmingClose(false);
          handleCloseMatchday();
        }}
      />

      {currentRound === 0 && matchday.status !== 'CLOSED' && (
        <button type="button" className="button-primary" onClick={handleGenerateRound} disabled={generating}>
          {generating ? 'Generating…' : 'Generate round 1'}
        </button>
      )}

      {[...roundNumbers].reverse().map((round) => {
        const roundMatches = (matchesByRound.get(round) ?? []).sort((a, b) => a.court - b.court);
        const readOnly = round !== currentRound || matchday.status === 'CLOSED';
        return (
          <section key={round}>
            <h2>
              Round <span className="scoreboard-chip">{round}</span>
            </h2>
            <div className="match-grid">
              {roundMatches.map((match) => (
                <MatchCard
                  key={`${match.round}-${match.court}`}
                  match={match}
                  playerName={playerName}
                  idToken={idToken}
                  matchdayId={matchdayId!}
                  onSaved={refresh}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MatchCard({
  match,
  playerName,
  idToken,
  matchdayId,
  onSaved,
  readOnly,
}: {
  match: Match;
  playerName: (playerId: string) => string;
  idToken: string;
  matchdayId: string;
  onSaved: () => Promise<void>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(match.status === 'PENDING');
  const [team1Games, setTeam1Games] = useState(match.team1Games ?? 0);
  const [team2Games, setTeam2Games] = useState(match.team2Games ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await recordSetResult(idToken, {
        matchdayId,
        round: match.round,
        court: match.court,
        team1Games,
        team2Games,
      });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="match-card">
      <p className="match-court">Court {match.court}</p>
      <p>{match.team1PlayerIds.map(playerName).join(' & ')}</p>
      <p className="match-vs">vs</p>
      <p>{match.team2PlayerIds.map(playerName).join(' & ')}</p>

      {editing ? (
        <form onSubmit={handleSave} className="score-form">
          <input
            type="number"
            min={0}
            max={6}
            value={team1Games}
            onChange={(e) => setTeam1Games(Number(e.target.value))}
            required
          />
          <span>–</span>
          <input
            type="number"
            min={0}
            max={6}
            value={team2Games}
            onChange={(e) => setTeam2Games(Number(e.target.value))}
            required
          />
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {match.status === 'COMPLETE' && (
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </form>
      ) : (
        <div className="score-display">
          <strong>
            {match.team1Games} – {match.team2Games}
          </strong>
          {!readOnly && (
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
