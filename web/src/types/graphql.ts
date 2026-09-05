export type MatchdayFormat = 'MEXICANO' | 'AMERICANO';
export type SeasonStatus = 'ACTIVE' | 'CLOSED';
export type MatchdayStatus = 'REGISTRATION' | 'SETUP' | 'IN_PROGRESS' | 'CLOSED';
export type MatchStatus = 'PENDING' | 'COMPLETE';
export type ParticipationStatus = 'JOINING' | 'WAITLISTED' | 'DECLINED';

export interface Player {
  playerId: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  isGuest: boolean;
  createdAt: string;
}

export interface MatchdayParticipant {
  matchdayId: string;
  playerId: string;
  status: ParticipationStatus;
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
  maxParticipants?: number | null;
  joinedCount?: number | null;
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
  winnerPoint: boolean;
}

export interface SeasonStanding {
  seasonId: string;
  playerId: string;
  totalPoints: number;
  matchdaysPlayed: number;
  winnerPoints: number;
}
