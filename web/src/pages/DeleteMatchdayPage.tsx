import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { deleteLatestMatchday, getMatchday, listMatchdaysBySeason } from '../lib/api';
import { BackLink } from '../components/BackLink';
import { formatMatchdayFormat, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday } from '../types/graphql';

/**
 * A dedicated, type-the-date-to-confirm screen (not the lighter
 * ConfirmDialog pattern used elsewhere) — deleting a matchday can
 * reverse real season results, so it gets AWS-style friction: the exact
 * date, not just a click, and its own page rather than a dialog over
 * whatever was behind it.
 */
export function DeleteMatchdayPage() {
  const { matchdayId } = useParams<{ matchdayId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;
  const navigate = useNavigate();

  const [matchday, setMatchday] = useState<Matchday | null>(null);
  const [isLatest, setIsLatest] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchdayId) return;
    (async () => {
      try {
        const md = await getMatchday(idToken, matchdayId);
        if (!md) {
          setError('Matchday not found.');
          return;
        }
        setMatchday(md);
        const seasonMatchdays = await listMatchdaysBySeason(idToken, md.seasonId);
        const latestDate = seasonMatchdays.reduce((latest, m) => (m.date > latest ? m.date : latest), '');
        setIsLatest(md.date === latestDate);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load matchday');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchdayId]);

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (!matchdayId || !matchday || confirmText !== matchday.date) return;
    setError(null);
    setDeleting(true);
    try {
      const seasonId = await deleteLatestMatchday(idToken, matchdayId);
      navigate(`/seasons/${seasonId}/ranking`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete matchday');
      setDeleting(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!matchday) return <p className="form-error">{error ?? 'Matchday not found.'}</p>;

  if (!isLatest) {
    return (
      <div>
        <BackLink to={`/matchdays/${matchdayId}`} label="Back to matchday" />
        <h1>Delete matchday</h1>
        <p className="form-error">
          Only the most recent matchday in its season can be deleted, and this isn't it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <BackLink to={`/matchdays/${matchdayId}`} label="Back to matchday" />
      <h1>Delete matchday — {formatMatchdayWhen(matchday)}</h1>

      <section>
        <p>
          {formatMatchdayFormat(matchday.format)} ·{' '}
          <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
            {matchday.status.replace('_', ' ')}
          </span>
        </p>
        {matchday.status === 'CLOSED' ? (
          <p>
            This matchday is finished. Deleting it reverses the season points and winner points
            everyone earned that day, on top of removing its roster, matches, and results.
          </p>
        ) : (
          <p>
            This matchday hasn't finished yet. Deleting it removes its roster and any match results
            recorded so far.
          </p>
        )}
        <p className="hint-text">
          Everything about this matchday — including its match results — is exported to S3 before
          any of it is deleted.
        </p>

        {error && <p className="form-error">{error}</p>}

        <form onSubmit={handleDelete} className="matchday-form">
          <label>
            Type the date of this matchday ({matchday.date}) to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={matchday.date}
              autoComplete="off"
            />
          </label>
          <div className="detail-actions">
            <button type="button" onClick={() => navigate(`/matchdays/${matchdayId}`)} disabled={deleting}>
              Cancel
            </button>
            <button
              type="submit"
              className="button-danger"
              disabled={deleting || confirmText !== matchday.date}
            >
              {deleting ? 'Deleting…' : 'Delete matchday and its results'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
