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

export type SubmitCodeResult =
  | { type: 'success'; session: CognitoUserSession }
  | { type: 'incorrect'; submitCode: (code: string) => Promise<SubmitCodeResult> };

export type OtpResult = {
  type: 'codeRequired';
  submitCode: (code: string) => Promise<SubmitCodeResult>;
};

/**
 * Passwordless login, for everyone — admin and participant alike, see
 * ARCHITECTURE.md's Auth section — via Cognito's CUSTOM_AUTH flow:
 * phone number in, an SMS code goes out, submitCode verifies it. A wrong
 * code (under the trigger Lambdas' attempt cap) re-issues another
 * challenge rather than failing outright, hence the recursive
 * `submitCode` on the 'incorrect' branch rather than a rejected promise.
 */
export function requestOtp(phone: string): Promise<OtpResult> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: phone, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: phone });
    cognitoUser.initiateAuth(authDetails, {
      customChallenge: () =>
        resolve({
          type: 'codeRequired',
          submitCode: (code) => answerChallenge(cognitoUser, code),
        }),
      onSuccess: () => reject(new Error('Unexpected: signed in before a code was requested')),
      onFailure: reject,
    });
  });
}

function answerChallenge(cognitoUser: CognitoUser, code: string): Promise<SubmitCodeResult> {
  return new Promise((resolve, reject) => {
    cognitoUser.sendCustomChallengeAnswer(code, {
      onSuccess: (session) => resolve({ type: 'success', session }),
      onFailure: reject,
      customChallenge: () =>
        resolve({
          type: 'incorrect',
          submitCode: (nextCode) => answerChallenge(cognitoUser, nextCode),
        }),
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
