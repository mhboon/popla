import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ seasonId: ctx.args.seasonId }),
    update: {
      expression: 'SET #status = :active REMOVE closedAt',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
    },
    condition: {
      expression: '#status = :closed',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':closed': 'CLOSED' }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
