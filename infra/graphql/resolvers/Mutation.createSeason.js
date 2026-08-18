import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const seasonId = util.autoId();
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ seasonId }),
    attributeValues: util.dynamodb.toMapValues({
      name: ctx.args.name,
      startDate: ctx.args.startDate,
      status: 'ACTIVE',
    }),
  };
}

export function response(ctx) {
  return ctx.result;
}
