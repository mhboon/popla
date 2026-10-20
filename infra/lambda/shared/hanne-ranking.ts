import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { computeSeasonWeightedRanking, type WeightedRankingTables } from './weighted-ranking';

export interface HanneRankingTables extends WeightedRankingTables {
  matchesTable: string;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// logit/sigmoid on a shared 0-1 "seed score" scale, used purely as an odds
// conversion to turn two teams' seed scores into a win-probability-style
// expectation below — not a persisted rating of any kind.
function logit(p: number): number {
  const c = clamp(p, 0.02, 0.98);
  return Math.log(c / (1 - c));
}
function expectedProb(ownAvgScore: number, oppAvgScore: number): number {
  return 1 / (1 + Math.exp(-(logit(ownAvgScore) - logit(oppAvgScore))));
}

// Only the most recent few closed matchdays can ever carry nonzero weight
// (see weight() below) — same linearly-decaying-to-zero shape as the
// within-matchday live form in pairing.ts, just over matchdays instead of
// rounds. SEASON_WEIGHT_BASE / SEASON_WEIGHT_STEP = 5, so anything beyond
// the 5 most recent closed matchdays this season never needs to be fetched
// at all.
const SEASON_WEIGHT_BASE = 5;
const SEASON_WEIGHT_STEP = 1;
function matchdayWeight(matchdaysAgo: number): number {
  return Math.max(SEASON_WEIGHT_BASE - matchdaysAgo * SEASON_WEIGHT_STEP, 0);
}

// How strongly a sustained actual-vs-expected mismatch nudges the season
// score, and how far that nudge can ever move it — small and bounded on
// purpose (see SPEC.md's Match Generation): it's meant to stop a run of bad
// luck (e.g. a strong player stuck with a weak partner, losing exactly as
// their own seed score would already predict) from dragging someone's
// seeding down, not to replace the season component it sits on top of.
const CORRECTION_K = 0.15;
const CORRECTION_MAX = 0.15;

/**
 * Hanne Special's season-level seed score for each of this matchday's
 * participants (see SPEC.md's Match Generation) — the season's current
 * Weighted Ranking, normalized onto a 0-1 scale, plus a small bounded
 * correction built from how much each player's actual results diverged
 * from what that same seed score would have predicted, across the most
 * recent handful of closed matchdays this season. Blended every round with
 * this matchday's own live form by buildCourtsForRound — see
 * shared/pairing.ts.
 *
 * Deliberately simpler than it could be: every player's seed score here —
 * including in the historical replay used to compute the correction — is
 * their *current* Weighted Ranking, not a point-in-time snapshot of what it
 * was back when an old match was played. That's a better-behaved baseline
 * than a noisy early-season snapshot would be (and avoids needing to
 * recompute Weighted Ranking once per past matchday), at the cost of the
 * correction answering "does this season's full picture of everyone's
 * ability explain what happened" rather than "did this looks surprising
 * at the time" — the right question for a fairness check, not a worse one.
 */
export async function computeHanneSeedScores(
  ddb: DynamoDBDocumentClient,
  tables: HanneRankingTables,
  seasonId: string,
  participantIds: string[]
): Promise<Map<string, number>> {
  const weightedRanking = await computeSeasonWeightedRanking(ddb, tables, seasonId);
  const weightedByPlayer = new Map(weightedRanking.map((r) => [r.playerId, r.weightedAverage]));

  const N = participantIds.length;
  // Anyone not on the Weighted Ranking yet (hasn't played enough matchdays
  // this season, or is a guest, who's never on it) gets a neutral 0.5 —
  // "no signal either way" rather than Mexicano Special's "starts at the
  // bottom", since this score is re-blended with live form every round
  // rather than only ever seeding round 1.
  const seasonScore = (playerId: string): number => {
    const weightedAverage = weightedByPlayer.get(playerId);
    return weightedAverage === undefined ? 0.5 : clamp(weightedAverage / N, 0.02, 0.98);
  };

  const correction = await computeCorrection(ddb, tables, seasonId, seasonScore);

  const seedScores = new Map<string, number>();
  for (const playerId of participantIds) {
    seedScores.set(playerId, clamp(seasonScore(playerId) + (correction.get(playerId) ?? 0), 0.01, 0.99));
  }
  return seedScores;
}

async function computeCorrection(
  ddb: DynamoDBDocumentClient,
  tables: HanneRankingTables,
  seasonId: string,
  seasonScore: (playerId: string) => number
): Promise<Map<string, number>> {
  const { Items: matchdays = [] } = await ddb.send(
    new QueryCommand({
      TableName: tables.matchdaysTable,
      IndexName: 'bySeasonId',
      KeyConditionExpression: 'seasonId = :seasonId',
      ExpressionAttributeValues: { ':seasonId': seasonId },
    })
  );
  const recentClosed = matchdays
    .filter((m) => m.status === 'CLOSED')
    .sort((a, b) => (b.date as string).localeCompare(a.date as string))
    .slice(0, SEASON_WEIGHT_BASE); // anything further back always has weight 0 — see matchdayWeight

  const residualSum = new Map<string, number>();
  const residualWeight = new Map<string, number>();
  const addResidual = (playerId: string, weight: number, residual: number) => {
    residualSum.set(playerId, (residualSum.get(playerId) ?? 0) + weight * residual);
    residualWeight.set(playerId, (residualWeight.get(playerId) ?? 0) + weight);
  };

  await Promise.all(
    recentClosed.map(async (matchday, matchdaysAgo) => {
      const weight = matchdayWeight(matchdaysAgo);
      if (weight === 0) return;
      const { Items: matches = [] } = await ddb.send(
        new QueryCommand({
          TableName: tables.matchesTable,
          KeyConditionExpression: 'matchdayId = :matchdayId',
          ExpressionAttributeValues: { ':matchdayId': matchday.matchdayId },
        })
      );
      for (const m of matches) {
        if (m.status !== 'COMPLETE') continue;
        const team1 = m.team1PlayerIds as string[];
        const team2 = m.team2PlayerIds as string[];
        const s1 = (seasonScore(team1[0]) + seasonScore(team1[1])) / 2;
        const s2 = (seasonScore(team2[0]) + seasonScore(team2[1])) / 2;
        const expected1 = expectedProb(s1, s2);
        const actual1 = m.team1Games / (m.team1Games + m.team2Games);
        for (const p of team1) addResidual(p, weight, actual1 - expected1);
        for (const p of team2) addResidual(p, weight, 1 - actual1 - (1 - expected1));
      }
    })
  );

  const correction = new Map<string, number>();
  for (const [playerId, sum] of residualSum) {
    const weight = residualWeight.get(playerId)!;
    correction.set(playerId, clamp((sum / weight) * CORRECTION_K, -CORRECTION_MAX, CORRECTION_MAX));
  }
  return correction;
}
