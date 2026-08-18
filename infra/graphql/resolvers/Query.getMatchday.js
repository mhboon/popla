import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ matchdayId: ctx.args.matchdayId }),
  };
}

export function response(ctx) {
  return ctx.result;
}
