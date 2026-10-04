import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { buildCourtsForRound, randomOrder, type MatchRecord } from '../shared/pairing';
import { weightedRankingSeedOrder } from '../shared/weighted-ranking';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;
const RESULTS_TABLE = process.env.MATCHDAY_RESULTS_TABLE!;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;

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

  // Round 1's seed order is the one thing that tells the two Mexicano
  // variants apart (see SPEC.md's Match Generation): MEXICANO starts
  // from a random order, MEXICANO_SPECIAL from the season's current
  // weighted ranking (unranked participants — not enough matchdays
  // played yet, or guests — dropped to the bottom). Computed either way
  // even for AMERICANO/round > 1, where buildCourtsForRound ignores it,
  // since it's cheap and keeps this call site simple.
  const round1Order =
    round === 1 && matchday.format === 'MEXICANO_SPECIAL'
      ? await weightedRankingSeedOrder(
          ddb,
          { matchdaysTable: MATCHDAYS_TABLE, resultsTable: RESULTS_TABLE, playersTable: PLAYERS_TABLE },
          matchday.seasonId,
          participantIds
        )
      : randomOrder(participantIds);

  // Repeat-partner avoidance applies to every format (see SPEC.md's Match
  // Generation), but at different scopes: both Mexicano variants' groups
  // of 4 are meaningful (standings-based), so avoidance stays scoped to
  // whichever 4 land in a bucket together; Americano's groupings carry no
  // such meaning, so it pairs up the entire field at once instead, with
  // no bucket boundary constraining which players can avoid a repeat with
  // which (and, more loosely, which players face each other again as
  // opponents — see buildOpponentHistory). Round 1 has no prior matches
  // either way, so history is naturally empty there regardless of format.
  // priorMatches is every match generated so far, which (unlike
  // regenerate-round) is always every round *before* this one, since this
  // is always the next round.
  const courts = buildCourtsForRound(matchday.format, round, participantIds, priorMatches, round1Order);

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
