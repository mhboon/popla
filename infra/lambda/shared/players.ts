import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

// BatchGetItem caps a single request at 100 keys.
const BATCH_GET_LIMIT = 100;

/**
 * Returns the subset of `playerIds` that currently belong to a full
 * (non-guest) participant, i.e. their Player record has a `phone` set —
 * see SPEC.md's Guest participants and Player.isGuest in schema.graphql.
 * Evaluated live against the Players table, not a snapshot.
 */
export async function filterOutGuests(
  ddb: DynamoDBDocumentClient,
  playersTable: string,
  playerIds: string[]
): Promise<Set<string>> {
  const uniqueIds = [...new Set(playerIds)];
  const nonGuestIds = new Set<string>();

  for (let i = 0; i < uniqueIds.length; i += BATCH_GET_LIMIT) {
    const batch = uniqueIds.slice(i, i + BATCH_GET_LIMIT);
    const { Responses } = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [playersTable]: {
            Keys: batch.map((playerId) => ({ playerId })),
            ProjectionExpression: 'playerId, phone',
          },
        },
      })
    );
    for (const player of Responses?.[playersTable] ?? []) {
      if (player.phone) nonGuestIds.add(player.playerId);
    }
  }

  return nonGuestIds;
}
