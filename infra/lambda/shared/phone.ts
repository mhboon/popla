// International phone numbers, digits only, no leading '+' (e.g.
// 31612345678, not +31612345678) — this is the format participants type
// in, the format stored in Players.phone, and the format used as the
// Cognito Username (see ARCHITECTURE.md's Auth section). SNS's Publish
// API requires true E.164 (with the '+') to actually deliver an SMS, so
// create-auth-challenge prepends it there — nowhere else needs to.
export const PHONE_REGEX = /^[1-9]\d{6,14}$/;
export const PHONE_FORMAT_ERROR =
  'phone must be an international number without a leading +, digits only, e.g. 31612345678';
