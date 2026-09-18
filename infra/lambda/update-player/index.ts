import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { PHONE_REGEX, PHONE_FORMAT_ERROR } from '../shared/phone';
import { randomUnusedPassword } from '../shared/cognito';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const EDITABLE_FIELDS = ['displayName', 'phone'] as const;

interface UpdatePlayerArgs {
  playerId: string;
  displayName?: string;
  phone?: string | null;
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
    // Renumbering (or clearing) an admin's phone deletes their old
    // Cognito user below, which doesn't carry Admins-group membership
    // over to a freshly created one — see ARCHITECTURE.md's Auth
    // section. Capture it here so it can be restored on the new user
    // once created, rather than silently dropping admin status.
    let wasAdmin = false;
    if (existing.cognitoSub) {
      const { Groups } = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: existing.phone,
        })
      );
      wasAdmin = Groups?.some((g) => g.GroupName === 'Admins') ?? false;
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
        // Done before the old user is deleted below, so there's never a
        // moment where neither Cognito user holds Admins membership.
        if (wasAdmin) {
          await cognito.send(
            new AdminAddUserToGroupCommand({
              UserPoolId: USER_POOL_ID,
              Username: phone,
              GroupName: 'Admins',
            })
          );
        }
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
