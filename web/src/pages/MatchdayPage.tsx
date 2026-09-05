import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import {
  closeMatchday,
  closeRegistration,
  createPlayer,
  generateRound,
  getMatchday,
  getMatchdayRanking,
  getMyPlayer,
  listMatchdayParticipants,
  listMatches,
  listPlayerNames,
  listPlayers,
  recordSetResult,
  setMatchdayJoining,
} from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareButton } from '../components/ShareButton';
import { assignCompetitionRank } from '../lib/ranking';
import { formatMatchdayWhen } from '../lib/matchday';
import { formatMatchdayRankingShare, formatRoundShare } from '../lib/shareFormat';
import { sortByName } from '../lib/sort';
import type { Match, Matchday, MatchdayParticipant, MatchdayResult, Player } from '../types/graphql';

// A set is played to 6 games with no tiebreak (SPEC.md) — 0-6 is the full
// valid range for either team's game count.
const GAME_SCORES = [0, 1, 2, 3, 4, 5, 6];

interface StandingSoFar {
  playerId: string;
  setsWon: number;
  gamesWon: number;
  gameDiff: number;
}

/**
 * Same tally as infra/lambda/close-matchday — games won, then game
 * differential, then sets won, see SPEC.md's Day Ranking — computed
 * client-side from whatever COMPLETE matches have been recorded so far.
 * This is what lets the Ranking tab show an intermediate standing before
 * the matchday is closed, without a backend round-trip (the client
 * already has every match's score loaded).
 */
function standingsSoFar(matches: Match[]): StandingSoFar[] {
  const stats = new Map<string, { setsWon: number; gamesWon: number; gamesLost: number }>();
  const ensure = (playerId: string) => {
    let s = stats.get(playerId);
    if (!s) {
      s = { setsWon: 0, gamesWon: 0, gamesLost: 0 };
      stats.set(playerId, s);
    }
    return s;
  };

  for (const match of matches) {
    if (match.status !== 'COMPLETE' || match.team1Games == null || match.team2Games == null) continue;
    const team1Won = match.team1Games > match.team2Games;
    for (const playerId of match.team1PlayerIds) {
      const s = ensure(playerId);
      s.setsWon += team1Won ? 1 : 0;
      s.gamesWon += match.team1Games;
      s.gamesLost += match.team2Games;
    }
    for (const playerId of match.team2PlayerIds) {
      const s = ensure(playerId);
      s.setsWon += team1Won ? 0 : 1;
      s.gamesWon += match.team2Games;
      s.gamesLost += match.team1Games;
    }
  }

  return [...stats.entries()]
    .map(([playerId, s]) => ({
      playerId,
      setsWon: s.setsWon,
      gamesWon: s.gamesWon,
      gameDiff: s.gamesWon - s.gamesLost,
    }))
    .sort((a, b) => {
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
      return b.setsWon - a.setsWon;
    });
}

