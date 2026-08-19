import { graphqlRequest } from './graphqlClient';
import type { Match, Matchday, MatchdayFormat, Player, Season } from '../types/graphql';

const PLAYER_FIELDS = 'playerId displayName phone email createdAt';
const MATCHDAY_FIELDS = 'matchdayId seasonId date format status';
const MATCH_FIELDS = 'matchdayId round court team1PlayerIds team2PlayerIds team1Games team2Games status';

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
  input: { playerId: string; displayName?: string; phone?: string; email?: string }
) {
  return graphqlRequest<{ updatePlayer: Player }>(
    idToken,
    `mutation($playerId: ID!, $displayName: String, $phone: String, $email: String) {
      updatePlayer(playerId: $playerId, displayName: $displayName, phone: $phone, email: $email) { ${PLAYER_FIELDS} }
    }`,
    input
  ).then((d) => d.updatePlayer);
}

export function listSeasons(idToken: string) {
  return graphqlRequest<{ listSeasons: Season[] }>(
    idToken,
    `query { listSeasons { seasonId name status startDate closedAt } }`
  ).then((d) => d.listSeasons);
}

export function createMatchday(
  idToken: string,
  input: { seasonId: string; date: string; format: MatchdayFormat; participantIds: string[] }
) {
  return graphqlRequest<{ createMatchday: Matchday }>(
    idToken,
    `mutation($seasonId: ID!, $date: AWSDate!, $format: MatchdayFormat!, $participantIds: [ID!]!) {
      createMatchday(seasonId: $seasonId, date: $date, format: $format, participantIds: $participantIds) { ${MATCHDAY_FIELDS} }
    }`,
    input
  ).then((d) => d.createMatchday);
}

export function getMatchday(idToken: string, matchdayId: string) {
  return graphqlRequest<{ getMatchday: Matchday | null }>(
    idToken,
    `query($matchdayId: ID!) { getMatchday(matchdayId: $matchdayId) { ${MATCHDAY_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.getMatchday);
}

export function listMatches(idToken: string, matchdayId: string) {
  return graphqlRequest<{ listMatches: Match[] }>(
    idToken,
    `query($matchdayId: ID!) { listMatches(matchdayId: $matchdayId) { ${MATCH_FIELDS} } }`,
    { matchdayId }
  ).then((d) => d.listMatches);
}

export function generateRound(idToken: string, matchdayId: string, round: number) {
  return graphqlRequest<{ generateRound: Match[] }>(
    idToken,
    `mutation($matchdayId: ID!, $round: Int!) {
      generateRound(matchdayId: $matchdayId, round: $round) { ${MATCH_FIELDS} }
    }`,
    { matchdayId, round }
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
