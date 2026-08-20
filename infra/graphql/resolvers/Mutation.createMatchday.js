import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { seasonId, date, startTime, format, participantIds } = ctx.args;

  if (participantIds.length === 0 || participantIds.length % 4 !== 0) {
    util.error(
      'participantIds must be a non-zero multiple of 4',
      'ValidationError'
    );
  }

  const matchdayId = util.autoId();
  ctx.stash.matchdayId = matchdayId;

  const matchdayItem = { seasonId, date, format, status: 'SETUP' };
  if (startTime !== undefined && startTime !== null) {
    matchdayItem.startTime = startTime;
  }

  const transactItems = [
    {
      table: 'PoplaMatchdays',
      operation: 'PutItem',
      key: util.dynamodb.toMapValues({ matchdayId }),
      attributeValues: util.dynamodb.toMapValues(matchdayItem),
    },
    ...participantIds.map((playerId) => ({
      table: 'PoplaMatchdayParticipants',
      operation: 'PutItem',
      key: util.dynamodb.toMapValues({ matchdayId, playerId }),
      attributeValues: util.dynamodb.toMapValues({}),
    })),
  ];

  return { operation: 'TransactWriteItems', transactItems };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return {
    matchdayId: ctx.stash.matchdayId,
    seasonId: ctx.args.seasonId,
    date: ctx.args.date,
    startTime: ctx.args.startTime ?? null,
    format: ctx.args.format,
    status: 'SETUP',
  };
}
