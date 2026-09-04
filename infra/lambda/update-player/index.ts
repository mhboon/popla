import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { PHONE_REGEX, PHONE_FORMAT_ERROR } from '../shared/phone';
import { randomUnusedPassword } from '../shared/cognito';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const EDITABLE_FIELDS = ['displayName', 'phone', 'email'] as const;

interface UpdatePlayerArgs {
  playerId: string;
  displayName?: string;
  phone?: string | null;
  email?: string | null;
}

export const handler = async (event: { arguments: UpdatePlayerArgs }) => {
  const { playerId, phone } = event.arguments;
  const fields = event.arguments as unknown as Record<string, unknown>;

  const { Item: existing } = await ddb.send(
    new GetCommand({ TableName: PLAYERS_TABLE, Key: { playerId } })
  );
  if (!existing) {
    throw new Error(`Player ${playerId} not found`);
  }

  if (phone !== undefined && phone !== null && !PHONE_REGEX.test(phone)) {
    throw new Error(PHONE_FORMAT_ERROR);
  }

  const phoneChanging =
    phone !== undefined && (phone ?? null) !== (existing.phone ?? null);

  // undefined = leave cognitoSub as-is; null = clear it; string = new sub.
  let newCognitoSub: string | null | undefined;

  if (phoneChanging) {
    // Renumbering (or clearing) an admin's phone via this UI would
    // silently strip their Admins-group membership, since deleting the
    // old Cognito user (below) doesn't carry group membership over to a
    // recreated one — see ARCHITECTURE.md's Auth section. Block it here
    // (the real guard) regardless of whether the UI also disables the
    // field.
    if (existing.cognitoSub) {
      const { Groups } = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: existing.phone,
        })
      );
      if (Groups?.some((g) => g.GroupName === 'Admins')) {
        throw new Error(
          'Cannot change phone number for an admin. Remove admin status first, or use the AWS console.'
        );
      }
    }

    // Create the new Cognito user (if any) *before* deleting the old
    // one, so a duplicate-phone collision leaves the player's existing
    // login completely untouched instead of stranded with neither.
    if (phone === null) {
      newCognitoSub = null;
    } else {
      try {
        const { User } = await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: phone,
            MessageAction: 'SUPPRESS',
          })
        );
        newCognitoSub = User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;
        await cognito.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: USER_POOL_ID,
            Username: phone,
            Password: randomUnusedPassword(),
            Permanent: true,
          })
        );
      } catch (err) {
        if (err instanceof UsernameExistsException) {
          throw new Error('This phone number is already registered to another participant.', {
            cause: err,
          });
        }
        throw err;
      }
    }

    if (existing.cognitoSub) {
      await cognito.send(
        new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: existing.phone })
      );
    }
  }

  const setClauses: string[] = [];
  const removeClauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (fields[field] === undefined) continue;
    if (fields[field] === null) {
      removeClauses.push(`#${field}`);
      names[`#${field}`] = field;
    } else {
      setClauses.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = fields[field];
    }
  }
  if (newCognitoSub !== undefined) {
    names['#cognitoSub'] = 'cognitoSub';
    if (newCognitoSub === null) {
      removeClauses.push('#cognitoSub');
    } else {
      setClauses.push('#cognitoSub = :cognitoSub');
      values[':cognitoSub'] = newCognitoSub;
    }
  }

  if (setClauses.length === 0 && removeClauses.length === 0) {
    throw new Error('At least one field must be provided to update');
  }

  const updateExpression = [
    setClauses.length ? `SET ${setClauses.join(', ')}` : '',
    removeClauses.length ? `REMOVE ${removeClauses.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS_TABLE,
      Key: { playerId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
      ReturnValues: 'ALL_NEW',
    })
  );

  return Attributes;
};
