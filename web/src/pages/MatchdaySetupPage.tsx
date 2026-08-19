import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { createMatchday, listPlayers, listSeasons } from '../lib/api';
import type { MatchdayFormat, Player, Season } from '../types/graphql';

export function MatchdaySetupPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const navigate = useNavigate();

  const [players, setPlayers] = useState<Player[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [format, setFormat] = useState<MatchdayFormat>('MEXICANO');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([listPlayers(idToken), listSeasons(idToken)])
      .then(([playerList, seasons]) => {
        playerList.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPlayers(playerList);
        setActiveSeason(seasons.find((s) => s.status === 'ACTIVE') ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load setup data'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(playerId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  const count = selected.size;
  const validCount = count > 0 && count % 4 === 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!activeSeason || !validCount) return;
    setError(null);
    setSubmitting(true);
    try {
      const matchday = await createMatchday(idToken, {
        seasonId: activeSeason.seasonId,
        date,
        format,
        participantIds: [...selected],
      });
      navigate(`/matchdays/${matchday.matchdayId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create matchday');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  if (!activeSeason) {
    return (
      <p className="form-error">
        No active season found. Create one via the API first (season management UI isn't built
        yet).
      </p>
    );
  }

  return (
    <div>
      <h1>New matchday</h1>
      <p>Season: {activeSeason.name}</p>
      {error && <p className="form-error">{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <fieldset>
          <legend>Format</legend>
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'MEXICANO'}
              onChange={() => setFormat('MEXICANO')}
            />
            Mexicano
          </label>
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'AMERICANO'}
              onChange={() => setFormat('AMERICANO')}
            />
            Americano
          </label>
        </fieldset>

        <fieldset>
          <legend>
            Participants ({count} selected{validCount ? '' : ' — must be a multiple of 4'})
          </legend>
          <div className="participant-grid">
            {players.map((player) => (
              <label key={player.playerId} className="participant-checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(player.playerId)}
                  onChange={() => toggle(player.playerId)}
                />
                {player.displayName}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" disabled={!validCount || submitting}>
          {submitting ? 'Creating…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
