import { util } from '@aws-appsync/utils';

// Cognito Username == the caller's phone number, by construction (see
// ARCHITECTURE.md's Auth section), so this GSI query is the whole lookup —
// no separate identity table needed.
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'byPhone',
    query: {
      expression: 'phone = :phone',
      expressionValues: util.dynamodb.toMapValues({
        ':phone': ctx.identity.username,
      }),
    },
  };
}

export function response(ctx) {
  const item = ctx.result.items[0];
  return item ? { ...item, isGuest: !item.phone } : null;
}
