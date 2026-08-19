import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { courtsFromOrderedPlayers, randomOrder } from '../shared/pairing';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;

interface GenerateRoundArgs {
  matchdayId: string;
  round: number;
}

export const handler = async (event: { arguments: GenerateRoundArgs }) => {
  const { matchdayId, round } = event.arguments;

  if (!Number.isInteger(round) || round < 1 || round > 4) {
    throw new Error('round must be an integer between 1 and 4');
  }

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }

  const existing = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression:
        'matchdayId = :matchdayId AND begins_with(roundCourt, :roundPrefix)',
      ExpressionAttributeValues: {
        ':matchdayId': matchdayId,
        ':roundPrefix': `ROUND#${round}#`,
      },
    })
  );
  if (existing.Items && existing.Items.length > 0) {
    throw new Error(`Round ${round} has already been generated for this matchday`);
  }

  const participantsResult = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const participantIds = (participantsResult.Items ?? []).map(
    (item) => item.playerId as string
  );

  const orderedPlayerIds =
    round === 1 || matchday.format === 'AMERICANO'
      ? randomOrder(participantIds)
      : await rankByStandingsSoFar(matchdayId, participantIds);

  const courts = courtsFromOrderedPlayers(round, orderedPlayerIds);

  await ddb.send(
    new BatchWriteCommand({
      RequestItems: {
        [MATCHES_TABLE]: courts.map((c) => ({
          PutRequest: {
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
      },
    })
  );

  // Round 1 generated: the matchday is no longer editable (updateMatchday
  // only allows SETUP) and is now actually being played.
  if (round === 1 && matchday.status === 'SETUP') {
    await ddb.send(
      new UpdateCommand({
        TableName: MATCHDAYS_TABLE,
        Key: { matchdayId },
        UpdateExpression: 'SET #status = :inProgress',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
      })
    );
  }

  return courts.map((c) => ({
    matchdayId,
    round: c.round,
    court: c.court,
    team1PlayerIds: c.team1PlayerIds,
    team2PlayerIds: c.team2PlayerIds,
    status: 'PENDING',
  }));
};

/**
 * Mexicano rounds 2-4: rank players by the standings accumulated so far
 * *this matchday* (sets won, then game differential), derived from the
 * completed Matches of prior rounds. This is deliberately not read from a
 * persisted table — MatchdayResults only exists once the matchday is
 * closed, so the interim ranking is recomputed each time a round is
 * generated. Ties are broken by shuffling before the stable sort, so
 * equal standings land in random relative order each time.
 */
async function rankByStandingsSoFar(
  matchdayId: string,
  participantIds: string[]
): Promise<string[]> {
  const priorMatches = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );

  const standings = new Map<string, { setsWon: number; gameDiff: number }>();
  for (const playerId of participantIds) {
    standings.set(playerId, { setsWon: 0, gameDiff: 0 });
  }

  for (const match of priorMatches.Items ?? []) {
    if (match.status !== 'COMPLETE') continue;
    const t1 = match.team1Games as number;
    const t2 = match.team2Games as number;
    const team1Won = t1 > t2;

    for (const playerId of match.team1PlayerIds as string[]) {
      const s = standings.get(playerId);
      if (!s) continue;
      s.setsWon += team1Won ? 1 : 0;
      s.gameDiff += t1 - t2;
    }
    for (const playerId of match.team2PlayerIds as string[]) {
      const s = standings.get(playerId);
      if (!s) continue;
      s.setsWon += team1Won ? 0 : 1;
      s.gameDiff += t2 - t1;
    }
  }

  return randomOrder(participantIds).sort((a, b) => {
    const sa = standings.get(a)!;
    const sb = standings.get(b)!;
    if (sb.setsWon !== sa.setsWon) return sb.setsWon - sa.setsWon;
    return sb.gameDiff - sa.gameDiff;
  });
}
