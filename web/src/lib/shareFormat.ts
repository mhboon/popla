import { formatMatchdayWhen } from './matchday';
import type { Match, Matchday, Season, SeasonStanding } from '../types/graphql';

interface RankedDayStanding {
  rank: number;
  playerId: string;
  gameDiff: number;
  gamesWon: number;
  setsWon: number;
}

// Deliberately omits season points — shared matchday rankings are meant to
// stand on their own (a day's result), not reveal season standings.
export function formatMatchdayRankingShare(
  matchday: Matchday,
  standings: RankedDayStanding[],
  playerName: (playerId: string) => string,
  final: boolean
): string {
  const header = `Popla Cup — ${formatMatchdayWhen(matchday)} ranking${final ? '' : ' (so far)'}`;
  const lines = standings.map(
    (s) =>
      `${s.rank}. ${playerName(s.playerId)} — ${s.gameDiff >= 0 ? '+' : ''}${s.gameDiff} diff, ${s.gamesWon} games, ${s.setsWon} sets`
  );
  return [header, '', ...lines].join('\n');
}

export function formatSeasonRankingShare(
  season: Season,
  standings: (SeasonStanding & { rank: number })[],
  playerName: (playerId: string) => string
): string {
  const header = `Popla Cup — ${season.name} ranking`;
  const lines = standings.map(
    (s) => `${s.rank}. ${playerName(s.playerId)} — ${s.totalPoints} pts (${s.matchdaysPlayed} matchdays)`
  );
  return [header, '', ...lines].join('\n');
}

export function formatRoundShare(
  matchday: Matchday,
  round: number,
  matches: Match[],
  playerName: (playerId: string) => string
): string {
  const header = `Popla Cup — ${formatMatchdayWhen(matchday)}, round ${round}`;
  const lines = [...matches]
    .sort((a, b) => a.court - b.court)
    .map(
      (m) =>
        `Court ${m.court}: ${m.team1PlayerIds.map(playerName).join(' & ')} vs ${m.team2PlayerIds.map(playerName).join(' & ')}`
    );
  return [header, '', ...lines].join('\n');
}
