import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ seasonId: ctx.args.seasonId }),
    update: {
      expression: 'SET #status = :closed, closedAt = :closedAt',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({
        ':closed': 'CLOSED',
        ':closedAt': util.time.nowISO8601(),
      }),
    },
    condition: {
      expression: '#status = :active',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
