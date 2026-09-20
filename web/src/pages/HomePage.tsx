import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { listMatchdaysBySeason, listSeasons } from '../lib/api';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import type { Matchday } from '../types/graphql';

export function HomePage() {
  const { user } = useAuth();
  const idToken = user!.idToken;

  const [openMatchdays, setOpenMatchdays] = useState<Matchday[]>([]);

  useEffect(() => {
    listSeasons(idToken)
      .then(async (seasons) => {
        const bySeasonId = await Promise.all(
          seasons.map((s) => listMatchdaysBySeason(idToken, s.seasonId))
        );
        setOpenMatchdays(
          bySeasonId
            .flat()
            .filter((m) => m.status !== 'CLOSED')
            .sort(compareMatchdayWhenDesc)
        );
      })
      // Silent — this banner is a convenience shortcut, not worth an
      // error page if it fails to load.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1>Popla Cup</h1>
      {openMatchdays.map((matchday) => (
        <p key={matchday.matchdayId} className="page-actions">
          <Link to={`/matchdays/${matchday.matchdayId}`} className="button-primary">
            {matchday.status === 'REGISTRATION' ? 'Join' : 'Go to'} the {formatMatchdayWhen(matchday)}{' '}
            matchday
          </Link>
          <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
            {matchday.status.replace('_', ' ')}
          </span>
        </p>
      ))}
    </div>
  );
}
