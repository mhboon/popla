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

export function response(ctx) {
  return ctx.result.items.map((item) => item.playerId);
}
