import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  closeSeason,
  getSeason,
  getSeasonStanding,
  getSeasonWinnerRanking,
  listMatchdaysBySeason,
  listPlayerNames,
  listSeasons,
  reopenSeason,
} from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareButton } from '../components/ShareButton';
import { assignCompetitionRank } from '../lib/ranking';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import { formatSeasonRankingShare, formatSeasonWinnerRankingShare } from '../lib/shareFormat';
import type { Matchday, Player, Season, SeasonStanding } from '../types/graphql';

export function SeasonRankingPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [season, setSeason] = useState<Season | null>(null);
  const [hasOtherActiveSeason, setHasOtherActiveSeason] = useState(false);
  const [standings, setStandings] = useState<SeasonStanding[]>([]);
  const [winnerStandings, setWinnerStandings] = useState<SeasonStanding[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [activeTab, setActiveTab] = useState<'ranking' | 'winners' | 'matchdays'>('ranking');

  async function refresh() {
    if (!seasonId) return;
    setError(null);
    try {
      const [s, allSeasons, standing, winnerStanding, matchdayList, playerList] = await Promise.all([
        getSeason(idToken, seasonId),
        listSeasons(idToken),
        getSeasonStanding(idToken, seasonId),
        getSeasonWinnerRanking(idToken, seasonId),
        listMatchdaysBySeason(idToken, seasonId),
        listPlayerNames(idToken),
      ]);
      setSeason(s);
      setHasOtherActiveSeason(allSeasons.some((x) => x.status === 'ACTIVE' && x.seasonId !== seasonId));
      setStandings(standing);
      setWinnerStandings(winnerStanding);
      setMatchdays(matchdayList);
      setPlayers(new Map(playerList.map((p) => [p.playerId, p])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load season');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  async function handleClose() {
    if (!seasonId) return;
    setError(null);
    setBusy(true);
    try {
      await closeSeason(idToken, seasonId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close season');
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!seasonId) return;
    setError(null);
    setBusy(true);
    try {
      await reopenSeason(idToken, seasonId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen season');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!season) return <p className="form-error">Season not found.</p>;

  const ranked = assignCompetitionRank(standings, (a, b) => a.totalPoints === b.totalPoints);
  const rankedByWinnerPoints = assignCompetitionRank(
    winnerStandings,
    (a, b) => a.winnerPoints === b.winnerPoints
  );
  const orderedMatchdays = [...matchdays].sort(compareMatchdayWhenDesc);
  const playerName = (playerId: string) => players.get(playerId)?.displayName ?? playerId;

  return (
    <div>
      <h1>{season.name}</h1>
      <p>
        Started {season.startDate} ·{' '}
        <span className={`status-badge status-${season.status.toLowerCase()}`}>{season.status}</span>
      </p>
      {error && <p className="form-error">{error}</p>}

      {isAdmin && (season.status === 'ACTIVE' || season.status === 'CLOSED') && (
        <div className="detail-actions">
          {season.status === 'ACTIVE' && (
            <button
              type="button"
              className="button-danger"
              onClick={() => setConfirmingClose(true)}
              disabled={busy}
            >
              Close season
            </button>
          )}
          {season.status === 'CLOSED' && (
            <button
              type="button"
              className="button-primary"
              onClick={handleReopen}
              disabled={busy || hasOtherActiveSeason}
              title={hasOtherActiveSeason ? 'Close the active season first' : undefined}
            >
              {busy ? 'Reopening…' : 'Reopen season'}
            </button>
          )}
        </div>
      )}

      {isAdmin && (
        <ConfirmDialog
          open={confirmingClose}
          title="Close this season?"
          message={`Closing "${season.name}" finalizes its ranking. It stays viewable, and you can reopen it later if the active season slot is free.`}
          confirmLabel="Close season"
          danger
          busy={busy}
          onCancel={() => setConfirmingClose(false)}
          onConfirm={() => {
            setConfirmingClose(false);
            handleClose();
          }}
        />
      )}

      <div className="tabs">
        <button
          type="button"
          className={`tab-button${activeTab === 'ranking' ? ' tab-button-active' : ''}`}
          onClick={() => setActiveTab('ranking')}
        >
          Ranking
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === 'winners' ? ' tab-button-active' : ''}`}
          onClick={() => setActiveTab('winners')}
        >
          Round winners
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === 'matchdays' ? ' tab-button-active' : ''}`}
          onClick={() => setActiveTab('matchdays')}
        >
          Matchdays
        </button>
      </div>

      {activeTab === 'ranking' && (
        <section>
          <div className="section-heading">
            <h2>Ranking</h2>
            {standings.length > 0 && (
              <ShareButton
                title="Popla Cup ranking"
                text={formatSeasonRankingShare(season, ranked, playerName)}
              />
            )}
          </div>
          {standings.length === 0 ? (
            <p>No matchdays have been closed yet this season.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Points</th>
                    <th>Matchdays played</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((standing) => (
                    <tr key={standing.playerId}>
                      <td>
                        <span className="scoreboard-chip">{standing.rank}</span>
                      </td>
                      <td>{playerName(standing.playerId)}</td>
                      <td className="num">{standing.totalPoints}</td>
                      <td className="num">{standing.matchdaysPlayed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'winners' && (
        <section>
          <div className="section-heading">
            <h2>Round winners</h2>
            {winnerStandings.length > 0 && (
              <ShareButton
                title="Popla Cup round winners"
                text={formatSeasonWinnerRankingShare(season, rankedByWinnerPoints, playerName)}
              />
            )}
          </div>
          {winnerStandings.length === 0 ? (
            <p>No matchdays have been closed yet this season.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Winner points</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedByWinnerPoints.map((standing) => (
                    <tr key={standing.playerId}>
                      <td>
                        <span className="scoreboard-chip">{standing.rank}</span>
                      </td>
                      <td>{playerName(standing.playerId)}</td>
                      <td className="num">{standing.winnerPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'matchdays' && (
        <section>
          <h2>Matchdays</h2>
          {orderedMatchdays.length === 0 ? (
            <p>No matchdays yet this season.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Format</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedMatchdays.map((matchday) => (
                    <tr key={matchday.matchdayId} className="row-clickable">
                      <td>
                        <Link to={`/matchdays/${matchday.matchdayId}`} className="row-link">
                          {formatMatchdayWhen(matchday)}
                        </Link>
                      </td>
                      <td>{matchday.format}</td>
                      <td>
                        <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
                          {matchday.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
