import { util } from '@aws-appsync/utils';

const EDITABLE_FIELDS = ['displayName', 'phone', 'email'];

export function request(ctx) {
  const playerId = ctx.args.playerId;
  const fields = ctx.args;

  const setClauses = [];
  const expressionNames = {};
  const expressionValues = {};

  for (const field of EDITABLE_FIELDS) {
    if (fields[field] !== undefined) {
      setClauses.push(`#${field} = :${field}`);
      expressionNames[`#${field}`] = field;
      expressionValues[`:${field}`] = fields[field];
    }
  }

  if (setClauses.length === 0) {
    util.error('At least one field must be provided to update', 'ValidationError');
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ playerId }),
    update: {
      expression: `SET ${setClauses.join(', ')}`,
      expressionNames,
      expressionValues: util.dynamodb.toMapValues(expressionValues),
    },
    condition: {
      expression: 'attribute_exists(playerId)',
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
