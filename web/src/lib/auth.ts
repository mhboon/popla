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

/**
 * Username+password login (USER_SRP_AUTH) — the default, faster-return-
 * visit path once a password has been set via setMyPassword. OTP
 * (requestOtp above) remains the only way to actually prove phone
 * ownership; every Cognito user in this pool that has a real password at
 * all got it via setMyPassword's AdminSetUserPassword(..., Permanent:
 * true), which never leaves FORCE_CHANGE_PASSWORD behind — so
 * newPasswordRequired is not a reachable state here, only defended
 * against so a mismatched account state fails loudly instead of hanging.
 * See ARCHITECTURE.md's Auth section.
 */
export function login(username: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: resolve,
      onFailure: reject,
      newPasswordRequired: () =>
        reject(new Error('This account needs a password set — sign in with a code first.')),
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

/**
 * Change the signed-in user's own password, given their current one.
 * Cognito's ChangePassword API verifies oldPassword itself (rejects with
 * NotAuthorizedException if it's wrong) — no backend call needed, unlike
 * setMyPassword above, which exists precisely because there's no old
 * password to check in the OTP-triggered set/reset case.
 */
export function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      reject(new Error('Not signed in.'));
      return;
    }
    // changePassword relies on the user's session internally; getSession
    // makes sure one's loaded (and transparently refreshed if stale)
    // before calling it, same as getCurrentSession elsewhere in this file.
    cognitoUser.getSession((err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }
      cognitoUser.changePassword(oldPassword, newPassword, (err) => {
        if (err) reject(err);
        else resolve();
      });
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
