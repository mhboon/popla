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

// A row with no stored `status` was written by createMatchday/
// updateMatchday, which never set one (see infra/lambda/set-matchday-
// joining, the only writer of `status`) — that's every row once a
// matchday leaves REGISTRATION, so it reads as JOINING.
export function response(ctx) {
  return ctx.result.items.map((item) => ({
    matchdayId: item.matchdayId,
    playerId: item.playerId,
    status: item.status ?? 'JOINING',
  }));
}
