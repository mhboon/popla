import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const PLAYERS_TABLE = process.env.PLAYERS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface DemoteAdminArgs {
  playerId: string;
}

export const handler = async (event: {
  arguments: DemoteAdminArgs;
  identity?: { username?: string };
}) => {
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

  // Cognito Username == phone number by construction (see
  // ARCHITECTURE.md's Auth section), so comparing the caller's own
  // Username against the target player's phone identifies self-demotion
  // without an extra lookup.
  if (event.identity?.username && event.identity.username === player.phone) {
    throw new Error(
      "You can't remove your own admin status. Ask another admin, or use the AWS console."
    );
  }

  await cognito.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: player.phone,
      GroupName: 'Admins',
    })
  );

  return true;
};
