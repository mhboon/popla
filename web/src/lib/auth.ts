import {
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';
import { config } from './config';

const userPool = new CognitoUserPool({
  UserPoolId: config.userPoolId,
  ClientId: config.userPoolClientId,
});

export type LoginResult =
  | { type: 'success'; session: CognitoUserSession }
  | { type: 'newPasswordRequired'; completeNewPassword: (newPassword: string) => Promise<CognitoUserSession> };

/**
 * Admins are created via `aws cognito-idp admin-create-user`, which sets a
 * temporary password requiring change on first sign-in — the
 * newPasswordRequired branch handles that one-time flow.
 */
export function login(username: string, password: string): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ type: 'success', session }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        resolve({
          type: 'newPasswordRequired',
          completeNewPassword: (newPassword: string) =>
            new Promise((res, rej) => {
              cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: (session) => res(session),
                onFailure: (err) => rej(err),
              });
            }),
        });
      },
    });
  });
}

export function logout(): void {
  userPool.getCurrentUser()?.signOut();
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve, reject) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      resolve(null);
      return;
    }
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) reject(err);
      else resolve(session);
    });
  });
}

export interface AuthenticatedUser {
  username: string;
  idToken: string;
  isAdmin: boolean;
}

export function toAuthenticatedUser(session: CognitoUserSession): AuthenticatedUser {
  const idToken = session.getIdToken();
  const groups = (idToken.payload['cognito:groups'] as string[] | undefined) ?? [];
  return {
    username: idToken.payload['cognito:username'] as string,
    idToken: idToken.getJwtToken(),
    isAdmin: groups.includes('Admins'),
  };
}
