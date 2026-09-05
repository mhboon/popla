import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { seasonId, date, startTime, format, maxParticipants } = ctx.args;

  if (maxParticipants <= 0) {
    util.error('maxParticipants must be a positive number', 'ValidationError');
  }

  const matchdayId = util.autoId();
  ctx.stash.matchdayId = matchdayId;

  const matchdayItem = {
    seasonId,
    date,
    format,
    status: 'REGISTRATION',
    maxParticipants,
    joinedCount: 0,
  };
  if (startTime !== undefined && startTime !== null) {
    matchdayItem.startTime = startTime;
  }

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ matchdayId }),
    attributeValues: util.dynamodb.toMapValues(matchdayItem),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
