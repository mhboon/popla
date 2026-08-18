import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'bySeasonId',
    query: {
      expression: 'seasonId = :seasonId',
      expressionValues: util.dynamodb.toMapValues({
        ':seasonId': ctx.args.seasonId,
      }),
    },
    scanIndexForward: true,
  };
}

export function response(ctx) {
  return ctx.result.items;
}
