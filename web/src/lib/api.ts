import { graphqlRequest } from './graphqlClient';
import type {
  Match,
  Matchday,
  MatchdayFormat,
  MatchdayParticipant,
  MatchdayResult,
  Player,
  Season,
  SeasonStanding,
} from '../types/graphql';

const PLAYER_FIELDS = 'playerId displayName phone email isGuest createdAt';
// phone/email are field-gated to Admins (see ARCHITECTURE.md's Auth
// section) — AppSync doesn't just null those fields out for a
// non-admin caller, it also adds an Unauthorized error to the
// response, which graphqlRequest treats as a failure. Participant-
// facing pages that only need playerId -> displayName resolution must
// not select those two fields, or the whole call throws. isGuest is
// safe to include here — it's computed, not gated (see schema.graphql).
const PLAYER_NAME_FIELDS = 'playerId displayName isGuest createdAt';
const SEASON_FIELDS = 'seasonId name status startDate closedAt';
const MATCHDAY_FIELDS = 'matchdayId seasonId date startTime format status maxParticipants joinedCount';
const MATCHDAY_PARTICIPANT_FIELDS = 'matchdayId playerId status';
const MATCH_FIELDS = 'matchdayId round court team1PlayerIds team2PlayerIds team1Games team2Games status';
const MATCHDAY_RESULT_FIELDS =
  'matchdayId playerId setsWon gamesWon gamesLost gameDiff rank seasonPoints winnerPoint';
const SEASON_STANDING_FIELDS = 'seasonId playerId totalPoints matchdaysPlayed winnerPoints';

// Admin-only (ParticipantsPage, MatchdaySetupPage) — includes phone/email.
export function listPlayers(idToken: string) {
  return graphqlRequest<{ listPlayers: Player[] }>(
    idToken,
    `query { listPlayers { ${PLAYER_FIELDS} } }`
  ).then((d) => d.listPlayers);
}

// For participant-reachable pages (SeasonRankingPage, MatchdayPage) —
// names only, so it works for a non-admin caller. See PLAYER_NAME_FIELDS.
export function listPlayerNames(idToken: string) {
  return graphqlRequest<{ listPlayers: Player[] }>(
    idToken,
    `query { listPlayers { ${PLAYER_NAME_FIELDS} } }`
  ).then((d) => d.listPlayers);
}

// Resolves to the Player linked to the caller's own login, or null for a
// bare console admin with no linked Player — see schema.graphql. Safe for
// any authenticated caller (only selects the same non-gated fields as
// listPlayerNames).
export function getMyPlayer(idToken: string) {
  return graphqlRequest<{ getMyPlayer: Player | null }>(
    idToken,
    `query { getMyPlayer { ${PLAYER_NAME_FIELDS} } }`
  ).then((d) => d.getMyPlayer);
}

export function createPlayer(
  idToken: string,
  input: { displayName: string; phone?: string; email?: string }
) {
  return graphqlRequest<{ createPlayer: Player }>(
    idToken,
    `mutation($displayName: String!, $phone: String, $email: String) {
      createPlayer(displayName: $displayName, phone: $phone, email: $email) { ${PLAYER_FIELDS} }
    }`,
    input
  ).then((d) => d.createPlayer);
}

export function updatePlayer(
  idToken: string,
  input: {
    playerId: string;
    displayName?: string;
    phone?: string | null;
    email?: string | null;
  }
) {
  return graphqlRequest<{ updatePlayer: Player }>(
    idToken,
    `mutation($playerId: ID!, $displayName: String, $phone: String, $email: String) {
      updatePlayer(playerId: $playerId, displayName: $displayName, phone: $phone, email: $email) { ${PLAYER_FIELDS} }
    }`,
    input
  ).then((d) => d.updatePlayer);
}

export function listAdminPhoneNumbers(idToken: string) {
  return graphqlRequest<{ listAdminPhoneNumbers: string[] }>(
    idToken,
    `query { listAdminPhoneNumbers }`
  ).then((d) => d.listAdminPhoneNumbers);
}

export function promoteToAdmin(idToken: string, playerId: string) {
  return graphqlRequest<{ promoteToAdmin: boolean }>(
    idToken,
    `mutation($playerId: ID!) { promoteToAdmin(playerId: $playerId) }`,
    { playerId }
  ).then((d) => d.promoteToAdmin);
}

