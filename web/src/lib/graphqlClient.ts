import { config } from './config';
import { forceRefreshSession, getCurrentSession } from './auth';

export class GraphQLError extends Error {
  constructor(message: string, public readonly errors: unknown[]) {
    super(message);
  }
}

// The ID token lasts about an hour. The copy held in React state (and
// passed in here as `idToken`) is only replaced by AuthContext's
// background timer, which runs every few minutes and only *after* the
// token has already expired — and not at all while the tab is in the
// background or the phone is asleep. Sending that copy as-is meant a
// request could go out with an expired token ("Token has expired", fixed
// by reloading the page). So the token is looked up at the moment of
// each request instead: getCurrentSession returns the cached one while
// it's valid and silently fetches a new one once it isn't. The passed-in
// `idToken` is only the fallback if that lookup fails.
async function currentIdToken(fallback: string): Promise<string> {
  try {
    const session = await getCurrentSession();
    return session?.getIdToken().getJwtToken() ?? fallback;
  } catch {
    return fallback;
  }
}

function send(idToken: string, query: string, variables?: Record<string, unknown>) {
  return fetch(config.appsyncUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: idToken,
    },
    body: JSON.stringify({ query, variables }),
  });
}

export async function graphqlRequest<T>(
  idToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let response = await send(await currentIdToken(idToken), query, variables);

  // AppSync answers 401 when it rejects the token itself (expired, or
  // about to be by its clock rather than this device's) — as opposed to a
  // per-field "not allowed", which comes back as a 200 with errors. Get
  // new tokens regardless of what the local clock thinks and try once
  // more. AppSync rejects the token before running anything, so repeating
  // the request can't apply a mutation twice.
  if (response.status === 401) {
    const refreshed = await forceRefreshSession().catch(() => null);
    if (refreshed) {
      response = await send(refreshed.getIdToken().getJwtToken(), query, variables);
    }
  }

  const body = await response.json();

  if (body.errors?.length) {
    throw new GraphQLError(body.errors[0].message ?? 'GraphQL request failed', body.errors);
  }

  return body.data as T;
}
