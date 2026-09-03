import { randomInt } from 'crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

const CODE_VALIDITY_MS = 10 * 60 * 1000;

interface CreateAuthChallengeEvent {
  userName: string;
  request: { userNotFound?: boolean };
  response: {
    publicChallengeParameters?: Record<string, string>;
    privateChallengeParameters?: Record<string, string>;
  };
}

export const handler = async (event: CreateAuthChallengeEvent) => {
  const code = String(randomInt(100000, 1000000));
  const expiresAt = Date.now() + CODE_VALIDITY_MS;

  event.response.publicChallengeParameters = {};
  // Private parameters never round-trip to the client — only
  // verify-auth-challenge-response ever sees these.
  event.response.privateChallengeParameters = { code, expiresAt: String(expiresAt) };

  // Mask whether this phone number is actually registered (see
  // preventUserExistenceErrors on the User Pool Client) — don't send a
  // real SMS, or spend money, for an unrecognized number.
  if (!event.request.userNotFound) {
    // event.userName (the Cognito Username) is stored digits-only, no
    // leading '+' — see infra/lambda/shared/phone.ts. SNS's Publish API
    // requires actual E.164 (with the '+') to deliver, so it's added
    // here only, right before the one call that needs it.
    await sns.send(
      new PublishCommand({
        PhoneNumber: `+${event.userName}`,
        Message: `Your Popla Cup code is ${code}. It expires in 10 minutes.`,
      })
    );
  }

  return event;
};
