import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler = async () => {
  const usernames: string[] = [];
  let nextToken: string | undefined;

  do {
    const { Users, NextToken } = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: 'Admins',
        NextToken: nextToken,
      })
    );
    for (const user of Users ?? []) {
      if (user.Username) usernames.push(user.Username);
    }
    nextToken = NextToken;
  } while (nextToken);

  return usernames;
};
