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
