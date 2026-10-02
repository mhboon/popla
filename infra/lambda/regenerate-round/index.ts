import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { buildCourtsForRound, type MatchRecord } from '../shared/pairing';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;

interface RegenerateRoundArgs {
  matchdayId: string;
  round: number;
}

export const handler = async (event: { arguments: RegenerateRoundArgs }) => {
  const { matchdayId, round } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'IN_PROGRESS') {
    throw new Error('Only a round of an in-progress matchday can be regenerated');
  }

  const { Items: allMatches = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );

  const targetRoundMatches = allMatches.filter((m) => m.round === round);
  if (targetRoundMatches.length === 0) {
    throw new Error(`Round ${round} hasn't been generated`);
  }
  if (targetRoundMatches.some((m) => m.status === 'COMPLETE')) {
    throw new Error(`Round ${round} already has a recorded result and can't be regenerated`);
  }

  // Every *other* round's matches are this round's history — same
  // avoidance scope generateRound uses for the round it's creating, just
  // with the target round's own (about-to-be-discarded) pairing excluded
  // so it's never treated as its own precedent.
  const priorMatches = allMatches.filter((m) => m.round !== round) as unknown as MatchRecord[];

  const { Items: allParticipants = [] } = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const participantIds = allParticipants
    .filter((item) => (item.status ?? 'JOINING') === 'JOINING')
    .map((item) => item.playerId as string);

  const courts = buildCourtsForRound(matchday.format, round, participantIds, priorMatches);

  // Delete-then-put rather than overwriting the old roundCourt keys in
  // place: the court count tracks participantIds.length, which can in
  // principle differ from when this round was first generated (e.g. the
  // roster was reconciled in between), so the old round's court keys
  // aren't guaranteed to match the new ones 1:1. One transaction keeps
  // the round from ever being observed half-old/half-new.
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        ...targetRoundMatches.map((m) => ({
          Delete: {
            TableName: MATCHES_TABLE,
            Key: { matchdayId, roundCourt: m.roundCourt },
          },
        })),
        ...courts.map((c) => ({
          Put: {
            TableName: MATCHES_TABLE,
            Item: {
              matchdayId,
              roundCourt: `ROUND#${c.round}#COURT#${c.court}`,
              round: c.round,
              court: c.court,
              team1PlayerIds: c.team1PlayerIds,
              team2PlayerIds: c.team2PlayerIds,
              status: 'PENDING',
            },
          },
        })),
      ],
    })
  );

  return courts.map((c) => ({
    matchdayId,
    round: c.round,
    court: c.court,
    team1PlayerIds: c.team1PlayerIds,
    team2PlayerIds: c.team2PlayerIds,
    status: 'PENDING',
  }));
};
