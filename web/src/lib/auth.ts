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

export type LoginResult =
  | { type: 'success'; session: CognitoUserSession }
  // Reachable when an admin issues a non-permanent temporary password via
  // `aws cognito-idp admin-set-user-password` (no `--permanent`) from the
  // AWS console/CLI — a manual reset path for when OTP delivery isn't an
  // option. Cognito puts the user in FORCE_CHANGE_PASSWORD and rejects
  // the temp password for anything but completing this challenge; doing
  // so both signs the user in and sets it as their new real password —
  // no separate setMyPassword call needed. See ARCHITECTURE.md's Auth
  // section.
  | { type: 'newPasswordRequired'; completeNewPassword: (newPassword: string) => Promise<CognitoUserSession> };

/**
 * Username+password login (USER_SRP_AUTH) — the default, faster-return-
 * visit path once a password has been set. Two ways to get one: OTP sign-
 * in + setMyPassword (self-service), or an admin issuing a temporary
 * password via the AWS console/CLI (manual reset) — the latter surfaces
 * as the 'newPasswordRequired' branch below. OTP (requestOtp above)
 * remains the only way to actually prove phone ownership in the
 * self-service case.
 */
export function login(username: string, password: string): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ type: 'success', session }),
      onFailure: reject,
      newPasswordRequired: (userAttributes) => {
        // Cognito includes read-only attributes (e.g. phone_number_verified)
        // in userAttributes that completeNewPasswordChallenge then rejects
        // if echoed back — strip them rather than trying to keep an
        // allowlist in sync with the pool's schema.
        delete userAttributes.email_verified;
        delete userAttributes.phone_number_verified;
        resolve({
          type: 'newPasswordRequired',
          completeNewPassword: (newPassword) =>
            new Promise((resolveChallenge, rejectChallenge) => {
              cognitoUser.completeNewPasswordChallenge(newPassword, userAttributes, {
                onSuccess: resolveChallenge,
                onFailure: rejectChallenge,
              });
            }),
        });
      },
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
