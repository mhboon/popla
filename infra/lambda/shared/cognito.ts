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

// Character sets exclude visually-confusable characters (0/O, 1/I/l) —
// this is actually handed to a person and typed in on a phone, so it
// still needs to be readable back over a text message or in person, even
// though it's now a real random password rather than a small, guessable
// space (the old `Cup${4 digits}!` scheme had only ~9000 possibilities).
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';
const TEMPORARY_PASSWORD_LENGTH = 10;

function randomChar(charset: string): string {
  return charset[randomInt(charset.length)];
}

// Meets Cognito's default policy (8+ chars, upper/lower/digit/symbol) by
// construction: one required character from each class, the rest random
// from the combined set, then shuffled so the classes aren't positional.
export function randomTemporaryPassword(): string {
  const required = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS), randomChar(SYMBOLS)];
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const rest = Array.from({ length: TEMPORARY_PASSWORD_LENGTH - required.length }, () =>
    randomChar(all)
  );
  const chars = [...required, ...rest];
  // Fisher-Yates, using the same CSPRNG (crypto.randomInt) as the rest of
  // this file rather than Math.random.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
