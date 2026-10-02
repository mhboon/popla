import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const MATCHES_TABLE = process.env.MATCHES_TABLE!;

interface SwitchRoundPlayersArgs {
  matchdayId: string;
  round: number;
  playerId1: string;
  playerId2: string;
}

type TeamField = 'team1PlayerIds' | 'team2PlayerIds';

interface Slot {
  roundCourt: string;
  team: TeamField;
  index: number;
}

export const handler = async (event: { arguments: SwitchRoundPlayersArgs }) => {
  const { matchdayId, round, playerId1, playerId2 } = event.arguments;

  if (playerId1 === playerId2) {
    throw new Error('Choose two different players to switch');
  }

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'IN_PROGRESS') {
    throw new Error('Only an in-progress matchday has an active round to switch players in');
  }

  const { Items: allMatches = [] } = await ddb.send(
    new QueryCommand({
      TableName: MATCHES_TABLE,
      KeyConditionExpression: 'matchdayId = :matchdayId',
      ExpressionAttributeValues: { ':matchdayId': matchdayId },
    })
  );

  // "Active round" mirrors the UI's own readOnly rule (see
  // MatchdayPage.tsx): the highest round number any match exists for.
  // Recorded results don't matter here — unlike regenerateRound, a
  // switch is allowed whether or not the round's matches are COMPLETE,
  // as long as it's still the current, not-yet-superseded round.
  const currentRound = allMatches.length === 0 ? 0 : Math.max(...allMatches.map((m) => m.round as number));
  if (round !== currentRound) {
    throw new Error(`Round ${round} is not the active round — only the active round's players can be switched`);
  }

  const roundMatches = allMatches.filter((m) => m.round === round);

  function findSlot(playerId: string): Slot {
    for (const m of roundMatches) {
      const i1 = (m.team1PlayerIds as string[]).indexOf(playerId);
      if (i1 !== -1) return { roundCourt: m.roundCourt as string, team: 'team1PlayerIds', index: i1 };
      const i2 = (m.team2PlayerIds as string[]).indexOf(playerId);
      if (i2 !== -1) return { roundCourt: m.roundCourt as string, team: 'team2PlayerIds', index: i2 };
    }
    throw new Error(`That player isn't in round ${round}`);
  }

  const slot1 = findSlot(playerId1);
  const slot2 = findSlot(playerId2);

  // Keyed by roundCourt so a same-court switch (both slots on one
  // match — e.g. swapping two opponents) applies both edits to the same
  // in-memory copy instead of racing two separate ones.
  const byRoundCourt = new Map(roundMatches.map((m) => [m.roundCourt as string, { ...m }]));

  const applySwap = (slot: Slot, newPlayerId: string) => {
    const m = { ...byRoundCourt.get(slot.roundCourt)! };
    const team = [...(m[slot.team] as string[])];
    team[slot.index] = newPlayerId;
    m[slot.team] = team;
    byRoundCourt.set(slot.roundCourt, m);
  };
  applySwap(slot1, playerId2);
  applySwap(slot2, playerId1);

  const touchedRoundCourts = [...new Set([slot1.roundCourt, slot2.roundCourt])];

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: touchedRoundCourts.map((roundCourt) => {
        const m = byRoundCourt.get(roundCourt)!;
        return {
          Update: {
            TableName: MATCHES_TABLE,
            Key: { matchdayId, roundCourt },
            UpdateExpression: 'SET team1PlayerIds = :t1, team2PlayerIds = :t2',
            ExpressionAttributeValues: {
              ':t1': m.team1PlayerIds,
              ':t2': m.team2PlayerIds,
            },
          },
        };
      }),
    })
  );

  return roundMatches
    .map((m) => byRoundCourt.get(m.roundCourt as string)!)
    .sort((a, b) => (a.court as number) - (b.court as number))
    .map((m) => ({
      matchdayId,
      round: m.round,
      court: m.court,
      team1PlayerIds: m.team1PlayerIds,
      team2PlayerIds: m.team2PlayerIds,
      team1Games: m.team1Games ?? null,
      team2Games: m.team2Games ?? null,
      status: m.status,
    }));
};
