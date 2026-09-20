import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { createMatchday, createPlayer, getMatchday, listPlayers, listSeasons, updateMatchday } from '../lib/api';
import { sortByName } from '../lib/sort';
import { PlayerMultiSelect } from '../components/PlayerMultiSelect';
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
  const [startTime, setStartTime] = useState('');
  const [format, setFormat] = useState<MatchdayFormat>('MEXICANO');
  const [selfRegistrationEnabled, setSelfRegistrationEnabled] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPhone, setNewPlayerPhone] = useState('');
  const [creatingPlayer, setCreatingPlayer] = useState(false);

  useEffect(() => {
    // Edit mode manages date/format/self-registration only — the roster
    // itself is managed from the matchday page (bulk multiselect there),
    // so there's no need to fetch the player list or current roster here.
    const loaders: [Promise<Player[]>, Promise<Season[]>] = editing
      ? [Promise.resolve([]), listSeasons(idToken)]
      : [listPlayers(idToken), listSeasons(idToken)];

    Promise.all([...loaders, matchdayId ? getMatchday(idToken, matchdayId) : Promise.resolve(null)])
      .then(([playerList, seasons, matchday]) => {
        setPlayers(sortByName(playerList));
        setActiveSeason(seasons.find((s) => s.status === 'ACTIVE') ?? null);
        if (matchday) {
          if (matchday.status !== 'SETUP') {
            setError('This matchday can no longer be edited — round 1 has already been generated.');
          }
          setDate(matchday.date);
          setStartTime(matchday.startTime ? matchday.startTime.slice(0, 5) : '');
          setFormat(matchday.format);
          setSelfRegistrationEnabled(matchday.selfRegistrationEnabled);
          setMaxParticipants(matchday.maxParticipants != null ? String(matchday.maxParticipants) : '');
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

  async function handleAddPlayer(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreatingPlayer(true);
    try {
      const player = await createPlayer(idToken, {
        displayName: newPlayerName,
        phone: newPlayerPhone || undefined,
      });
      setPlayers((prev) => sortByName([...prev, player]));
      setSelected((prev) => new Set(prev).add(player.playerId));
      setNewPlayerName('');
      setNewPlayerPhone('');
      setAddingPlayer(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add participant');
    } finally {
      setCreatingPlayer(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editing && matchdayId) {
        await updateMatchday(idToken, {
          matchdayId,
          date,
          startTime: startTime ? `${startTime}:00` : undefined,
          format,
          selfRegistrationEnabled,
          maxParticipants: maxParticipants ? Number(maxParticipants) : null,
        });
        navigate(`/matchdays/${matchdayId}`);
      } else {
        if (!activeSeason) return;
        const matchday = await createMatchday(idToken, {
          seasonId: activeSeason.seasonId,
          date,
          startTime: startTime ? `${startTime}:00` : undefined,
          format,
          participantIds: [...selected],
          selfRegistrationEnabled,
          maxParticipants: maxParticipants ? Number(maxParticipants) : undefined,
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

      <form onSubmit={handleSubmit} className="matchday-form">
        <div className="inline-form">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>

          <label>
            Time (optional)
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>

          <label>
            Tournament style
            <select value={format} onChange={(e) => setFormat(e.target.value as MatchdayFormat)}>
              <option value="MEXICANO">Mexicano</option>
              <option value="AMERICANO">Americano</option>
            </select>
          </label>
        </div>

        <div className="inline-form">
          <label>
            <input
              type="checkbox"
              checked={selfRegistrationEnabled}
              onChange={(e) => setSelfRegistrationEnabled(e.target.checked)}
            />
            Allow self-registration
          </label>

          <label>
            Max participants (optional — leave blank for no cap)
            <input
              type="number"
              min={1}
              step={1}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
              placeholder="No cap"
            />
          </label>
        </div>
        <p>
          {selfRegistrationEnabled
            ? "Participants can join or leave themselves until you start the matchday — you can still add or remove anyone yourself too."
            : 'Only you can add or remove participants — nobody can self-register.'}{' '}
          A cap waitlists anyone joining past it, whether they added themselves or you did.
        </p>

        {!editing && (
          <fieldset>
            <legend>Participants</legend>
            <p className="participant-count">
              <span className="scoreboard-chip">{selected.size}</span>
              {' selected — pick as many or as few as you already know; add more later on the matchday page'}
            </p>
            <PlayerMultiSelect players={players} selected={selected} onToggle={toggle} />

            {addingPlayer ? (
              <form onSubmit={handleAddPlayer} className="inline-form">
                <label>
                  Name
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Phone (optional)
                  <input
                    type="text"
                    value={newPlayerPhone}
                    onChange={(e) => setNewPlayerPhone(e.target.value)}
                  />
                </label>
                <button type="submit" className="button-primary" disabled={creatingPlayer}>
                  {creatingPlayer ? 'Adding…' : 'Add participant'}
                </button>
                <button type="button" onClick={() => setAddingPlayer(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setAddingPlayer(true)}>
                + New participant
              </button>
            )}
          </fieldset>
        )}

        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
