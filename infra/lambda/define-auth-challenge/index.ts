// Cognito CUSTOM_AUTH DefineAuthChallenge trigger — decides what happens
// next in the challenge/response dance for every login (admin and
// participant alike, see ARCHITECTURE.md's Auth section). No DynamoDB
// access needed; state travels via Cognito's own challenge session.

const MAX_ATTEMPTS = 3;

interface Session {
  challengeName?: string;
  challengeResult?: boolean;
}

interface DefineAuthChallengeEvent {
  request: {
    userNotFound?: boolean;
    session: Session[];
  };
  response: {
    issueTokens?: boolean;
    failAuthentication?: boolean;
    challengeName?: string;
  };
}

export const handler = async (event: DefineAuthChallengeEvent) => {
  const session = event.request.session ?? [];

  if (session.length >= MAX_ATTEMPTS) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }

  // Deliberately no userNotFound fast-fail here (see
  // preventUserExistenceErrors on the User Pool Client): an unregistered
  // phone number goes through the exact same challenge-issuing shape as
  // a real one — verify-auth-challenge-response always answers false for
  // it, so this just runs out the same MAX_ATTEMPTS clock as a genuine
  // wrong code, rather than failing instantly and revealing that the
  // number isn't registered.
  const last = session[session.length - 1];
  if (last?.challengeName === 'CUSTOM_CHALLENGE' && last.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = 'CUSTOM_CHALLENGE';
  return event;
};
