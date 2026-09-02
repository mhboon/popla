import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'bySeasonWinnerPoints',
    query: {
      expression: 'seasonId = :seasonId',
      expressionValues: util.dynamodb.toMapValues({
        ':seasonId': ctx.args.seasonId,
      }),
    },
    scanIndexForward: false,
  };
}

export function response(ctx) {
  return ctx.result.items;
}
