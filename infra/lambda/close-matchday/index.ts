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

// Offsets the (small, ~ +/-24) per-matchday game differential into a
// positive range so it can be tacked onto setsWon in a single sortable
// number: rankScore = setsWon * 100000 + (gameDiff + OFFSET). Queried
// descending on the byMatchdayRank GSI, this yields the day ranking
// (sets won, then game diff) without any resolver-side sorting.
const RANK_SCORE_GAME_DIFF_OFFSET = 5000;

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
      'All 4 rounds must be generated and every set recorded before closing'
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
    if (b[1].setsWon !== a[1].setsWon) return b[1].setsWon - a[1].setsWon;
    return b[1].gamesWon - b[1].gamesLost - (a[1].gamesWon - a[1].gamesLost);
  });

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

  ranked.forEach(([playerId, s], index) => {
    const rank = index + 1;
    const gameDiff = s.gamesWon - s.gamesLost;
    const seasonPoints = rank === 1 ? participantCount : participantCount - rank;
    const rankScore = s.setsWon * 100000 + (gameDiff + RANK_SCORE_GAME_DIFF_OFFSET);

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
          rankScore,
        },
      },
    });

    transactItems.push({
      Update: {
        TableName: STANDINGS_TABLE,
        Key: { seasonId: matchday.seasonId, playerId },
        UpdateExpression: 'ADD totalPoints :points, matchdaysPlayed :one',
        ExpressionAttributeValues: { ':points': seasonPoints, ':one': 1 },
      },
    });
  });

  // DynamoDB TransactWriteItems caps at 100 items; up to 32 players is
  // 1 (matchday) + 32 (results) + 32 (standings) = 65, comfortably under.
  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return { ...matchday, status: 'CLOSED' };
};
