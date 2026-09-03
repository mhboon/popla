import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface PromoteAdminArgs {
  playerId: string;
}

export const handler = async (event: { arguments: PromoteAdminArgs }) => {
  const { playerId } = event.arguments;

  const { Item: player } = await ddb.send(
    new GetCommand({ TableName: PLAYERS_TABLE, Key: { playerId } })
  );
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }
  if (!player.cognitoSub) {
    throw new Error(
      'This participant needs a phone number registered (login enabled) before they can become an admin.'
    );
  }

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: player.phone,
      GroupName: 'Admins',
    })
  );

  return true;
};
