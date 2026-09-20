import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MATCHDAYS_TABLE = process.env.MATCHDAYS_TABLE!;
const PARTICIPANTS_TABLE = process.env.MATCHDAY_PARTICIPANTS_TABLE!;

interface UpdateMatchdayArgs {
  matchdayId: string;
  date?: string;
  startTime?: string;
  format?: 'MEXICANO' | 'AMERICANO';
  selfRegistrationEnabled?: boolean;
  maxParticipants?: number | null;
}

// Roster changes (add/remove participants) go exclusively through
// setMatchdayJoining now — this only ever touches the Matchdays item
// itself (date/startTime/format/selfRegistrationEnabled/maxParticipants),
// so a plain UpdateCommand is enough; no transaction needed.
export const handler = async (event: { arguments: UpdateMatchdayArgs }) => {
  const { matchdayId, date, startTime, format, selfRegistrationEnabled, maxParticipants } =
    event.arguments;

  const { Item: matchday } = await ddb.send(
    new GetCommand({ TableName: MATCHDAYS_TABLE, Key: { matchdayId } })
  );
  if (!matchday) {
    throw new Error(`Matchday ${matchdayId} not found`);
  }
  if (matchday.status !== 'SETUP') {
    throw new Error(
      'Matchday can only be edited while it is still in SETUP (before round 1 has been generated)'
    );
  }

  const setClauses: string[] = [];
  const removeClauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  if (date !== undefined) {
    setClauses.push('#date = :date');
    names['#date'] = 'date';
    values[':date'] = date;
  }
  if (startTime !== undefined) {
    setClauses.push('#startTime = :startTime');
    names['#startTime'] = 'startTime';
    values[':startTime'] = startTime;
  }
  if (format !== undefined) {
    setClauses.push('#format = :format');
    names['#format'] = 'format';
    values[':format'] = format;
  }
  if (selfRegistrationEnabled !== undefined) {
    setClauses.push('#selfRegistrationEnabled = :selfRegistrationEnabled');
    names['#selfRegistrationEnabled'] = 'selfRegistrationEnabled';
    values[':selfRegistrationEnabled'] = selfRegistrationEnabled;
  }

  if (maxParticipants !== undefined) {
    names['#maxParticipants'] = 'maxParticipants';
    names['#joinedCount'] = 'joinedCount';
    if (maxParticipants === null) {
      removeClauses.push('#maxParticipants', '#joinedCount');
    } else {
      if (maxParticipants <= 0) {
        throw new Error('maxParticipants must be a positive number');
      }
      // joinedCount is recomputed here (not just the new cap written)
      // because this is also how a cap gets *added* to a matchday that
      // started uncapped — the counter set-matchday-joining maintains
      // needs an accurate starting point either way.
      const { Items: participants } = await ddb.send(
        new QueryCommand({
          TableName: PARTICIPANTS_TABLE,
          KeyConditionExpression: 'matchdayId = :matchdayId',
          ExpressionAttributeValues: { ':matchdayId': matchdayId },
        })
      );
      const joiningCount = (participants ?? []).filter(
        (p) => (p.status ?? 'JOINING') === 'JOINING'
      ).length;
      if (maxParticipants < joiningCount) {
        throw new Error(
          `maxParticipants can't be set below the current registered count (${joiningCount})`
        );
      }
      setClauses.push('#maxParticipants = :maxParticipants', '#joinedCount = :joinedCount');
      values[':maxParticipants'] = maxParticipants;
      values[':joinedCount'] = joiningCount;
    }
  }

  if (setClauses.length > 0 || removeClauses.length > 0) {
    const expressionParts = [
      setClauses.length > 0 ? `SET ${setClauses.join(', ')}` : null,
      removeClauses.length > 0 ? `REMOVE ${removeClauses.join(', ')}` : null,
    ].filter((part): part is string => part !== null);

    await ddb.send(
      new UpdateCommand({
        TableName: MATCHDAYS_TABLE,
        Key: { matchdayId },
        UpdateExpression: expressionParts.join(' '),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
      })
    );
  }

  return {
    ...matchday,
    date: date ?? matchday.date,
    startTime: startTime ?? matchday.startTime,
    format: format ?? matchday.format,
    // matchday.selfRegistrationEnabled is undefined for a matchday that
    // pre-dates this field — default false (see Query.getMatchday.js).
    selfRegistrationEnabled: selfRegistrationEnabled ?? matchday.selfRegistrationEnabled ?? false,
    maxParticipants: maxParticipants !== undefined ? maxParticipants : matchday.maxParticipants,
  };
};
