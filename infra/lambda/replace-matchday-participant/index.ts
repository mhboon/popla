import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;

interface ReplaceMatchdayParticipantArgs {
  matchdayId: string;
  outgoingPlayerId: string;
  incomingPlayerId: string;
}

export const handler = async (event: { arguments: ReplaceMatchdayParticipantArgs }) => {
  const { matchdayId, outgoingPlayerId, incomingPlayerId } = event.arguments;

  if (outgoingPlayerId === incomingPlayerId) {
    throw new Error('Choose a different player to replace with');
  }

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'IN_PROGRESS') {
    throw new Error('Only an in-progress matchday has a roster to replace a participant in');
  }

  const { Items: participants = [] } = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  if (!participants.some((p) => p.playerId === outgoingPlayerId)) {
    throw new Error("That player isn't part of this matchday");
  }
  if (participants.some((p) => p.playerId === incomingPlayerId)) {
    throw new Error('That player is already part of this matchday');
  }

  const { Items: matches = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );

  // Rewrites every Match the outgoing player appears in — already-
  // COMPLETE rounds included, not just the active one — so the incoming
  // player ends up credited for the whole matchday, as if they'd been
  // there from round 1 (see schema.graphql's replaceMatchdayParticipant).
  // Court/team slots themselves are untouched; only the id standing in
  // the slot changes.
  const touched = matches
    .map((m) => {
      const team1 = m.team1PlayerIds as string[];
      const team2 = m.team2PlayerIds as string[];
      const i1 = team1.indexOf(outgoingPlayerId);
      const i2 = team2.indexOf(outgoingPlayerId);
      if (i1 === -1 && i2 === -1) return null;
      const updated = { ...m };
      if (i1 !== -1) {
        const next = [...team1];
        next[i1] = incomingPlayerId;
        updated.team1PlayerIds = next;
      }
      if (i2 !== -1) {
        const next = [...team2];
        next[i2] = incomingPlayerId;
        updated.team2PlayerIds = next;
      }
      return updated;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const now = new Date().toISOString();

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        ...touched.map((m) => ({
          Update: {
            TableName: MATCHES_TABLE,
            Key: { matchdayId, roundCourt: m.roundCourt },
            UpdateExpression: 'SET team1PlayerIds = :t1, team2PlayerIds = :t2',
            ExpressionAttributeValues: {
              ':t1': m.team1PlayerIds,
              ':t2': m.team2PlayerIds,
            },
          },
        })),
        {
          Delete: {
            TableName: PARTICIPANTS_TABLE,
            Key: { matchdayId, playerId: outgoingPlayerId },
          },
        },
        {
          Put: {
            TableName: PARTICIPANTS_TABLE,
            Item: { matchdayId, playerId: incomingPlayerId, status: 'JOINING', updatedAt: now },
          },
        },
      ],
    })
  );

  return touched
    .sort((a, b) => (a.round as number) - (b.round as number) || (a.court as number) - (b.court as number))
    .map((m) => ({
      matchdayId,
      round: m.round,
      court: m.court,
      team1PlayerIds: m.team1PlayerIds,
      team2PlayerIds: m.team2PlayerIds,
      team1Games: m.team1Games ?? null,
      team2Games: m.team2Games ?? null,
      status: m.status,
    }));
};
