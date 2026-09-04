import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const OTP_CHALLENGES_TABLE = process.env.OTP_CHALLENGES_TABLE!;

interface VerifyAuthChallengeResponseEvent {
  userName: string;
  request: {
    userNotFound?: boolean;
    challengeAnswer: string;
  };
  response: { answerCorrect?: boolean };
}

interface OtpItem {
  code: string;
  expiresAt: number;
}

export const handler = async (event: VerifyAuthChallengeResponseEvent) => {
  if (event.request.userNotFound) {
    event.response.answerCorrect = false;
    return event;
  }

  // Deliberately reads the *current* row for this phone, rather than
  // trusting event.request.privateChallengeParameters (whatever
  // create-auth-challenge cached for this specific round) — the latter
  // would let a stale, already-superseded code stay valid until its own
  // 10-minute expiry even after a newer SMS was sent. Checking DynamoDB
  // fresh here is what makes "send a new code" immediately invalidate
  // any earlier one, from any device/tab (see
  // infra/lambda/create-auth-challenge/index.ts).
  const { Item } = await ddb.send(
    new GetCommand({ TableName: OTP_CHALLENGES_TABLE, Key: { phone: event.userName } })
  );
  const current = Item as OtpItem | undefined;

  event.response.answerCorrect =
    !!current &&
    event.request.challengeAnswer === current.code &&
    Date.now() < current.expiresAt;

  return event;
};
