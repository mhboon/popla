import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  createMatchday,
  getMatchday,
  listMatchdayParticipantIds,
  listPlayers,
  listSeasons,
  updateMatchday,
} from '../lib/api';
import type { MatchdayFormat, Player, Season } from '../types/graphql';

export function MatchdaySetupPage() {
  const { matchdayId } = useParams<{ matchdayId?: string }>();
  const editing = Boolean(matchdayId);

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
    const loaders: [Promise<Player[]>, Promise<Season[]>] = [listPlayers(idToken), listSeasons(idToken)];

    Promise.all([
      ...loaders,
      matchdayId ? getMatchday(idToken, matchdayId) : Promise.resolve(null),
      matchdayId ? listMatchdayParticipantIds(idToken, matchdayId) : Promise.resolve<string[]>([]),
    ])
      .then(([playerList, seasons, matchday, participantIds]) => {
        playerList.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPlayers(playerList);
        setActiveSeason(seasons.find((s) => s.status === 'ACTIVE') ?? null);
        if (matchday) {
          if (matchday.status !== 'SETUP') {
            setError('This matchday can no longer be edited — round 1 has already been generated.');
          }
          setDate(matchday.date);
          setFormat(matchday.format);
        }
        if (participantIds.length > 0) {
          setSelected(new Set(participantIds));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load setup data'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchdayId]);

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
    if (!validCount) return;
    setError(null);
    setSubmitting(true);
    try {
      if (editing && matchdayId) {
        await updateMatchday(idToken, {
          matchdayId,
          date,
          format,
          participantIds: [...selected],
        });
        navigate(`/matchdays/${matchdayId}`);
      } else {
        if (!activeSeason) return;
        const matchday = await createMatchday(idToken, {
          seasonId: activeSeason.seasonId,
          date,
          format,
          participantIds: [...selected],
        });
        navigate(`/matchdays/${matchday.matchdayId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save matchday');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  if (!editing && !activeSeason) {
    return (
      <p className="form-error">
        No active season found. <a href="/seasons">Start a season</a> first.
      </p>
    );
  }

  return (
    <div>
      <h1>{editing ? 'Edit matchday' : 'New matchday'}</h1>
      {activeSeason && <p>Season: {activeSeason.name}</p>}
      {error && <p className="form-error">{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <fieldset>
          <legend>Tournament style</legend>
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
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
