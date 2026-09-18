import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
// Comma-separated, not one env var per table — keeps this handler (and
// its IAM policy, see backend-stack.ts) needing no change when a table
// is added, only the env var's value.
const TABLE_NAMES = process.env.TABLE_NAMES!.split(',');

async function scanAll(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey })
    );
    items.push(...(Items ?? []));
    ExclusiveStartKey = LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Plain "scan every table, write one JSON array per table" rather than
// DynamoDB's native ExportTableToPointInTime: these tables are tiny (low
// hundreds of items at most), so the RCU cost of a daily scan is
// negligible, and a flat, human-readable JSON file per table is far
// easier to inspect or restore from by hand than the native export's
// sharded/manifest format — matches this repo's existing local/
// reconciliation scripts' style. The S3 bucket's lifecycle rule handles
// the 4-week retention (see backend-stack.ts), not this handler.
export const handler = async () => {
  const date = new Date().toISOString().slice(0, 10);
  for (const tableName of TABLE_NAMES) {
    const items = await scanAll(tableName);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${date}/${tableName}.json`,
        Body: JSON.stringify(items),
        ContentType: 'application/json',
      })
    );
    console.log(`Backed up ${tableName}: ${items.length} items`);
  }
};
