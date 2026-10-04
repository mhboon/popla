import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { computeSeasonWeightedRanking } from '../shared/weighted-ranking';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const RESULTS_TABLE = process.env.MATCHDAY_RESULTS_TABLE!;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;

interface GetSeasonWeightedRankingArgs {
  seasonId: string;
}

export const handler = async (event: { arguments: GetSeasonWeightedRankingArgs }) => {
  const { seasonId } = event.arguments;
  const ranking = await computeSeasonWeightedRanking(
    ddb,
    { matchdaysTable: MATCHDAYS_TABLE, resultsTable: RESULTS_TABLE, playersTable: PLAYERS_TABLE },
    seasonId
  );
  return ranking.map((row) => ({ seasonId, ...row }));
};
