import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomTemporaryPassword } from '../shared/cognito';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface ResetParticipantPasswordArgs {
  playerId: string;
}

export const handler = async (event: { arguments: ResetParticipantPasswordArgs }) => {
  // Defense in depth: refuses even if this mutation is invoked directly
  // while the feature is off, not just hidden from the UI — see
  // ARCHITECTURE.md's Auth section.
  if (process.env.FEATURE_ADMIN_PASSWORD_RESET !== 'true') {
    throw new Error('Admin password reset is not enabled.');
  }

  const { playerId } = event.arguments;

  const { Item: player } = await ddb.send(
    new GetCommand({ TableName: PLAYERS_TABLE, Key: { playerId } })
  );
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }
  if (!player.cognitoSub) {
    throw new Error('This participant does not have login enabled.');
  }

  const temporaryPassword = randomTemporaryPassword();

  // Permanent: false — unlike every other AdminSetUserPassword call in
  // this codebase — is what puts the user in FORCE_CHANGE_PASSWORD, which
  // the frontend's newPasswordRequired flow already handles.
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: player.phone,
      Password: temporaryPassword,
      Permanent: false,
    })
  );

  return temporaryPassword;
};
