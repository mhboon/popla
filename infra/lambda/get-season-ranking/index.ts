import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { filterOutGuests } from '../shared/players';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const STANDINGS_TABLE = process.env.SEASON_STANDINGS_TABLE!;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;

interface GetSeasonRankingArgs {
  seasonId: string;
}

// Shared by getSeasonStanding ('points') and getSeasonWinnerRanking
// ('winners') — same table, same shape, only the sort GSI differs. Both
// exclude guests, live off current guest status (see SPEC.md's Guest
// participants) — a join the underlying SeasonStandings.bySeasonPoints/
// bySeasonWinnerPoints GSI query alone can't do, hence Lambda over native.
export const handler = async (event: {
  arguments: GetSeasonRankingArgs;
  rankingType: 'points' | 'winners';
}) => {
  const { seasonId } = event.arguments;
  const index = event.rankingType === 'winners' ? 'bySeasonWinnerPoints' : 'bySeasonPoints';

  const { Items: standings = [] } = await ddb.send(
    new QueryCommand({
      TableName: STANDINGS_TABLE,
      IndexName: index,
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': seasonId },
      ScanIndexForward: false,
    })
  );

  const nonGuestIds = await filterOutGuests(
    ddb,
    PLAYERS_TABLE,
    standings.map((s) => s.playerId)
  );

  return standings.filter((s) => nonGuestIds.has(s.playerId));
};
