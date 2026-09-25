import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: { arguments: ctx.args, identity: ctx.identity },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  // isGuest isn't a stored attribute — see Player.isGuest in
  // schema.graphql — so it has to be computed here too, same as
  // Query.listPlayers/getMyPlayer.
  return { ...ctx.result, isGuest: !ctx.result.phone };
}
