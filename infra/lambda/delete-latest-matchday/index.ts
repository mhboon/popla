import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;
const RESULTS_TABLE = process.env.MATCHDAY_RESULTS_TABLE!;
const STANDINGS_TABLE = process.env.SEASON_STANDINGS_TABLE!;
const BACKUP_BUCKET_NAME = process.env.BACKUP_BUCKET_NAME!;

// DynamoDB TransactWriteItems caps at 100 items. The standings
// correction (at most one item per result row) and the deletes
// (matchday + participants + matches + results) are sent as separate
// transactions specifically so each one individually stays comfortably
// under that cap even for an unusually large matchday — see the two
// sends near the bottom of the handler.
interface DeleteLatestMatchdayArgs {
  matchdayId: string;
}

export const handler = async (event: { arguments: DeleteLatestMatchdayArgs }) => {
  const { matchdayId } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }

  const { Items: seasonMatchdays = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHDAYS_TABLE,
      IndexName: 'bySeasonId',
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': matchday.seasonId },
    })
  );
  const latestDate = seasonMatchdays.reduce(
    (latest, m) => ((m.date as string) > latest ? (m.date as string) : latest),
    ''
  );
  if (matchday.date !== latestDate) {
    throw new Error('Only the most recent matchday in its season can be deleted');
  }

  const [{ Items: participants = [] }, { Items: matches = [] }, { Items: results = [] }] =
    await Promise.all([
      ddb.send(
        new QueryCommand({
          TableName: PARTICIPANTS_TABLE,
          KeyConditionExpression: 'matchdayId = :matchdayId',
          ExpressionAttributeValues: { ':matchdayId': matchdayId },
        })
      ),
      ddb.send(
        new QueryCommand({
          TableName: MATCHES_TABLE,
          KeyConditionExpression: 'matchdayId = :matchdayId',
          ExpressionAttributeValues: { ':matchdayId': matchdayId },
        })
      ),
      ddb.send(
        new QueryCommand({
          TableName: RESULTS_TABLE,
          KeyConditionExpression: 'matchdayId = :matchdayId',
          ExpressionAttributeValues: { ':matchdayId': matchdayId },
        })
      ),
    ]);

  // Preserve everything about to be deleted before touching any table —
  // this export is the only remaining copy of it afterward (the daily
  // table backup is at most 24h stale), so it happens unconditionally,
  // first, regardless of whether the matchday was ever closed.
  await s3.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET_NAME,
      Key: `deleted-matchdays/${matchdayId}.json`,
      Body: JSON.stringify({ matchday, participants, matches, results, deletedAt: new Date().toISOString() }),
      ContentType: 'application/json',
    })
  );

  // Reverse this matchday's contribution to season standings — only
  // meaningful if it was actually closed (results only ever exist once
  // closeMatchday has run). A player whose *only* matchday this season
  // was this one (matchdaysPlayed === 1, read fresh rather than assumed)
  // gets their standings row deleted entirely, matching the state before
  // they'd ever played, rather than left behind at a hollow 0/0/0.
  if (results.length > 0) {
    const resultPlayerIds = results.map((r) => r.playerId as string);
    const { Responses } = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [STANDINGS_TABLE]: {
            Keys: resultPlayerIds.map((playerId) => ({ seasonId: matchday.seasonId, playerId })),
          },
        },
      })
    );
    const currentByPlayer = new Map(
      (Responses?.[STANDINGS_TABLE] ?? []).map((item) => [item.playerId as string, item])
    );

    const standingsItems = results.map((r) => {
      const playerId = r.playerId as string;
      const current = currentByPlayer.get(playerId);
      const key = { seasonId: matchday.seasonId, playerId };
      if ((current?.matchdaysPlayed ?? 0) <= 1) {
        return { Delete: { TableName: STANDINGS_TABLE, Key: key } };
      }
      return {
        Update: {
          TableName: STANDINGS_TABLE,
          Key: key,
          UpdateExpression: 'ADD totalPoints :negPoints, matchdaysPlayed :negOne, winnerPoints :negWinner',
          ExpressionAttributeValues: {
            ':negPoints': -(r.seasonPoints as number),
            ':negOne': -1,
            ':negWinner': r.winnerPoint ? -1 : 0,
          },
        },
      };
    });
    await ddb.send(new TransactWriteCommand({ TransactItems: standingsItems }));
  }

  const deleteItems = [
    { Delete: { TableName: MATCHDAYS_TABLE, Key: { matchdayId } } },
    ...participants.map((p) => ({
      Delete: { TableName: PARTICIPANTS_TABLE, Key: { matchdayId, playerId: p.playerId } },
    })),
    ...matches.map((m) => ({
      Delete: { TableName: MATCHES_TABLE, Key: { matchdayId, roundCourt: m.roundCourt } },
    })),
    ...results.map((r) => ({
      Delete: { TableName: RESULTS_TABLE, Key: { matchdayId, playerId: r.playerId } },
    })),
  ];
  await ddb.send(new TransactWriteCommand({ TransactItems: deleteItems }));

  return matchday.seasonId as string;
};
