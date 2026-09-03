// International phone numbers, digits only, no leading '+' — matches
// infra/lambda/shared/phone.ts's PHONE_REGEX exactly (kept in sync by
// hand; there's no shared package between infra/ and web/).
export const PHONE_PATTERN = '[1-9][0-9]{6,14}';
export const PHONE_HINT = 'International number, no leading +, e.g. 31612345678.';
