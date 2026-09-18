export function request(ctx) {
  return { operation: 'Scan' };
}

export function response(ctx) {
  // isGuest isn't a stored attribute — see the Player.isGuest schema
  // comment. Computed here so it's available regardless of which fields
  // the caller selected (listPlayers vs. the phone-free listPlayerNames
  // selection, both against this same resolver).
  return ctx.result.items.map((item) => ({ ...item, isGuest: !item.phone }));
}
