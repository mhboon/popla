import { graphqlRequest } from './graphqlClient';
import type {
  Match,
  Matchday,
  MatchdayFormat,
  MatchdayResult,
  Player,
  Season,
  SeasonStanding,
} from '../types/graphql';

const PLAYER_FIELDS = 'playerId displayName phone email createdAt';
const SEASON_FIELDS = 'seasonId name status startDate closedAt';
const MATCHDAY_FIELDS = 'matchdayId seasonId date startTime format status';
const MATCH_FIELDS = 'matchdayId round court team1PlayerIds team2PlayerIds team1Games team2Games status';
const MATCHDAY_RESULT_FIELDS =
  'matchdayId playerId setsWon gamesWon gamesLost gameDiff rank seasonPoints winnerPoint';
const SEASON_STANDING_FIELDS = 'seasonId playerId totalPoints matchdaysPlayed winnerPoints';

export function listPlayers(idToken: string) {
  return graphqlRequest<{ listPlayers: Player[] }>(
    idToken,
    `query { listPlayers { ${PLAYER_FIELDS} } }`
  ).then((d) => d.listPlayers);
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
