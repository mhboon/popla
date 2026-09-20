import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'matchdayId = :matchdayId',
      expressionValues: util.dynamodb.toMapValues({
        ':matchdayId': ctx.args.matchdayId,
      }),
    },
  };
}

// A row with no stored `status` pre-dates this field entirely (every
// writer sets one now — see infra/lambda/set-matchday-joining and
// Mutation.createMatchday.js) — reads as JOINING either way.
export function response(ctx) {
  return ctx.result.items.map((item) => ({
    matchdayId: item.matchdayId,
    playerId: item.playerId,
    status: item.status ?? 'JOINING',
    updatedAt: item.updatedAt ?? null,
  }));
}
