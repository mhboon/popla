import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { generateRound, getMatchday, listMatches, listPlayers, recordSetResult } from '../lib/api';
import type { Match, Matchday, Player } from '../types/graphql';

const ROUNDS = [1, 2, 3, 4];

export function MatchdayPage() {
  const { matchdayId } = useParams<{ matchdayId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [matchday, setMatchday] = useState<Matchday | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingRound, setGeneratingRound] = useState<number | null>(null);

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

  async function handleGenerateRound(round: number) {
    if (!matchdayId) return;
    setError(null);
    setGeneratingRound(round);
    try {
      await generateRound(idToken, matchdayId, round);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to generate round ${round}`);
    } finally {
      setGeneratingRound(null);
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

  return (
    <div>
      <h1>Matchday — {matchday.date}</h1>
      <p>
        Format: {matchday.format} · Status: {matchday.status}
      </p>
      {error && <p className="form-error">{error}</p>}

      {ROUNDS.map((round) => {
        const roundMatches = (matchesByRound.get(round) ?? []).sort((a, b) => a.court - b.court);
        return (
          <section key={round}>
            <h2>Round {round}</h2>
            {roundMatches.length === 0 ? (
              <button
                type="button"
                onClick={() => handleGenerateRound(round)}
                disabled={generatingRound !== null}
              >
                {generatingRound === round ? 'Generating…' : `Generate round ${round}`}
              </button>
            ) : (
              <div className="match-grid">
                {roundMatches.map((match) => (
                  <MatchCard
                    key={`${match.round}-${match.court}`}
                    match={match}
                    playerName={playerName}
                    idToken={idToken}
                    matchdayId={matchdayId!}
                    onSaved={refresh}
                  />
                ))}
              </div>
            )}
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
}: {
  match: Match;
  playerName: (playerId: string) => string;
  idToken: string;
  matchdayId: string;
  onSaved: () => Promise<void>;
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
          <button type="submit" disabled={saving}>
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
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
