import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { listSeasons, openRegistration } from '../lib/api';
import type { MatchdayFormat, Season } from '../types/graphql';

export function RegistrationSetupPage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const navigate = useNavigate();

  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('');
  const [format, setFormat] = useState<MatchdayFormat>('MEXICANO');
  const [maxParticipants, setMaxParticipants] = useState(16);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listSeasons(idToken)
      .then((seasons) => setActiveSeason(seasons.find((s) => s.status === 'ACTIVE') ?? null))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load seasons'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!activeSeason || maxParticipants <= 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const matchday = await openRegistration(idToken, {
        seasonId: activeSeason.seasonId,
        date,
        startTime: startTime ? `${startTime}:00` : undefined,
        format,
        maxParticipants,
      });
      navigate(`/matchdays/${matchday.matchdayId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open registration');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  if (!activeSeason) {
    return (
      <p className="form-error">
        No active season found. <a href="/seasons">Start a season</a> first.
      </p>
    );
  }

  return (
    <div>
      <h1>Open registration</h1>
      <p>Season: {activeSeason.name}</p>
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

          <label>
            Max participants
            <input
              type="number"
              min={4}
              step={4}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(Number(e.target.value))}
              required
            />
          </label>
        </div>

        <p>
          Participants join or are added once registration is open — there's no fixed list yet.
        </p>

        <button type="submit" className="button-primary" disabled={submitting || maxParticipants <= 0}>
          {submitting ? 'Opening…' : 'Open registration'}
        </button>
      </form>
    </div>
  );
}
