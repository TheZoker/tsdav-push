import { RawHttpRequester, RawHttpResponse, TsdavLikeClient } from "./types.js";

const REQUIRED_FETCH_ERROR =
  "No fetch implementation available. Pass one explicitly or provide a global fetch.";

function getFetchOrThrow(fetchFn?: typeof fetch): typeof fetch {
  const resolved = fetchFn ?? globalThis.fetch;
  if (!resolved) {
    throw new Error(REQUIRED_FETCH_ERROR);
  }
  return resolved;
}

function mergeHeaders(
  first?: Record<string, string>,
  second?: Record<string, string>,
): Record<string, string> {
  return {
    ...(first ?? {}),
    ...(second ?? {}),
  };
}

export function createFetchRequester(options?: {
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  defaultRequestInit?: RequestInit;
}): RawHttpRequester {
  const requestFetch = getFetchOrThrow(options?.fetch);
  const defaultHeaders = options?.defaultHeaders;
  const defaultRequestInit = options?.defaultRequestInit;

  return {
    async request(input): Promise<RawHttpResponse> {
      const response = await requestFetch(input.url, {
        method: input.method,
        headers: mergeHeaders(defaultHeaders, input.headers),
        body: input.body,
        ...(defaultRequestInit ?? {}),
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: await response.text(),
      };
    },
  };
}

export function createTsdavRequester(
  client: TsdavLikeClient,
): RawHttpRequester {
  return createFetchRequester({
    fetch: client.fetchOverride,
    defaultHeaders: client.authHeaders,
    defaultRequestInit: client.fetchOptions,
  });
}
