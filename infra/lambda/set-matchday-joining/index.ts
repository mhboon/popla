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

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'SETUP') {
    throw new Error("This matchday isn't open for roster changes.");
  }

  // A non-admin caller can only ever act on their own RSVP — the
  // `playerId` argument exists solely for an admin acting on someone
  // else's behalf (most notably a guest, who has no login to self-serve
  // with), which is always allowed regardless of selfRegistrationEnabled.
  // See ARCHITECTURE.md's Auth section for the Admins-group check.
  let playerId: string;
  if (targetPlayerId) {
    if (!event.identity?.groups?.includes('Admins')) {
      throw new Error("Only an admin can set another participant's RSVP.");
    }
    playerId = targetPlayerId;
  } else {
    if (!matchday.selfRegistrationEnabled) {
      throw new Error("This matchday isn't open for self-registration — ask an admin to add you.");
    }
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

  const { Item: existing } = await ddb.send(
    new GetCommand({ TableName: PARTICIPANTS_TABLE, Key: { matchdayId, playerId } })
  );

  if (joining) {
    if (existing?.status === 'JOINING' || existing?.status === 'WAITLISTED') {
      return { matchdayId, playerId, status: existing.status, updatedAt: existing.updatedAt ?? null };
    }
    const now = new Date().toISOString();

    // No cap: nothing can ever be waitlisted, so skip the conditional
    // counter transaction entirely rather than have `joinedCount <
    // maxParticipants` evaluate false against a non-existent attribute
    // (which would wrongly waitlist every join).
    if (matchday.maxParticipants == null) {
      await ddb.send(
        new PutCommand({
          TableName: PARTICIPANTS_TABLE,
          Item: { matchdayId, playerId, status: 'JOINING', updatedAt: now },
        })
      );
      return { matchdayId, playerId, status: 'JOINING', updatedAt: now };
    }

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
      return { matchdayId, playerId, status: 'JOINING', updatedAt: now };
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        await ddb.send(
          new PutCommand({
            TableName: PARTICIPANTS_TABLE,
            Item: { matchdayId, playerId, status: 'WAITLISTED', updatedAt: now },
          })
        );
        return { matchdayId, playerId, status: 'WAITLISTED', updatedAt: now };
      }
      throw err;
    }
  }

  // joining: false
  if (!existing || existing.status === 'DECLINED') {
    return {
      matchdayId,
      playerId,
      status: existing?.status ?? 'DECLINED',
      updatedAt: existing?.updatedAt ?? null,
    };
  }

  if (existing.status === 'WAITLISTED') {
    const now = new Date().toISOString();
    await ddb.send(
      new PutCommand({
        TableName: PARTICIPANTS_TABLE,
        Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: now },
      })
    );
    return { matchdayId, playerId, status: 'DECLINED', updatedAt: now };
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
  const declinedAt = new Date().toISOString();

  if (promoted) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: declinedAt },
            },
          },
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: {
                matchdayId,
                playerId: promoted.playerId,
                status: 'JOINING',
                updatedAt: declinedAt,
              },
            },
          },
        ],
      })
    );
  } else if (matchday.maxParticipants != null) {
    // Only maintained when there's a cap to enforce — see the joining
    // branch above for why an uncapped matchday never touches this
    // counter at all.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: PARTICIPANTS_TABLE,
              Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: declinedAt },
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
  } else {
    await ddb.send(
      new PutCommand({
        TableName: PARTICIPANTS_TABLE,
        Item: { matchdayId, playerId, status: 'DECLINED', updatedAt: declinedAt },
      })
    );
  }

  return { matchdayId, playerId, status: 'DECLINED', updatedAt: declinedAt };
};
