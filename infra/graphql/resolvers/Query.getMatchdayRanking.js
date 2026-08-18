import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'byMatchdayRank',
    query: {
      expression: 'matchdayId = :matchdayId',
      expressionValues: util.dynamodb.toMapValues({
        ':matchdayId': ctx.args.matchdayId,
      }),
    },
    scanIndexForward: false,
  };
}

export function response(ctx) {
  return ctx.result.items;
}
