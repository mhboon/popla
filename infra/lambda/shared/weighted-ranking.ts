import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { filterOutGuests } from './players';
import { randomOrder } from './pairing';

export interface WeightedRankingTables {
  matchdaysTable: string;
  resultsTable: string;
  playersTable: string;
}

export interface WeightedRankingRow {
  playerId: string;
  weightedAverage: number;
  matchdaysPlayed: number;
  totalPoints: number;
}

interface PlayerAccumulator {
  matchdaysPlayed: number;
  totalPoints: number;
  weightedPointsSum: number;
  weightSum: number;
}

/**
 * See SPEC.md's Weighted Ranking: a ln(N)-weighted average of season
 * points, restricted to participants who've played at least 25% of the
 * season's closed matchdays so far (rounded up), guests excluded.
 * Shared between the getSeasonWeightedRanking query and
 * generate-round/regenerate-round's Mexicano Special round-1 seeding
 * (see weightedRankingSeedOrder below) — both need the identical
 * computation, not just a similar one.
 */
export async function computeSeasonWeightedRanking(
  ddb: DynamoDBDocumentClient,
  tables: WeightedRankingTables,
  seasonId: string
): Promise<WeightedRankingRow[]> {
  const { Items: matchdays = [] } = await ddb.send(
    new QueryCommand({
      TableName: tables.matchdaysTable,
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
      TableName: tables.resultsTable,
      IndexName: 'bySeasonId',
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': seasonId },
    })
  );

  // Participant count per matchday, derived from the fetched rows
  // themselves (every player who played that matchday has a row) rather
  // than trusted from a stored attribute — this way it's correct
  // regardless of when the matchday was closed, with no data migration
  // needed for matchdays that predate this ranking.
  const participantCountByMatchday = new Map<string, number>();
  for (const r of results) {
    participantCountByMatchday.set(
      r.matchdayId,
      (participantCountByMatchday.get(r.matchdayId) ?? 0) + 1
    );
  }

  const byPlayer = new Map<string, PlayerAccumulator>();
  for (const r of results) {
    let acc = byPlayer.get(r.playerId);
    if (!acc) {
      acc = { matchdaysPlayed: 0, totalPoints: 0, weightedPointsSum: 0, weightSum: 0 };
      byPlayer.set(r.playerId, acc);
    }
    const weight = Math.log(participantCountByMatchday.get(r.matchdayId)!);
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
    tables.playersTable,
    qualifying.map(([playerId]) => playerId)
  );

  return qualifying
    .filter(([playerId]) => nonGuestIds.has(playerId))
    .map(([playerId, acc]) => ({
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
}

/**
 * Round-1 seeding for the Mexicano Special format (see SPEC.md's Match
 * Generation): this matchday's participants, ordered by their current
 * season weighted ranking (best first) — anyone not on that ranking at
 * all (not enough matchdays played yet, or guests, who are never on it —
 * see SPEC.md's Guest participants) lands after everyone who is,
 * shuffled among themselves since there's no signal to rank them by.
 * courtsFromOrderedPlayers then buckets this straight into groups of 4,
 * same as any other Mexicano round.
 */
export async function weightedRankingSeedOrder(
  ddb: DynamoDBDocumentClient,
  tables: WeightedRankingTables,
  seasonId: string,
  participantIds: string[]
): Promise<string[]> {
  const ranking = await computeSeasonWeightedRanking(ddb, tables, seasonId);
  const participantSet = new Set(participantIds);
  const ranked = ranking.map((r) => r.playerId).filter((playerId) => participantSet.has(playerId));
  const rankedSet = new Set(ranked);
  const unranked = randomOrder(participantIds.filter((playerId) => !rankedSet.has(playerId)));
  return [...ranked, ...unranked];
}
