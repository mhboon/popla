import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;

interface ReconcileMatchdayRosterArgs {
  matchdayId: string;
}

export const handler = async (event: { arguments: ReconcileMatchdayRosterArgs }) => {
  const { matchdayId } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'SETUP') {
    throw new Error("This matchday isn't open for roster changes.");
  }

  // Uncapped matchdays never waitlist (see set-matchday-joining) and
  // don't maintain joinedCount, so there's nothing to reconcile.
  if (matchday.maxParticipants == null) {
    return matchday;
  }
  const maxParticipants = matchday.maxParticipants as number;

  const { Items: participants } = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );

  // Oldest-first in both lists: waitlisted players are promoted in the
  // order they've been waiting, and — if ever over capacity — the most
  // recently joined are the ones bumped back off.
  const byUpdatedAt = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    (a.updatedAt as string).localeCompare(b.updatedAt as string);
  const joining = (participants ?? []).filter((p) => p.status === 'JOINING').sort(byUpdatedAt);
  const waitlisted = (participants ?? []).filter((p) => p.status === 'WAITLISTED').sort(byUpdatedAt);

  const now = new Date().toISOString();
  const statusChanges: { playerId: string; status: 'JOINING' | 'WAITLISTED' }[] = [];
  let correctJoinedCount = joining.length;

  if (joining.length < maxParticipants && waitlisted.length > 0) {
    const toPromote = waitlisted.slice(0, maxParticipants - joining.length);
    statusChanges.push(...toPromote.map((p) => ({ playerId: p.playerId as string, status: 'JOINING' as const })));
    correctJoinedCount += toPromote.length;
  } else if (joining.length > maxParticipants) {
    const toDemote = joining.slice(maxParticipants);
    statusChanges.push(...toDemote.map((p) => ({ playerId: p.playerId as string, status: 'WAITLISTED' as const })));
    correctJoinedCount -= toDemote.length;
  }

  if (statusChanges.length === 0 && matchday.joinedCount === correctJoinedCount) {
    return matchday;
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: MATCHDAYS_TABLE,
            Key: { matchdayId },
            UpdateExpression: 'SET joinedCount = :joinedCount',
            ExpressionAttributeValues: { ':joinedCount': correctJoinedCount },
          },
        },
        ...statusChanges.map(({ playerId, status }) => ({
          Put: {
            TableName: PARTICIPANTS_TABLE,
            Item: { matchdayId, playerId, status, updatedAt: now },
          },
        })),
      ],
    })
  );

  return { ...matchday, joinedCount: correctJoinedCount };
};
