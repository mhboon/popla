import { randomInt } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

const OTP_CHALLENGES_TABLE = process.env.OTP_CHALLENGES_TABLE!;

const CODE_VALIDITY_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
// Keep the row around a bit past the rate window, for debugging —
// DynamoDB TTL deletion isn't instant anyway.
const TTL_BUFFER_S = 2 * 60 * 60;

interface CreateAuthChallengeEvent {
  userName: string;
  request: { userNotFound?: boolean; session: Array<{ challengeName?: string }> };
  response: {
    publicChallengeParameters?: Record<string, string>;
    privateChallengeParameters?: Record<string, string>;
  };
}

interface OtpItem {
  code: string;
  expiresAt: number;
  windowStart: number;
  sendCount: number;
}

export const handler = async (event: CreateAuthChallengeEvent) => {
  event.response.publicChallengeParameters = {};

  if (event.request.userNotFound) {
    // Mask registration status (preventUserExistenceErrors) — never
    // touch DynamoDB or SNS for a number nobody registered. The value
    // here doesn't matter: verify-auth-challenge-response rejects
    // unconditionally for userNotFound, without reading it.
    event.response.privateChallengeParameters = { code: 'n/a' };
    return event;
  }

  const phone = event.userName;
  const now = Date.now();
  const isRetry = (event.request.session ?? []).length > 0;

  const { Item } = await ddb.send(
    new GetCommand({ TableName: OTP_CHALLENGES_TABLE, Key: { phone } })
  );
  const existing = Item as OtpItem | undefined;

  // Wrong-guess retry (Cognito re-issuing CUSTOM_CHALLENGE within the
  // same login attempt): don't generate or send anything new.
  // verify-auth-challenge-response checks DynamoDB directly, not
  // whatever's set below, so there's nothing meaningful to put here —
  // this exists only to satisfy the response shape.
  if (isRetry) {
    event.response.privateChallengeParameters = { code: 'n/a' };
    return event;
  }

  // A fresh send (first request, or "Resend code" — both are a brand
  // new InitiateAuth from the client, session === []).
  const windowActive = !!existing && now < existing.windowStart + RATE_WINDOW_MS;
  const sendCount = windowActive ? existing!.sendCount : 0;
  const windowStart = windowActive ? existing!.windowStart : now;

  if (sendCount >= MAX_SENDS_PER_WINDOW) {
    // At the daily cap — don't touch the stored item, so whatever code
    // is already live (from an earlier send today) keeps working until
    // its own expiry. No SMS goes out, and this looks identical to the
    // caller as any other "check your phone" response.
    event.response.privateChallengeParameters = { code: 'n/a' };
    return event;
  }

  const code = String(randomInt(100000, 1000000));
  const expiresAt = now + CODE_VALIDITY_MS;

  // Overwriting the item here is what makes a new SMS immediately
  // invalidate the previous one: verify-auth-challenge-response always
  // checks the current row for this phone, never a cached snapshot, so
  // an older code stops matching the instant this write lands —
  // regardless of its own 10-minute expiry, and regardless of whether
  // it came from a different tab/device.
  await ddb.send(
    new PutCommand({
      TableName: OTP_CHALLENGES_TABLE,
      Item: {
        phone,
        code,
        expiresAt,
        windowStart,
        sendCount: sendCount + 1,
        ttl: Math.floor(windowStart / 1000) + RATE_WINDOW_MS / 1000 + TTL_BUFFER_S,
      },
    })
  );

  event.response.privateChallengeParameters = { code: 'n/a' };

  await sns.send(
    new PublishCommand({
      // event.userName is stored digits-only, no leading '+' — see
      // infra/lambda/shared/phone.ts. SNS's Publish API requires true
      // E.164 (with the '+') to deliver.
      PhoneNumber: `+${phone}`,
      Message: `Your Popla Cup code is ${code}. It expires in 10 minutes.`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    })
  );

  return event;
};
