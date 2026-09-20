import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;

interface CloseRegistrationArgs {
  matchdayId: string;
}

export const handler = async (event: { arguments: CloseRegistrationArgs }) => {
  const { matchdayId } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'REGISTRATION') {
    throw new Error('This matchday is not open for registration.');
  }

  const { Items: participants } = await ddb.send(
    new QueryCommand({
      TableName: PARTICIPANTS_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  const joining = (participants ?? []).filter((p) => p.status === 'JOINING');
  const others = (participants ?? []).filter((p) => p.status !== 'JOINING');

  if (joining.length === 0 || joining.length % 4 !== 0) {
    throw new Error(
      `Confirmed participant count must be a non-zero multiple of 4 to close registration (currently ${joining.length})`
    );
  }

  // Up to 32 participants means at most 32 delete + 1 matchday update = 33
  // items, comfortably under the 100-item transaction limit (same
  // headroom note as infra/lambda/update-matchday).
  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
  > = [
    {
      Update: {
        TableName: MATCHDAYS_TABLE,
        Key: { matchdayId },
        UpdateExpression: 'SET #status = :setup',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':setup': 'SETUP' },
      },
    },
    ...others.map((p) => ({
      Delete: {
        TableName: PARTICIPANTS_TABLE,
        Key: { matchdayId, playerId: p.playerId },
      },
    })),
  ];

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { ...matchday, status: 'SETUP' };
};
