import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// E.164: leading +, country code, up to 15 digits total.
const E164 = /^\+[1-9]\d{6,14}$/;

interface CreatePlayerArgs {
  displayName: string;
  phone?: string | null;
  email?: string | null;
}

export const handler = async (event: { arguments: CreatePlayerArgs }) => {
  const { displayName, phone, email } = event.arguments;

  if (!displayName.trim()) {
    throw new Error('displayName must not be empty');
  }
  if (phone && !E164.test(phone)) {
    throw new Error('phone must be in E.164 format, e.g. +31612345678');
  }

  let cognitoSub: string | undefined;
  if (phone) {
    // Cognito Username = the phone number itself, not an alias — see
    // ARCHITECTURE.md's Auth section for why. MessageAction: SUPPRESS
    // means Cognito never sends its own message; only our OTP SMS
    // (create-auth-challenge) is ever sent to this number.
    try {
      const { User } = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: phone,
          MessageAction: 'SUPPRESS',
        })
      );
      cognitoSub = User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        throw new Error('This phone number is already registered to another participant.', {
          cause: err,
        });
      }
      throw err;
    }
  }

  const player = {
    playerId: randomUUID(),
    displayName,
    phone: phone ?? undefined,
    email: email ?? undefined,
    cognitoSub,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: PLAYERS_TABLE, Item: player }));

  return player;
};
