export function request(ctx) {
  return { operation: 'Scan' };
}

export function response(ctx) {
  return ctx.result.items.map((item) => ({ ...item, isGuest: !item.phone }));
}