export function demoteFromAdmin(idToken: string, playerId: string) {
  return graphqlRequest<{ demoteFromAdmin: boolean }>(
    idToken,
    `mutation($playerId: ID!) { demoteFromAdmin(playerId: $playerId) }`,
    { playerId }
  ).then((d) => d.demoteFromAdmin);
}

export function listSeasons(idToken: string) {
  return graphqlRequest<{ listSeasons: Season[] }>(
    idToken,
    `query { listSeasons { ${SEASON_FIELDS} } }`
  ).then((d) => d.listSeasons);
}

export function getSeason(idToken: string, seasonId: string) {
  return graphqlRequest<{ getSeason: Season | null }>(
    idToken,
    `query($seasonId: ID!) { getSeason(seasonId: $seasonId) { ${SEASON_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.getSeason);
}

export function createSeason(idToken: string, input: { name: string; startDate: string }) {
  return graphqlRequest<{ createSeason: Season }>(
    idToken,
    `mutation($name: String!, $startDate: AWSDate!) {
      createSeason(name: $name, startDate: $startDate) { ${SEASON_FIELDS} }
    }`,
    input
  ).then((d) => d.createSeason);
}

export function closeSeason(idToken: string, seasonId: string) {
  return graphqlRequest<{ closeSeason: Season }>(
    idToken,
    `mutation($seasonId: ID!) { closeSeason(seasonId: $seasonId) { ${SEASON_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.closeSeason);
}

export function reopenSeason(idToken: string, seasonId: string) {
  return graphqlRequest<{ reopenSeason: Season }>(
    idToken,
    `mutation($seasonId: ID!) { reopenSeason(seasonId: $seasonId) { ${SEASON_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.reopenSeason);
}

export function listMatchdaysBySeason(idToken: string, seasonId: string) {
  return graphqlRequest<{ listMatchdaysBySeason: Matchday[] }>(
    idToken,
    `query($seasonId: ID!) { listMatchdaysBySeason(seasonId: $seasonId) { ${MATCHDAY_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.listMatchdaysBySeason);
}

export function getSeasonStanding(idToken: string, seasonId: string) {
  return graphqlRequest<{ getSeasonStanding: SeasonStanding[] }>(
    idToken,
    `query($seasonId: ID!) { getSeasonStanding(seasonId: $seasonId) { ${SEASON_STANDING_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.getSeasonStanding);
}

export function getSeasonWinnerRanking(idToken: string, seasonId: string) {
  return graphqlRequest<{ getSeasonWinnerRanking: SeasonStanding[] }>(
    idToken,
    `query($seasonId: ID!) { getSeasonWinnerRanking(seasonId: $seasonId) { ${SEASON_STANDING_FIELDS} } }`,
    { seasonId }
  ).then((d) => d.getSeasonWinnerRanking);
}

export function createMatchday(
  idToken: string,
  input: {
    seasonId: string;
    date: string;
    startTime?: string;
    format: MatchdayFormat;
    participantIds: string[];
  }
) {
  return graphqlRequest<{ createMatchday: Matchday }>(
    idToken,
    `mutation($seasonId: ID!, $date: AWSDate!, $startTime: AWSTime, $format: MatchdayFormat!, $participantIds: [ID!]!) {
      createMatchday(seasonId: $seasonId, date: $date, startTime: $startTime, format: $format, participantIds: $participantIds) { ${MATCHDAY_FIELDS} }
    }`,
    input
  ).then((d) => d.createMatchday);
}

export function listMatchdayParticipantIds(idToken: string, matchdayId: string) {
  return graphqlRequest<{ listMatchdayParticipantIds: string[] }>(
    idToken,
    `query($matchdayId: ID!) { listMatchdayParticipantIds(matchdayId: $matchdayId) }`,
    { matchdayId }
  ).then((d) => d.listMatchdayParticipantIds);
}

export function listMatchdayParticipants(idToken: string, matchdayId: string) {
  return graphqlRequest<{ listMatchdayParticipants: MatchdayParticipant[] }>(
    idToken,
    `query($matchdayId: ID!) { listMatchdayParticipants(matchdayId: $matchdayId) { ${MATCHDAY_PARTICIPANT_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.listMatchdayParticipants);
}

export function openRegistration(
  idToken: string,
  input: {
    seasonId: string;
    date: string;
    startTime?: string;
    format: MatchdayFormat;
    maxParticipants: number;
  }
) {
  return graphqlRequest<{ openRegistration: Matchday }>(
    idToken,
    `mutation($seasonId: ID!, $date: AWSDate!, $startTime: AWSTime, $format: MatchdayFormat!, $maxParticipants: Int!) {
      openRegistration(seasonId: $seasonId, date: $date, startTime: $startTime, format: $format, maxParticipants: $maxParticipants) { ${MATCHDAY_FIELDS} }
    }`,
    input
  ).then((d) => d.openRegistration);
}

export function setMatchdayJoining(
  idToken: string,
  input: { matchdayId: string; playerId?: string; joining: boolean }
) {
  return graphqlRequest<{ setMatchdayJoining: MatchdayParticipant }>(
    idToken,
    `mutation($matchdayId: ID!, $playerId: ID, $joining: Boolean!) {
      setMatchdayJoining(matchdayId: $matchdayId, playerId: $playerId, joining: $joining) { ${MATCHDAY_PARTICIPANT_FIELDS} }
    }`,
    input
  ).then((d) => d.setMatchdayJoining);
}

export function closeRegistration(idToken: string, matchdayId: string) {
  return graphqlRequest<{ closeRegistration: Matchday }>(
    idToken,
    `mutation($matchdayId: ID!) { closeRegistration(matchdayId: $matchdayId) { ${MATCHDAY_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.closeRegistration);
}

export function getMatchday(idToken: string, matchdayId: string) {
  return graphqlRequest<{ getMatchday: Matchday | null }>(
    idToken,
    `query($matchdayId: ID!) { getMatchday(matchdayId: $matchdayId) { ${MATCHDAY_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.getMatchday);
}

export function updateMatchday(
  idToken: string,
  input: {
    matchdayId: string;
    date?: string;
    startTime?: string;
    format?: MatchdayFormat;
    participantIds?: string[];
  }
) {
  return graphqlRequest<{ updateMatchday: Matchday }>(
    idToken,
    `mutation($matchdayId: ID!, $date: AWSDate, $startTime: AWSTime, $format: MatchdayFormat, $participantIds: [ID!]) {
      updateMatchday(matchdayId: $matchdayId, date: $date, startTime: $startTime, format: $format, participantIds: $participantIds) { ${MATCHDAY_FIELDS} }
    }`,
    input
  ).then((d) => d.updateMatchday);
}

export function closeMatchday(idToken: string, matchdayId: string) {
  return graphqlRequest<{ closeMatchday: Matchday }>(
    idToken,
    `mutation($matchdayId: ID!) { closeMatchday(matchdayId: $matchdayId) { ${MATCHDAY_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.closeMatchday);
}

export function getMatchdayRanking(idToken: string, matchdayId: string) {
  return graphqlRequest<{ getMatchdayRanking: MatchdayResult[] }>(
    idToken,
    `query($matchdayId: ID!) { getMatchdayRanking(matchdayId: $matchdayId) { ${MATCHDAY_RESULT_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.getMatchdayRanking);
}

export function listMatches(idToken: string, matchdayId: string) {
  return graphqlRequest<{ listMatches: Match[] }>(
    idToken,
    `query($matchdayId: ID!) { listMatches(matchdayId: $matchdayId) { ${MATCH_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.listMatches);
}

export function generateRound(idToken: string, matchdayId: string) {
  return graphqlRequest<{ generateRound: Match[] }>(
    idToken,
    `mutation($matchdayId: ID!) {
      generateRound(matchdayId: $matchdayId) { ${MATCH_FIELDS} }
    }`,
    { matchdayId }
  ).then((d) => d.generateRound);
}

export function recordSetResult(
  idToken: string,
  input: { matchdayId: string; round: number; court: number; team1Games: number; team2Games: number }
) {
  return graphqlRequest<{ recordSetResult: Match }>(
    idToken,
    `mutation($matchdayId: ID!, $round: Int!, $court: Int!, $team1Games: Int!, $team2Games: Int!) {
      recordSetResult(matchdayId: $matchdayId, round: $round, court: $court, team1Games: $team1Games, team2Games: $team2Games) { ${MATCH_FIELDS} }
    }`,
    input
  ).then((d) => d.recordSetResult);
}