export function MatchdayPage() {
  const { matchdayId } = useParams<{ matchdayId: string }>();
  const { user } = useAuth();
  const idToken = user!.idToken;
  const isAdmin = user!.isAdmin;

  const [matchday, setMatchday] = useState<Matchday | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [ranking, setRanking] = useState<MatchdayResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [activeTab, setActiveTab] = useState<'matches' | 'ranking'>('matches');

  // Registration-phase state (matchday.status === 'REGISTRATION') — see
  // MatchdayRegistrationPanel below.
  const [participants, setParticipants] = useState<MatchdayParticipant[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [pickablePlayers, setPickablePlayers] = useState<Player[]>([]);

  async function refresh() {
    if (!matchdayId) return;
    setError(null);
    try {
      const md = await getMatchday(idToken, matchdayId);
      setMatchday(md);
      if (md?.status === 'REGISTRATION') {
        const [participantList, playerList, myPlayer, pickable] = await Promise.all([
          listMatchdayParticipants(idToken, matchdayId),
          listPlayerNames(idToken),
          getMyPlayer(idToken),
          isAdmin ? listPlayers(idToken) : Promise.resolve<Player[]>([]),
        ]);
        setParticipants(participantList);
        setPlayers(new Map(playerList.map((p) => [p.playerId, p])));
        setMyPlayerId(myPlayer?.playerId ?? null);
        setPickablePlayers(sortByName(pickable));
      } else {
        const [matchList, playerList] = await Promise.all([
          listMatches(idToken, matchdayId),
          listPlayerNames(idToken),
        ]);
        setMatches(matchList);
        setPlayers(new Map(playerList.map((p) => [p.playerId, p])));
        if (md?.status === 'CLOSED') {
          setRanking(await getMatchdayRanking(idToken, matchdayId));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matchday');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchdayId]);

  async function handleGenerateRound() {
    if (!matchdayId) return;
    setError(null);
    setGenerating(true);
    try {
      await generateRound(idToken, matchdayId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate the next round');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCloseMatchday() {
    if (!matchdayId) return;
    setError(null);
    setClosing(true);
    try {
      await closeMatchday(idToken, matchdayId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close matchday');
    } finally {
      setClosing(false);
    }
  }

  function playerName(playerId: string): string {
    return players.get(playerId)?.displayName ?? playerId;
  }

  if (loading) return <p>Loading…</p>;
  if (!matchday) return <p className="form-error">Matchday not found.</p>;

  if (matchday.status === 'REGISTRATION') {
    return (
      <MatchdayRegistrationPanel
        matchday={matchday}
        participants={participants}
        players={players}
        myPlayerId={myPlayerId}
        isAdmin={isAdmin}
        pickablePlayers={pickablePlayers}
        idToken={idToken}
        matchdayId={matchdayId!}
        error={error}
        onSaved={refresh}
      />
    );
  }

  const matchesByRound = new Map<number, Match[]>();
  for (const match of matches) {
    const list = matchesByRound.get(match.round) ?? [];
    list.push(match);
    matchesByRound.set(match.round, list);
  }
  const roundNumbers = [...matchesByRound.keys()].sort((a, b) => a - b);
  const currentRound = roundNumbers.at(-1) ?? 0;
  const currentRoundMatches = matchesByRound.get(currentRound) ?? [];
  const isOpen = matchday.status !== 'CLOSED';
  // A closed matchday's last round is always fully COMPLETE by
  // definition (that's a precondition of closing) — gate on isOpen too,
  // or the "generate next round"/"finish matchday" actions reappear on
  // an already-closed matchday.
  const currentRoundComplete =
    isOpen && currentRound > 0 && currentRoundMatches.every((m) => m.status === 'COMPLETE');
  const dayStandingsSoFar = assignCompetitionRank(
    standingsSoFar(matches),
    (a, b) => a.gamesWon === b.gamesWon && a.gameDiff === b.gameDiff && a.setsWon === b.setsWon
  );

  return (
    <div>
      <h1>Matchday — {formatMatchdayWhen(matchday)}</h1>
      <p>
        Tournament style: {matchday.format} ·{' '}
        <span className={`status-badge status-${matchday.status.toLowerCase()}`}>
          {matchday.status.replace('_', ' ')}
        </span>
        {isAdmin && matchday.status === 'SETUP' && (
          <>
            {' · '}
            <Link to={`/matchdays/${matchday.matchdayId}/edit`}>Edit</Link>
          </>
        )}
      </p>
      {error && <p className="form-error">{error}</p>}

      <div className="tabs">
        <button
          type="button"
          className={`tab-button${activeTab === 'matches' ? ' tab-button-active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          Matches
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === 'ranking' ? ' tab-button-active' : ''}`}
          onClick={() => setActiveTab('ranking')}
        >
          Ranking
        </button>
      </div>

      {activeTab === 'matches' ? (
        <>
          {isAdmin && currentRoundComplete && (
            <div className="matchday-next-actions">
              <button
                type="button"
                className="button-primary"
                onClick={handleGenerateRound}
                disabled={generating}
              >
                {generating ? 'Generating…' : `Generate round ${currentRound + 1}`}
              </button>
              <button
                type="button"
                className="button-danger"
                onClick={() => setConfirmingClose(true)}
                disabled={closing}
              >
                Finish matchday
              </button>
            </div>
          )}

          {isAdmin && (
            <ConfirmDialog
              open={confirmingClose}
              title="Close this matchday?"
              message="This finalizes the day ranking and adds season points for every participant. It can't be undone."
              confirmLabel="Close matchday"
              danger
              busy={closing}
              onCancel={() => setConfirmingClose(false)}
              onConfirm={() => {
                setConfirmingClose(false);
                handleCloseMatchday();
              }}
            />
          )}

          {isAdmin && currentRound === 0 && isOpen && (
            <button
              type="button"
              className="button-primary"
              onClick={handleGenerateRound}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Generate round 1'}
            </button>
          )}

          {[...roundNumbers].reverse().map((round) => {
            const roundMatches = (matchesByRound.get(round) ?? []).sort((a, b) => a.court - b.court);
            const readOnly = round !== currentRound || matchday.status === 'CLOSED';
            return (
              <section key={round}>
                <div className="section-heading">
                  <h2>
                    Round <span className="scoreboard-chip">{round}</span>
                  </h2>
                  <ShareButton
                    title="Popla Cup matches"
                    text={formatRoundShare(matchday, round, roundMatches, playerName)}
                  />
                </div>
                <div className="match-grid">
                  {roundMatches.map((match) => (
                    <MatchCard
                      key={`${match.round}-${match.court}`}
                      match={match}
                      playerName={playerName}
                      idToken={idToken}
                      matchdayId={matchdayId!}
                      onSaved={refresh}
                      readOnly={readOnly || !isAdmin}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ) : (
        <section>
          {matchday.status === 'CLOSED' ? (
            <>
              <div className="share-row">
                <ShareButton
                  title="Popla Cup ranking"
                  text={formatMatchdayRankingShare(matchday, ranking, playerName, true)}
                />
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Games won</th>
                      <th>Game diff</th>
                      <th>Sets won</th>
                      <th>Season points</th>
                      <th>Winner point</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((result) => (
                      <tr key={result.playerId}>
                        <td>
                          <span className="scoreboard-chip">{result.rank}</span>
                        </td>
                        <td>{playerName(result.playerId)}</td>
                        <td className="num">{result.gamesWon}</td>
                        <td className="num">{result.gameDiff}</td>
                        <td className="num">{result.setsWon}</td>
                        <td className="num">{result.seasonPoints}</td>
                        <td className="num">{result.winnerPoint ? '🏆' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : currentRound === 0 ? (
            <p>No results yet — the ranking fills in once round 1's scores are recorded.</p>
          ) : (
            <>
              <div className="section-heading">
                <p className="participant-count">
                  Standings through round <span className="scoreboard-chip">{currentRound}</span> — not
                  final until the matchday closes.
                </p>
                <ShareButton
                  title="Popla Cup ranking"
                  text={formatMatchdayRankingShare(matchday, dayStandingsSoFar, playerName, false)}
                />
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Games won</th>
                      <th>Game diff</th>
                      <th>Sets won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayStandingsSoFar.map((standing) => (
                      <tr key={standing.playerId}>
                        <td>
                          <span className="scoreboard-chip">{standing.rank}</span>
                        </td>
                        <td>{playerName(standing.playerId)}</td>
                        <td className="num">{standing.gamesWon}</td>
                        <td className="num">{standing.gameDiff}</td>
                        <td className="num">{standing.setsWon}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function MatchCard({
  match,
  playerName,
  idToken,
  matchdayId,
  onSaved,
  readOnly,
}: {
  match: Match;
  playerName: (playerId: string) => string;
  idToken: string;
  matchdayId: string;
  onSaved: () => Promise<void>;
  readOnly: boolean;
}) {
  // A PENDING match normally opens straight into the score form — except
  // when readOnly, where showing an editable, savable form would defeat
  // the point (see MatchdayPage's readOnly computation, which folds in
  // !isAdmin for participants).
  const [editing, setEditing] = useState(match.status === 'PENDING' && !readOnly);
  const [team1Games, setTeam1Games] = useState(match.team1Games ?? 0);
  const [team2Games, setTeam2Games] = useState(match.team2Games ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await recordSetResult(idToken, {
        matchdayId,
        round: match.round,
        court: match.court,
        team1Games,
        team2Games,
      });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="match-card">
      <p className="match-court">Court {match.court}</p>
      <p>{match.team1PlayerIds.map(playerName).join(' & ')}</p>
      <p className="match-vs">vs</p>
      <p>{match.team2PlayerIds.map(playerName).join(' & ')}</p>

      {editing ? (
        <form onSubmit={handleSave} className="score-form">
          <select
            className="score-select"
            value={team1Games}
            onChange={(e) => setTeam1Games(Number(e.target.value))}
          >
            {GAME_SCORES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>–</span>
          <select
            className="score-select"
            value={team2Games}
            onChange={(e) => setTeam2Games(Number(e.target.value))}
          >
            {GAME_SCORES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {match.status === 'COMPLETE' && (
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </form>
      ) : match.status === 'PENDING' ? (
        <div className="score-display">
          <em>Not played yet</em>
        </div>
      ) : (
        <div className="score-display">
          <strong>
            {match.team1Games} – {match.team2Games}
          </strong>
          {!readOnly && (
            <button type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function MatchdayRegistrationPanel({
  matchday,
  participants,
  players,
  myPlayerId,
  isAdmin,
  pickablePlayers,
  idToken,
  matchdayId,
  error,
  onSaved,
}: {
  matchday: Matchday;
  participants: MatchdayParticipant[];
  players: Map<string, Player>;
  myPlayerId: string | null;
  isAdmin: boolean;
  pickablePlayers: Player[];
  idToken: string;
  matchdayId: string;
  error: string | null;
  onSaved: () => Promise<void>;
}) {
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickedPlayerId, setPickedPlayerId] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPhone, setNewPlayerPhone] = useState('');
  const [newPlayerEmail, setNewPlayerEmail] = useState('');
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closingRegistration, setClosingRegistration] = useState(false);

  const joining = participants.filter((p) => p.status === 'JOINING');
  const waitlisted = participants.filter((p) => p.status === 'WAITLISTED');
  const mine = participants.find((p) => p.playerId === myPlayerId);
  const canClose = joining.length > 0 && joining.length % 4 === 0;

  const alreadyOnRoster = new Set([...joining, ...waitlisted].map((p) => p.playerId));
  const addablePlayers = pickablePlayers.filter((p) => !alreadyOnRoster.has(p.playerId));

  async function setJoining(playerId: string | undefined, isJoining: boolean) {
    setActionError(null);
    setBusyPlayerId(playerId ?? 'self');
    try {
      await setMatchdayJoining(idToken, { matchdayId, playerId, joining: isJoining });
      await onSaved();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update RSVP');
    } finally {
      setBusyPlayerId(null);
    }
  }

  async function handleAddExisting(event: FormEvent) {
    event.preventDefault();
    if (!pickedPlayerId) return;
    await setJoining(pickedPlayerId, true);
    setPickedPlayerId('');
  }

  async function handleAddNewPlayer(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    setCreatingPlayer(true);
    try {
      const player = await createPlayer(idToken, {
        displayName: newPlayerName,
        phone: newPlayerPhone || undefined,
        email: newPlayerEmail || undefined,
      });
      await setMatchdayJoining(idToken, { matchdayId, playerId: player.playerId, joining: true });
      await onSaved();
      setNewPlayerName('');
      setNewPlayerPhone('');
      setNewPlayerEmail('');
      setAddingPlayer(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add participant');
    } finally {
      setCreatingPlayer(false);
    }
  }

  async function handleCloseRegistration() {
    setActionError(null);
    setClosingRegistration(true);
    try {
      await closeRegistration(idToken, matchdayId);
      await onSaved();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close registration');
    } finally {
      setClosingRegistration(false);
    }
  }

  return (
    <div>
      <h1>Matchday — {formatMatchdayWhen(matchday)}</h1>
      <p>
        Tournament style: {matchday.format} ·{' '}
        <span className="status-badge status-registration">Registration open</span>
      </p>
      {error && <p className="form-error">{error}</p>}
      {actionError && <p className="form-error">{actionError}</p>}

      <p className="participant-count">
        <span className="scoreboard-chip">{joining.length}</span>
        {` of ${matchday.maxParticipants} joined`}
        {waitlisted.length > 0 && ` · ${waitlisted.length} waitlisted`}
      </p>

      {myPlayerId && (
        <div className="page-actions">
          {!mine || mine.status === 'DECLINED' ? (
            <button
              type="button"
              className="button-primary"
              disabled={busyPlayerId === 'self'}
              onClick={() => setJoining(undefined, true)}
            >
              {busyPlayerId === 'self' ? 'Joining…' : 'Join'}
            </button>
          ) : mine.status === 'WAITLISTED' ? (
            <>
              <p>You're on the waitlist.</p>
              <button
                type="button"
                disabled={busyPlayerId === 'self'}
                onClick={() => setJoining(undefined, false)}
              >
                Leave waitlist
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button-danger"
              disabled={busyPlayerId === 'self'}
              onClick={() => setJoining(undefined, false)}
            >
              {busyPlayerId === 'self' ? 'Leaving…' : 'Leave'}
            </button>
          )}
        </div>
      )}

      <RosterList
        list={joining}
        title="Joining"
        players={players}
        isAdmin={isAdmin}
        busyPlayerId={busyPlayerId}
        onRemove={(playerId) => setJoining(playerId, false)}
      />
      <RosterList
        list={waitlisted}
        title="Waitlisted"
        players={players}
        isAdmin={isAdmin}
        busyPlayerId={busyPlayerId}
        onRemove={(playerId) => setJoining(playerId, false)}
      />

      {isAdmin && (
        <section>
          <h2>Add participants</h2>
          <form onSubmit={handleAddExisting} className="inline-form">
            <label>
              Existing participant
              <select value={pickedPlayerId} onChange={(e) => setPickedPlayerId(e.target.value)}>
                <option value="">Select…</option>
                {addablePlayers.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.displayName}
                    {p.isGuest ? ' (Guest)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button-primary" disabled={!pickedPlayerId}>
              Add
            </button>
          </form>

          {addingPlayer ? (
            <form onSubmit={handleAddNewPlayer} className="inline-form">
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
                Phone (optional — enables login)
                <input
                  type="text"
                  value={newPlayerPhone}
                  onChange={(e) => setNewPlayerPhone(e.target.value)}
                />
              </label>
              <label>
                Email (optional)
                <input
                  type="email"
                  value={newPlayerEmail}
                  onChange={(e) => setNewPlayerEmail(e.target.value)}
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

          <div className="page-actions">
            <button
              type="button"
              className="button-primary"
              disabled={!canClose || closingRegistration}
              title={canClose ? undefined : 'Confirmed joiners must be a non-zero multiple of 4'}
              onClick={() => setConfirmingClose(true)}
            >
              Close registration
            </button>
          </div>

          <ConfirmDialog
            open={confirmingClose}
            title="Close registration?"
            message="This locks in the current joiners as the matchday roster and moves it to setup. Waitlisted and declined participants are dropped."
            confirmLabel="Close registration"
            busy={closingRegistration}
            onCancel={() => setConfirmingClose(false)}
            onConfirm={() => {
              setConfirmingClose(false);
              handleCloseRegistration();
            }}
          />
        </section>
      )}
    </div>
  );
}

function RosterList({
  list,
  title,
  players,
  isAdmin,
  busyPlayerId,
  onRemove,
}: {
  list: MatchdayParticipant[];
  title: string;
  players: Map<string, Player>;
  isAdmin: boolean;
  busyPlayerId: string | null;
  onRemove: (playerId: string) => void;
}) {
  return (
    <section>
      <h2>
        {title} <span className="scoreboard-chip">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p>Nobody yet.</p>
      ) : (
        <ul className="matchday-list">
          {list.map((p) => {
            const player = players.get(p.playerId);
            return (
              <li key={p.playerId}>
                <span>
                  {player?.displayName ?? p.playerId}
                  {player?.isGuest && <span className="status-badge">Guest</span>}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={busyPlayerId === p.playerId}
                    onClick={() => onRemove(p.playerId)}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
