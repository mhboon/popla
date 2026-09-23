import { randomInt, randomUUID } from 'crypto';

// Cognito requires a password even though this app never uses one —
// login is passwordless CUSTOM_AUTH only, no password auth flow is
// enabled on the User Pool Client (see ARCHITECTURE.md's Auth section).
// AdminSetUserPassword with Permanent: true moves a freshly created user
// out of FORCE_CHANGE_PASSWORD, which custom-auth logins otherwise get
// stuck behind. The value is discarded immediately after use — nothing
// can ever actually authenticate with it.
export function randomUnusedPassword(): string {
  return `${randomUUID()}Aa1!`;
}

// Unlike randomUnusedPassword above, this one is actually handed to a
// person and typed in on a phone — short, meets Cognito's default policy
// (8+ chars, upper/lower/digit/symbol), and easy to read back over a
// text message or in person.
export function randomTemporaryPassword(): string {
  return `Cup${randomInt(1000, 10000)}!`;
}
