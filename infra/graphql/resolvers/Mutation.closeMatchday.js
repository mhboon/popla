export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: { arguments: ctx.args, identity: ctx.identity },
  };
}

export function response(ctx) {
  return ctx.result;
}
