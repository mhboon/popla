import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'bySeasonId',
    query: {
      expression: 'seasonId = :seasonId',
      expressionValues: util.dynamodb.toMapValues({
        ':seasonId': ctx.args.seasonId,
      }),
    },
    scanIndexForward: true,
  };
}

// selfRegistrationEnabled didn't exist before this field was added —
// every matchday created before then has no such attribute at all.
// Default it to false (equivalent to "admin-managed roster", which is
// what those matchdays effectively already were) rather than let the
// schema's non-null constraint fail the whole query.
export function response(ctx) {
  return ctx.result.items.map((item) => ({
    ...item,
    selfRegistrationEnabled: item.selfRegistrationEnabled ?? false,
  }));
}
