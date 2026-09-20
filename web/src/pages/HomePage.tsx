import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { getMyPlayer, listMatchdayParticipants, listMatchdaysBySeason, listSeasons } from '../lib/api';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday, Season } from '../types/graphql';

type MyStatus = 'JOINING' | 'WAITLISTED' | 'NOT_REGISTERED';

interface OpenMatchday {
  matchday: Matchday;
  myStatus: MyStatus;
  registeredCount: number;
  waitlistedCount: number;
}

function myStatusLine(matchday: Matchday, myStatus: MyStatus): string | null {
  if (matchday.status === 'IN_PROGRESS') {
    return myStatus === 'JOINING' ? "You're participating" : null;
  }
  if (myStatus === 'JOINING') return "You're registered";
  if (myStatus === 'WAITLISTED') return "You're on the waiting list";
  if (matchday.selfRegistrationEnabled) return 'Open for registration';
  return null;
}

export function HomePage() {
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [openMatchdays, setOpenMatchdays] = useState<OpenMatchday[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);

  useEffect(() => {
    async function load() {
      const [seasons, myPlayer] = await Promise.all([listSeasons(idToken), getMyPlayer(idToken)]);
      setActiveSeason(seasons.find((s) => s.status === 'ACTIVE') ?? null);

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
          return {
            matchday,
            myStatus,
            registeredCount: participants.filter((p) => p.status === 'JOINING').length,
            waitlistedCount: participants.filter((p) => p.status === 'WAITLISTED').length,
          };
        })
      );

      // A matchday that's already started drops off the home page once
      // it's not something you're actually playing in — but admins keep
      // seeing it regardless, for operational access (recording scores).
      setOpenMatchdays(
        withStatus.filter(
          ({ matchday, myStatus }) => matchday.status === 'SETUP' || isAdmin || myStatus === 'JOINING'
        )
      );
    }
    // Silent on failure — this banner is a convenience shortcut, not
    // worth an error page if it fails to load.
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1>Popla Cup</h1>
      {openMatchdays.map(({ matchday, myStatus, registeredCount, waitlistedCount }) => {
        const statusLine = myStatusLine(matchday, myStatus);
        return (
          <Link
            key={matchday.matchdayId}
            to={`/matchdays/${matchday.matchdayId}`}
            className="matchday-summary-card"
          >
            <p>
              {formatMatchdayWhen(matchday)} · {matchday.status === 'SETUP' ? 'Open' : 'Started'} ·{' '}
              {matchday.selfRegistrationEnabled ? 'Self-registration open' : 'Admin-managed'}
              {matchday.maxParticipants != null && ` · ${matchday.maxParticipants} max`}
            </p>
            <p>
              {registeredCount} registered · {waitlistedCount} waiting list
            </p>
            {statusLine && <p className="matchday-summary-status">{statusLine}</p>}
          </Link>
        );
      })}
      {activeSeason && (
        <Link to={`/seasons/${activeSeason.seasonId}/ranking`} className="matchday-summary-card">
          <p>{activeSeason.name} · Season ranking</p>
        </Link>
      )}
    </div>
  );
}
