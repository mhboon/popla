interface VerifyAuthChallengeResponseEvent {
  request: {
    userNotFound?: boolean;
    privateChallengeParameters: { code: string; expiresAt: string };
    challengeAnswer: string;
  };
  response: { answerCorrect?: boolean };
}

export const handler = async (event: VerifyAuthChallengeResponseEvent) => {
  if (event.request.userNotFound) {
    event.response.answerCorrect = false;
    return event;
  }

  const { code, expiresAt } = event.request.privateChallengeParameters;
  event.response.answerCorrect =
    event.request.challengeAnswer === code && Date.now() < Number(expiresAt);

  return event;
};
