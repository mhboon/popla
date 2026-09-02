import { formatMatchdayWhen } from './matchday';
import type { Match, Matchday, Season, SeasonStanding } from '../types/graphql';

interface RankedDayStanding {
  rank: number;
  playerId: string;
  gameDiff: number;
  gamesWon: number;
  setsWon: number;
  // Only known once the matchday closes — the in-progress "so far" standing
  // has no season points or winner point to report yet, so these stay
  // unset there.
  seasonPoints?: number;
  winnerPoint?: boolean;
}

export function formatMatchdayRankingShare(
  matchday: Matchday,
  standings: RankedDayStanding[],
  playerName: (playerId: string) => string,
  final: boolean
): string {
  const header = `Popla Cup — ${formatMatchdayWhen(matchday)} ranking${final ? '' : ' (so far)'}`;
  const lines = standings.map((s) => {
    let line = `${s.rank}. ${playerName(s.playerId)} — ${s.gamesWon} games, ${s.gameDiff >= 0 ? '+' : ''}${s.gameDiff} diff, ${s.setsWon} sets`;
    if (s.seasonPoints != null) line += `, ${s.seasonPoints} season pts`;
    if (s.winnerPoint) line += ' 🏆';
    return line;
  });
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

export function formatSeasonWinnerRankingShare(
  season: Season,
  standings: (SeasonStanding & { rank: number })[],
  playerName: (playerId: string) => string
): string {
  const header = `Popla Cup — ${season.name} round winners`;
  const lines = standings.map(
    (s) => `${s.rank}. ${playerName(s.playerId)} — ${s.winnerPoints} 🏆`
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
