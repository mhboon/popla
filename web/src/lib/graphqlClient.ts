import { config } from './config';

export class GraphQLError extends Error {
  constructor(message: string, public readonly errors: unknown[]) {
    super(message);
  }
}

export async function graphqlRequest<T>(
  idToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(config.appsyncUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: idToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (body.errors?.length) {
    throw new GraphQLError(body.errors[0].message ?? 'GraphQL request failed', body.errors);
  }

  return body.data as T;
}
