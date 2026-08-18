import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ seasonId: ctx.args.seasonId }),
  };
}

export function response(ctx) {
  return ctx.result;
}
