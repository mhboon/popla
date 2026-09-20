import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ matchdayId: ctx.args.matchdayId }),
  };
}

// See Query.listMatchdaysBySeason.js for why this default is needed —
// same missing-attribute-on-legacy-rows issue.
export function response(ctx) {
  if (!ctx.result) return null;
  return { ...ctx.result, selfRegistrationEnabled: ctx.result.selfRegistrationEnabled ?? false };
}
