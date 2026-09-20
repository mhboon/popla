import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  getMyPlayer,
  listMatchdayParticipants,
  listMatchdaysBySeason,
  listSeasons,
  setMatchdayJoining,
} from '../lib/api';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday } from '../types/graphql';

type MyStatus = 'JOINING' | 'WAITLISTED' | 'NOT_REGISTERED';

interface OpenMatchday {
  matchday: Matchday;
  myStatus: MyStatus;
}

export function HomePage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [openMatchdays, setOpenMatchdays] = useState<OpenMatchday[]>([]);
  // Null for a bare console admin with no linked Player — gates the
  // self-registration controls below, which need a Player to act on.
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [busyMatchdayId, setBusyMatchdayId] = useState<string | null>(null);

  async function refresh() {
    const [seasons, myPlayer] = await Promise.all([listSeasons(idToken), getMyPlayer(idToken)]);
    setMyPlayerId(myPlayer?.playerId ?? null);

    const bySeasonId = await Promise.all(
      seasons.map((s) => listMatchdaysBySeason(idToken, s.seasonId))
    );
    const candidates = bySeasonId
      .flat()
      .filter((m) => m.status !== 'CLOSED')
      .sort(compareMatchdayWhenDesc);

    const withStatus = await Promise.all(
      candidates.map(async (matchday) => {
        const participants = await listMatchdayParticipants(idToken, matchday.matchdayId);
        const mine = myPlayer ? participants.find((p) => p.playerId === myPlayer.playerId) : undefined;
        const myStatus: MyStatus =
          mine?.status === 'JOINING' || mine?.status === 'WAITLISTED' ? mine.status : 'NOT_REGISTERED';
        return { matchday, myStatus };
      })
    );

    // A matchday that's already started drops off the home page once
    // it's not something you're actually playing in — but admins keep
    // seeing it regardless, for operational access (recording scores).
    setOpenMatchdays(
      withStatus.filter(
        ({ matchday, myStatus }) =>
          matchday.status === 'SETUP' || isAdmin || myStatus === 'JOINING'
      )
    );
  }

  useEffect(() => {
    // Silent on failure — this banner is a convenience shortcut, not
    // worth an error page if it fails to load.
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSetJoining(matchdayId: string, joining: boolean) {
    setBusyMatchdayId(matchdayId);
    try {
      await setMatchdayJoining(idToken, { matchdayId, joining });
      await refresh();
    } catch {
      // Same "convenience shortcut" reasoning as the initial load — the
      // matchday page itself is the authoritative place to retry.
    } finally {
      setBusyMatchdayId(null);
    }
  }

  return (
    <div>
      <h1>Popla Cup</h1>
      {openMatchdays.map(({ matchday, myStatus }) => {
        const busy = busyMatchdayId === matchday.matchdayId;
        return (
          <div key={matchday.matchdayId} className="page-actions">
            <Link to={`/matchdays/${matchday.matchdayId}`} className="button-primary">
              Go to the {formatMatchdayWhen(matchday)} matchday
            </Link>
            <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
              {matchday.status.replace('_', ' ')}
            </span>
            {matchday.status === 'SETUP' &&
              matchday.selfRegistrationEnabled &&
              myPlayerId &&
              (myStatus === 'JOINING' ? (
                <>
                  <span className="status-badge">Registered</span>
                  <button type="button" disabled={busy} onClick={() => handleSetJoining(matchday.matchdayId, false)}>
                    {busy ? 'Unregistering…' : 'Unregister'}
                  </button>
                </>
              ) : myStatus === 'WAITLISTED' ? (
                <>
                  <span className="status-badge">Waiting list</span>
                  <button type="button" disabled={busy} onClick={() => handleSetJoining(matchday.matchdayId, false)}>
                    {busy ? 'Leaving…' : 'Leave waiting list'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy}
                  onClick={() => handleSetJoining(matchday.matchdayId, true)}
                >
                  {busy ? 'Registering…' : 'Register'}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
