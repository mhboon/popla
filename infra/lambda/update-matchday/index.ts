import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;

interface UpdateMatchdayArgs {
  matchdayId: string;
  date?: string;
  format?: 'MEXICANO' | 'AMERICANO';
  participantIds?: string[];
}

export const handler = async (event: { arguments: UpdateMatchdayArgs }) => {
  const { matchdayId, date, format, participantIds } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'SETUP') {
    throw new Error(
      'Matchday can only be edited while it is still in SETUP (before round 1 has been generated)'
    );
  }

  if (participantIds !== undefined && (participantIds.length === 0 || participantIds.length % 4 !== 0)) {
    throw new Error('participantIds must be a non-zero multiple of 4');
  }

  const matchdaySetClauses: string[] = [];
  const matchdayNames: Record<string, string> = {};
  const matchdayValues: Record<string, unknown> = {};
  if (date !== undefined) {
    matchdaySetClauses.push('#date = :date');
    matchdayNames['#date'] = 'date';
    matchdayValues[':date'] = date;
  }
  if (format !== undefined) {
    matchdaySetClauses.push('#format = :format');
    matchdayNames['#format'] = 'format';
    matchdayValues[':format'] = format;
  }

  if (participantIds === undefined) {
    if (matchdaySetClauses.length > 0) {
      await ddb.send(
        new UpdateCommand({
          TableName: MATCHDAYS_TABLE,
          Key: { matchdayId },
          UpdateExpression: `SET ${matchdaySetClauses.join(', ')}`,
          ExpressionAttributeNames: matchdayNames,
          ExpressionAttributeValues: matchdayValues,
        })
      );
    }
    return { ...matchday, date: date ?? matchday.date, format: format ?? matchday.format };
  }

  const existingResult = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const existingIds = new Set((existingResult.Items ?? []).map((item) => item.playerId as string));
  const newIds = new Set(participantIds);

  const toAdd = [...newIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !newIds.has(id));

  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
  > = [];

  if (matchdaySetClauses.length > 0) {
    transactItems.push({
      Update: {
        TableName: MATCHDAYS_TABLE,
        Key: { matchdayId },
        UpdateExpression: `SET ${matchdaySetClauses.join(', ')}`,
        ExpressionAttributeNames: matchdayNames,
        ExpressionAttributeValues: matchdayValues,
      },
    });
  }
  for (const playerId of toAdd) {
    transactItems.push({
      Put: { TableName: PARTICIPANTS_TABLE, Item: { matchdayId, playerId } },
    });
  }
  for (const playerId of toRemove) {
    transactItems.push({
      Delete: { TableName: PARTICIPANTS_TABLE, Key: { matchdayId, playerId } },
    });
  }

  // Up to 32 participants means at most 32 add + 32 remove + 1 matchday
  // update = 65 items, comfortably under the 100-item transaction limit.
  if (transactItems.length > 0) {
    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }

  return { ...matchday, date: date ?? matchday.date, format: format ?? matchday.format };
};
