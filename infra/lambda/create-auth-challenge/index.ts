import { randomInt } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

const OTP_CHALLENGES_TABLE = process.env.OTP_CHALLENGES_TABLE!;

const CODE_VALIDITY_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
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
    // Mask registration status (preventUserExistenceErrors) — issue a
    // challenge but never touch DynamoDB or SNS for a number nobody
    // registered.
    event.response.privateChallengeParameters = {
      code: String(randomInt(100000, 1000000)),
      expiresAt: String(Date.now() + CODE_VALIDITY_MS),
    };
    return event;
  }

  const phone = event.userName;
  const now = Date.now();
  const isRetry = (event.request.session ?? []).length > 0;

  const { Item } = await ddb.send(
    new GetCommand({ TableName: OTP_CHALLENGES_TABLE, Key: { phone } })
  );
  const existing = Item as OtpItem | undefined;

  // A wrong guess re-invokes this Lambda (Cognito re-issues the same
  // CUSTOM_CHALLENGE) — reuse the code already sent rather than
  // silently invalidating it and spending another SMS underneath the
  // user while they're still typing the first one.
  if (isRetry && existing && now < existing.expiresAt) {
    event.response.privateChallengeParameters = {
      code: existing.code,
      expiresAt: String(existing.expiresAt),
    };
    return event;
  }

  const windowActive = !!existing && now < existing.windowStart + RATE_WINDOW_MS;
  const sendCount = windowActive ? existing!.sendCount : 0;
  const windowStart = windowActive ? existing!.windowStart : now;

  const code = String(randomInt(100000, 1000000));
  const expiresAt = now + CODE_VALIDITY_MS;

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

  event.response.privateChallengeParameters = { code, expiresAt: String(expiresAt) };

  // Cap real SMS sends per rolling window, per phone number — the actual
  // protection against someone hammering "send code" for a real
  // person's number (harassment + cost), not just an account-wide spend
  // limit. Masked the same way userNotFound is: still generate/store a
  // code so the caller sees identical behavior whether or not the cap
  // was hit.
  if (sendCount < MAX_SENDS_PER_WINDOW) {
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
  }

  return event;
};
