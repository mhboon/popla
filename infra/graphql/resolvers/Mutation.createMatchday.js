import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { seasonId, date, startTime, format, participantIds, selfRegistrationEnabled, maxParticipants } =
    ctx.args;

  if (maxParticipants !== undefined && maxParticipants !== null && maxParticipants <= 0) {
    util.error('maxParticipants must be a positive number', 'ValidationError');
  }

  const matchdayId = util.autoId();
  ctx.stash.matchdayId = matchdayId;

  const matchdayItem = { seasonId, date, format, status: 'SETUP', selfRegistrationEnabled };
  if (startTime !== undefined && startTime !== null) {
    matchdayItem.startTime = startTime;
  }
  if (maxParticipants !== undefined && maxParticipants !== null) {
    matchdayItem.maxParticipants = maxParticipants;
    matchdayItem.joinedCount = participantIds.length;
  }

  const now = util.time.nowISO8601();
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
      attributeValues: util.dynamodb.toMapValues({ status: 'JOINING', updatedAt: now }),
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
    selfRegistrationEnabled: ctx.args.selfRegistrationEnabled,
    maxParticipants: ctx.args.maxParticipants ?? null,
  };
}
