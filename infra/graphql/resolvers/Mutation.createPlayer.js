import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const playerId = util.autoId();
  ctx.stash.newItem = {
    playerId,
    displayName: ctx.args.displayName,
    email: ctx.args.email,
    createdAt: util.time.nowISO8601(),
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ playerId }),
    attributeValues: util.dynamodb.toMapValues(ctx.stash.newItem),
  };
}

export function response(ctx) {
  return ctx.result;
}
