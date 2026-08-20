export type MatchdayFormat = 'MEXICANO' | 'AMERICANO';
export type SeasonStatus = 'ACTIVE' | 'CLOSED';
export type MatchdayStatus = 'SETUP' | 'IN_PROGRESS' | 'CLOSED';
export type MatchStatus = 'PENDING' | 'COMPLETE';

export interface Player {
  playerId: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
}

export interface Season {
  seasonId: string;
  name: string;
  status: SeasonStatus;
  startDate: string;
  closedAt?: string | null;
}

export interface Matchday {
  matchdayId: string;
  seasonId: string;
  date: string;
  startTime?: string | null;
  format: MatchdayFormat;
  status: MatchdayStatus;
}

export interface Match {
  matchdayId: string;
  round: number;
  court: number;
  team1PlayerIds: string[];
  team2PlayerIds: string[];
  team1Games?: number | null;
  team2Games?: number | null;
  status: MatchStatus;
}

export interface MatchdayResult {
  matchdayId: string;
  playerId: string;
  setsWon: number;
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  rank: number;
  seasonPoints: number;
}

export interface SeasonStanding {
  seasonId: string;
  playerId: string;
  totalPoints: number;
  matchdaysPlayed: number;
}
