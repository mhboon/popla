import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { matchdayId, round, court, team1Games, team2Games } = ctx.args;
  const high = Math.max(team1Games, team2Games);
  const low = Math.min(team1Games, team2Games);

  // Sets are played to 6 games, no tiebreak, no win-by-two requirement:
  // one side must reach exactly 6, the other must be strictly lower.
  if (high !== 6 || low >= 6 || low < 0) {
    util.error(
      'Invalid score: one side must reach exactly 6 games and the other fewer than 6',
      'ValidationError'
    );
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      matchdayId,
      roundCourt: `ROUND#${round}#COURT#${court}`,
    }),
    update: {
      expression:
        'SET team1Games = :t1, team2Games = :t2, #status = :complete',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({
        ':t1': team1Games,
        ':t2': team2Games,
        ':complete': 'COMPLETE',
      }),
    },
    condition: {
      expression: 'attribute_exists(matchdayId)',
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
