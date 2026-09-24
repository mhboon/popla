import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  closeSeason,
  getSeason,
  getSeasonStanding,
  getSeasonWeightedRanking,
  getSeasonWinnerRanking,
  listMatchdaysBySeason,
  listPlayerNames,
  listSeasons,
  reopenSeason,
} from '../lib/api';
import { BackLink } from '../components/BackLink';
import { ClickableRow } from '../components/ClickableRow';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareButton } from '../components/ShareButton';
import { assignCompetitionRank } from '../lib/ranking';
import { compareMatchdayWhenDesc, formatMatchdayWhen } from '../lib/matchday';
import {
  formatSeasonRankingShare,
  formatSeasonWeightedRankingShare,
  formatSeasonWinnerRankingShare,
} from '../lib/shareFormat';
import { useMyPlayerId } from '../lib/useMyPlayerId';
import type { Matchday, Player, Season, SeasonStanding, WeightedSeasonStanding } from '../types/graphql';

type SeasonTab = 'ranking' | 'winners' | 'weighted' | 'matchdays';

const SEASON_TABS: { id: SeasonTab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'winners', label: 'Round winners' },
  { id: 'weighted', label: 'Weighted ranking' },
  { id: 'matchdays', label: 'Matchdays' },
];

export function SeasonRankingPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;
  const myPlayerId = useMyPlayerId(idToken);

  const [season, setSeason] = useState<Season | null>(null);
  const [hasOtherActiveSeason, setHasOtherActiveSeason] = useState(false);
  const [standings, setStandings] = useState<SeasonStanding[]>([]);
  const [winnerStandings, setWinnerStandings] = useState<SeasonStanding[]>([]);
  const [weightedStandings, setWeightedStandings] = useState<WeightedSeasonStanding[]>([]);
  const [matchdays, setMatchdays] = useState<Matchday[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [activeTab, setActiveTab] = useState<SeasonTab>('ranking');

  async function refresh() {
    if (!seasonId) return;
    setError(null);
    try {
      const [s, allSeasons, standing, winnerStanding, weightedStanding, matchdayList, playerList] =
        await Promise.all([
          getSeason(idToken, seasonId),
          listSeasons(idToken),
          getSeasonStanding(idToken, seasonId),
          getSeasonWinnerRanking(idToken, seasonId),
          getSeasonWeightedRanking(idToken, seasonId),
          listMatchdaysBySeason(idToken, seasonId),
          listPlayerNames(idToken),
        ]);
      setSeason(s);
      setHasOtherActiveSeason(allSeasons.some((x) => x.status === 'ACTIVE' && x.seasonId !== seasonId));
      setStandings(standing);
      setWinnerStandings(winnerStanding);
      setWeightedStandings(weightedStanding);
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
  const rankedByWeighted = assignCompetitionRank(
    weightedStandings,
    (a, b) => a.weightedAverage === b.weightedAverage
  );
  const orderedMatchdays = [...matchdays].sort(compareMatchdayWhenDesc);
  // Mirrors the Lambda's own rounding (see infra/lambda/get-season-weighted-ranking) —
  // same "duplicated, not shared" convention as assignCompetitionRank's own comment.
  const closedMatchdayCount = matchdays.filter((m) => m.status === 'CLOSED').length;
  const minMatchdaysRequired = Math.ceil(closedMatchdayCount * 0.25);
  const playerName = (playerId: string) => {
    const player = players.get(playerId);
    if (!player) return playerId;
    return player.isGuest ? `${player.displayName} (Guest)` : player.displayName;
  };

  return (
    <div>
      <BackLink to="/seasons" label="Seasons" />
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

      <div className="tabs season-tabs">
        {SEASON_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-button${activeTab === tab.id ? ' tab-button-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <select
        className="season-tab-select"
        value={activeTab}
        onChange={(e) => setActiveTab(e.target.value as SeasonTab)}
        aria-label="Season view"
      >
        {SEASON_TABS.map((tab) => (
          <option key={tab.id} value={tab.id}>
            {tab.label}
          </option>
        ))}
      </select>

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
                    <th>Played</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((standing) => (
                    <ClickableRow
                      key={standing.playerId}
                      to={`/seasons/${seasonId}/players/${standing.playerId}`}
                    >
                      <td>
                        <span className="scoreboard-chip">{standing.rank}</span>
                      </td>
                      <td className={`name${standing.playerId === myPlayerId ? ' self' : ''}`}>
                        <Link
                          to={`/seasons/${seasonId}/players/${standing.playerId}`}
                          className="row-link"
                        >
                          {playerName(standing.playerId)}
                        </Link>
                      </td>
                      <td className="num">{standing.totalPoints}</td>
                      <td className="num">{standing.matchdaysPlayed}</td>
                    </ClickableRow>
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
                    <ClickableRow
                      key={standing.playerId}
                      to={`/seasons/${seasonId}/players/${standing.playerId}`}
                    >
                      <td>
                        <span className="scoreboard-chip">{standing.rank}</span>
                      </td>
                      <td className={`name${standing.playerId === myPlayerId ? ' self' : ''}`}>
                        <Link
                          to={`/seasons/${seasonId}/players/${standing.playerId}`}
                          className="row-link"
                        >
                          {playerName(standing.playerId)}
                        </Link>
                      </td>
                      <td className="num">{standing.winnerPoints}</td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'weighted' && (
        <section>
          <div className="section-heading">
            <h2>Weighted ranking</h2>
            {weightedStandings.length > 0 && (
              <ShareButton
                title="Popla Cup weighted ranking"
                text={formatSeasonWeightedRankingShare(season, rankedByWeighted, playerName)}
              />
            )}
          </div>
          {closedMatchdayCount === 0 ? (
            <p>No matchdays have been closed yet this season.</p>
          ) : (
            <>
              <p className="hint-text">
                Minimum {minMatchdaysRequired} matchday{minMatchdaysRequired === 1 ? '' : 's'} played to
                qualify.
              </p>
              {weightedStandings.length === 0 ? (
                <p>No one has played enough matchdays yet to qualify.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Player</th>
                        <th>Avg points</th>
                        <th>Participations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedByWeighted.map((standing) => (
                        <ClickableRow
                          key={standing.playerId}
                          to={`/seasons/${seasonId}/players/${standing.playerId}`}
                        >
                          <td>
                            <span className="scoreboard-chip">{standing.rank}</span>
                          </td>
                          <td className={`name${standing.playerId === myPlayerId ? ' self' : ''}`}>
                            <Link
                              to={`/seasons/${seasonId}/players/${standing.playerId}`}
                              className="row-link"
                            >
                              {playerName(standing.playerId)}
                            </Link>
                          </td>
                          <td className="num">{standing.weightedAverage.toFixed(1)}</td>
                          <td className="num">{standing.matchdaysPlayed}</td>
                        </ClickableRow>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="hint-text">
                Each matchday's points count toward your average weighted by that matchday's size — a
                bigger, more competitive field counts for more than a smaller one — so this rewards
                consistent performance across matchdays rather than raw participation.
              </p>
            </>
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
                    <ClickableRow key={matchday.matchdayId} to={`/matchdays/${matchday.matchdayId}`}>
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
                    </ClickableRow>
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
