import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;

interface SetMatchdayJoiningArgs {
  matchdayId: string;
  playerId?: string;
  joining: boolean;
}

export const handler = async (event: {
  arguments: SetMatchdayJoiningArgs;
  identity?: { username?: string; groups?: string[] };
}) => {
  const { matchdayId, playerId: targetPlayerId, joining } = event.arguments;

  // A non-admin caller can only ever act on their own RSVP — the
  // `playerId` argument exists solely for an admin acting on someone
  // else's behalf (most notably a guest, who has no login to self-serve
  // with). See ARCHITECTURE.md's Auth section for the Admins-group check.
  let playerId: string;
  if (targetPlayerId) {
    if (!event.identity?.groups?.includes('Admins')) {
      throw new Error("Only an admin can set another participant's RSVP.");
    }
    playerId = targetPlayerId;
  } else {
    const { Items } = await ddb.send(
      new QueryCommand({
        TableName: PLAYERS_TABLE,
        IndexName: 'byPhone',
        KeyConditionExpression: 'phone = :phone',
        ExpressionAttributeValues: { ':phone': event.identity?.username },
      })
    );
    const myPlayer = Items?.[0];
    if (!myPlayer) {
      throw new Error('No participant profile is linked to this login.');
    }
    playerId = myPlayer.playerId as string;
  }

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'REGISTRATION') {
    throw new Error('This matchday is not open for registration.');
  }

  const { Item: existing } = await ddb.send(
    new GetCommand({ TableName: PARTICIPANTS_TABLE, Key: { matchdayId, playerId } })
  );

  if (joining) {
    if (existing?.status === 'JOINING' || existing?.status === 'WAITLISTED') {
      return { matchdayId, playerId, status: existing.status };
    }
    const now = new Date().toISOString();
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: MATCHDAYS_TABLE,
                Key: { matchdayId },
                UpdateExpression: 'ADD joinedCount :one',
                ConditionExpression: 'joinedCount < maxParticipants',
                ExpressionAttributeValues: { ':one': 1 },
              },
            },
            {
              Put: {
                TableName: PARTICIPANTS_TABLE,
                Item: { matchdayId, playerId, status: 'JOINING', updatedAt: now },
              },
            },
          ],
        })
      );
      return { matchdayId, playerId, status: 'JOINING' };
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        await ddb.send(
          new PutCommand({
            TableName: PARTICIPANTS_TABLE,
            Item: { matchdayId, playerId, status: 'WAITLISTED', updatedAt: now },
          })
        );
        return { matchdayId, playerId, status: 'WAITLISTED' };
      }
      throw err;
    }
  }

  // joining: false
  if (!existing || existing.status === 'DECLINED') {
    return { matchdayId, playerId, status: existing?.status ?? 'DECLINED' };
  }

  if (existing.status === 'WAITLISTED') {
    await ddb.send(
      new PutCommand({
        TableName: PARTICIPANTS_TABLE,
        Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: new Date().toISOString() },
      })
    );
    return { matchdayId, playerId, status: 'DECLINED' };
  }

  // existing.status === 'JOINING' — freeing a confirmed spot. Promote the
  // longest-waiting waitlisted player (if any) in the same transaction, so
  // the count of JOINING rows never dips even momentarily.
  const { Items: participants } = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const waitlisted = (participants ?? [])
    .filter((p) => p.status === 'WAITLISTED')
    .sort((a, b) => (a.updatedAt as string).localeCompare(b.updatedAt as string));
  const promoted = waitlisted[0];

  if (promoted) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: new Date().toISOString() },
            },
          },
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: {
                matchdayId,
                playerId: promoted.playerId,
                status: 'JOINING',
                updatedAt: new Date().toISOString(),
              },
            },
          },
        ],
      })
    );
  } else {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: new Date().toISOString() },
            },
          },
          {
            Update: {
              TableName: MATCHDAYS_TABLE,
              Key: { matchdayId },
              UpdateExpression: 'ADD joinedCount :minusOne',
              ExpressionAttributeValues: { ':minusOne': -1 },
            },
          },
        ],
      })
    );
  }

  return { matchdayId, playerId, status: 'DECLINED' };
};
