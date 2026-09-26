import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  buildPartnershipHistory,
  courtsFromOrderedPlayers,
  randomOrder,
  rankByStandingsSoFar,
  type MatchRecord,
  type PartnershipHistory,
} from '../shared/pairing';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;

interface GenerateRoundArgs {
  matchdayId: string;
}

export const handler = async (event: { arguments: GenerateRoundArgs }) => {
  const { matchdayId } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }

  // No fixed round count (see SPEC.md) — the next round is simply one
  // past the highest round already generated for this matchday.
  const existingMatches = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const priorRounds = (existingMatches.Items ?? []).map((item) => item.round as number);
  const round = priorRounds.length === 0 ? 1 : Math.max(...priorRounds) + 1;

  const participantsResult = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const allParticipants = participantsResult.Items ?? [];
  const joiningParticipants = allParticipants.filter((item) => (item.status ?? 'JOINING') === 'JOINING');
  // Only ever non-empty at round 1 — WAITLISTED/DECLINED rows are
  // cleaned up below the first time a round is generated, and nothing
  // writes them after the matchday leaves SETUP.
  const nonJoiningParticipants = allParticipants.filter(
    (item) => (item.status ?? 'JOINING') !== 'JOINING'
  );

  // This is the "close registration" moment, folded into starting play
  // instead of being a separate step: the roster must be locked in as a
  // non-zero multiple of 4 before round 1 can be generated.
  if (round === 1 && (joiningParticipants.length === 0 || joiningParticipants.length % 4 !== 0)) {
    throw new Error(
      `Confirmed participant count must be a non-zero multiple of 4 to start (currently ${joiningParticipants.length})`
    );
  }

  const participantIds = joiningParticipants.map((item) => item.playerId as string);

  const priorMatches = (existingMatches.Items ?? []) as unknown as MatchRecord[];

  const orderedPlayerIds =
    round === 1 || matchday.format === 'AMERICANO'
      ? randomOrder(participantIds)
      : rankByStandingsSoFar(priorMatches, participantIds);

  // Repeat-partner avoidance applies to both formats now (see SPEC.md's
  // Match Generation) — only *which players land in a group together*
  // differs: Mexicano ranks by standings, Americano reshuffles fully at
  // random every round. Round 1 has no prior matches either way, so
  // history is naturally empty there regardless of format.
  const history: PartnershipHistory = buildPartnershipHistory(priorMatches, round);

  const courts = courtsFromOrderedPlayers(round, orderedPlayerIds, history);

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

  // Drop anyone who never made it off the waitlist (or explicitly
  // opted out) — mirrors the old closeRegistration's cleanup, now
  // folded into the moment play actually starts.
  if (round === 1 && nonJoiningParticipants.length > 0) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: nonJoiningParticipants.map((item) => ({
          Delete: {
            TableName: PARTICIPANTS_TABLE,
            Key: { matchdayId, playerId: item.playerId },
          },
        })),
      })
    );
  }

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
