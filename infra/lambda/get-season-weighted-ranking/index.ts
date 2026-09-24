import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { filterOutGuests } from '../shared/players';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const RESULTS_TABLE = process.env.MATCHDAY_RESULTS_TABLE!;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;

interface GetSeasonWeightedRankingArgs {
  seasonId: string;
}

interface PlayerAccumulator {
  matchdaysPlayed: number;
  totalPoints: number;
  weightedPointsSum: number;
  weightSum: number;
}

// See SPEC.md's Weighted Ranking: a ln(N)-weighted average of season
// points, restricted to participants who've played at least 25% of the
// season's closed matchdays so far (rounded up), guests excluded.
export const handler = async (event: { arguments: GetSeasonWeightedRankingArgs }) => {
  const { seasonId } = event.arguments;

  const { Items: matchdays = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHDAYS_TABLE,
      IndexName: 'bySeasonId',
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': seasonId },
    })
  );
  const closedMatchdayCount = matchdays.filter((m) => m.status === 'CLOSED').length;
  if (closedMatchdayCount === 0) return [];

  const minMatchdaysRequired = Math.ceil(closedMatchdayCount * 0.25);

  const { Items: results = [] } = await ddb.send(
    new QueryCommand({
      TableName: RESULTS_TABLE,
      IndexName: 'bySeasonId',
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': seasonId },
    })
  );

  const byPlayer = new Map<string, PlayerAccumulator>();
  for (const r of results) {
    let acc = byPlayer.get(r.playerId);
    if (!acc) {
      acc = { matchdaysPlayed: 0, totalPoints: 0, weightedPointsSum: 0, weightSum: 0 };
      byPlayer.set(r.playerId, acc);
    }
    const weight = Math.log(r.participantCount as number);
    acc.matchdaysPlayed += 1;
    acc.totalPoints += r.seasonPoints as number;
    acc.weightedPointsSum += (r.seasonPoints as number) * weight;
    acc.weightSum += weight;
  }

  const qualifying = [...byPlayer.entries()].filter(
    ([, acc]) => acc.matchdaysPlayed >= minMatchdaysRequired
  );

  const nonGuestIds = await filterOutGuests(
    ddb,
    PLAYERS_TABLE,
    qualifying.map(([playerId]) => playerId)
  );

  return qualifying
    .filter(([playerId]) => nonGuestIds.has(playerId))
    .map(([playerId, acc]) => ({
      seasonId,
      playerId,
      weightedAverage: acc.weightedPointsSum / acc.weightSum,
      matchdaysPlayed: acc.matchdaysPlayed,
      totalPoints: acc.totalPoints,
    }))
    .sort((a, b) => {
      if (b.weightedAverage !== a.weightedAverage) return b.weightedAverage - a.weightedAverage;
      if (b.matchdaysPlayed !== a.matchdaysPlayed) return b.matchdaysPlayed - a.matchdaysPlayed;
      return b.totalPoints - a.totalPoints;
    });
};
