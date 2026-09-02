import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;
const RESULTS_TABLE = process.env.MATCHDAY_RESULTS_TABLE!;
const STANDINGS_TABLE = process.env.SEASON_STANDINGS_TABLE!;

// Encodes the 3-level day ranking (games won, then game diff, then sets
// won — see SPEC.md's Day Ranking) into a single sortable number:
// rankScore = gamesWon * GAME_DIFF_SPAN * SETS_WON_SPAN
//           + (gameDiff + OFFSET) * SETS_WON_SPAN
//           + setsWon
// Queried descending on the byMatchdayRank GSI, this yields the day
// ranking directly, no resolver-side sorting needed. Each span is
// generous headroom for an unusually long matchday (rounds are
// open-ended, see SPEC.md): OFFSET=5000 covers |gameDiff| up to ~800
// rounds (so GAME_DIFF_SPAN=10000, twice the offset, always keeps
// gameDiff + OFFSET positive and below the span), SETS_WON_SPAN=10000
// covers setsWon up to 10000 rounds, and gamesWon itself tops out
// around 100000 (~16000 rounds at 6 games/round) — all while the
// combined value (worst case ~1e13) stays well under
// Number.MAX_SAFE_INTEGER (~9e15).
const RANK_SCORE_GAME_DIFF_OFFSET = 5000;
const RANK_SCORE_GAME_DIFF_SPAN = 10000;
const RANK_SCORE_SETS_WON_SPAN = 10000;

interface CloseMatchdayArgs {
  matchdayId: string;
}

interface PlayerStats {
  setsWon: number;
  gamesWon: number;
  gamesLost: number;
}

export const handler = async (event: { arguments: CloseMatchdayArgs }) => {
  const { matchdayId } = event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status === 'CLOSED') {
    throw new Error('Matchday is already closed');
  }

  const { Items: matches = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );
  if (matches.length === 0 || matches.some((m) => m.status !== 'COMPLETE')) {
    throw new Error(
      'At least one round must be generated, and every set recorded, before closing'
    );
  }

  const stats = new Map<string, PlayerStats>();
  const ensure = (playerId: string): PlayerStats => {
    let s = stats.get(playerId);
    if (!s) {
      s = { setsWon: 0, gamesWon: 0, gamesLost: 0 };
      stats.set(playerId, s);
    }
    return s;
  };

  for (const match of matches) {
    const t1 = match.team1Games as number;
    const t2 = match.team2Games as number;
    const team1Won = t1 > t2;

    for (const playerId of match.team1PlayerIds as string[]) {
      const s = ensure(playerId);
      s.setsWon += team1Won ? 1 : 0;
      s.gamesWon += t1;
      s.gamesLost += t2;
    }
    for (const playerId of match.team2PlayerIds as string[]) {
      const s = ensure(playerId);
      s.setsWon += team1Won ? 0 : 1;
      s.gamesWon += t2;
      s.gamesLost += t1;
    }
  }

  const participantCount = stats.size;
  const ranked = [...stats.entries()].sort((a, b) => {
    if (b[1].gamesWon !== a[1].gamesWon) return b[1].gamesWon - a[1].gamesWon;
    const diffA = a[1].gamesWon - a[1].gamesLost;
    const diffB = b[1].gamesWon - b[1].gamesLost;
    if (diffB !== diffA) return diffB - diffA;
    return b[1].setsWon - a[1].setsWon;
  });

  // Winner points ("streepjes" — see SPEC.md): every participant who won
  // all their sets this matchday earns one, unless fewer than 2 did, in
  // which case rank 1 and rank 2 of the day ranking earn it instead
  // (topped up around anyone who already qualified by going undefeated).
  // Every participant plays exactly one set per round, so "won all sets"
  // is setsWon === totalRounds.
  const totalRounds = Math.max(...matches.map((m) => m.round as number));
  const winnerPointPlayerIds = new Set(
    ranked.filter(([, s]) => s.setsWon === totalRounds).map(([playerId]) => playerId)
  );
  for (const [playerId] of ranked) {
    if (winnerPointPlayerIds.size >= 2) break;
    winnerPointPlayerIds.add(playerId);
  }

  const transactItems: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
  > = [
    {
      Update: {
        TableName: MATCHDAYS_TABLE,
        Key: { matchdayId },
        UpdateExpression: 'SET #status = :closed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':closed': 'CLOSED' },
      },
    },
  ];

  // Standard competition ranking ("1224"): players tied on gamesWon,
  // gameDiff, and setsWon all share the same rank (and so the same
  // season points) instead of being split across consecutive ranks by
  // array position; the next distinct rank accounts for the size of the
  // tied group (two players tied for rank 2 pushes the next player to
  // rank 4, not 3), same as the `index + 1` formula naturally gives once
  // ties are detected — see the `tiedWithPrevious` check below.
  let previousRank = 0;
  let previousGamesWon: number | null = null;
  let previousGameDiff: number | null = null;
  let previousSetsWon: number | null = null;

  ranked.forEach(([playerId, s], index) => {
    const gameDiff = s.gamesWon - s.gamesLost;
    const tiedWithPrevious =
      s.gamesWon === previousGamesWon &&
      gameDiff === previousGameDiff &&
      s.setsWon === previousSetsWon;
    const rank = tiedWithPrevious ? previousRank : index + 1;
    previousRank = rank;
    previousGamesWon = s.gamesWon;
    previousGameDiff = gameDiff;
    previousSetsWon = s.setsWon;

    const seasonPoints = rank === 1 ? participantCount : participantCount - rank;
    const winnerPoint = winnerPointPlayerIds.has(playerId);
    const rankScore =
      s.gamesWon * RANK_SCORE_GAME_DIFF_SPAN * RANK_SCORE_SETS_WON_SPAN +
      (gameDiff + RANK_SCORE_GAME_DIFF_OFFSET) * RANK_SCORE_SETS_WON_SPAN +
      s.setsWon;

    transactItems.push({
      Put: {
        TableName: RESULTS_TABLE,
        Item: {
          matchdayId,
          playerId,
          seasonId: matchday.seasonId,
          setsWon: s.setsWon,
          gamesWon: s.gamesWon,
          gamesLost: s.gamesLost,
          gameDiff,
          rank,
          seasonPoints,
          winnerPoint,
          rankScore,
        },
      },
    });

    transactItems.push({
      Update: {
        TableName: STANDINGS_TABLE,
        Key: { seasonId: matchday.seasonId, playerId },
        UpdateExpression: 'ADD totalPoints :points, matchdaysPlayed :one, winnerPoints :winnerPoint',
        ExpressionAttributeValues: {
          ':points': seasonPoints,
          ':one': 1,
          ':winnerPoint': winnerPoint ? 1 : 0,
        },
      },
    });
  });

  // DynamoDB TransactWriteItems caps at 100 items; up to 32 players is
  // 1 (matchday) + 32 (results) + 32 (standings) = 65, comfortably under.
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { ...matchday, status: 'CLOSED' };
};
