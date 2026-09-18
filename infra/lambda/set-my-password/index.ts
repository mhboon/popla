import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;

interface SetMyPasswordArgs {
  newPassword: string;
}

// Self-service only: the target Username is always the caller's own (from
// the AppSync Cognito identity, never an argument), so this can be — and
// is — open to any authenticated user without letting anyone set someone
// else's password. Reachable only after a successful CUSTOM_AUTH (OTP)
// sign-in, which is what actually proves phone ownership; this mutation
// itself does no additional verification. See ARCHITECTURE.md's Auth
// section.
export const handler = async (event: {
  arguments: SetMyPasswordArgs;
  identity?: { username?: string };
}) => {
  const username = event.identity?.username;
  if (!username) {
    throw new Error('Not authenticated.');
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: event.arguments.newPassword,
      Permanent: true,
    })
  );

  return true;
};
