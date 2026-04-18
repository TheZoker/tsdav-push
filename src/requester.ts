import {
  RawHttpRequest,
  RawHttpRequester,
  RawHttpResponse,
  TsdavLikeClient,
} from "./types.js";

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

function withTimeout(request: RawHttpRequest): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (!request.timeoutMs) {
    return {
      signal: request.signal,
      cleanup: () => {
        return;
      },
    };
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort();
  }, request.timeoutMs);

  if (!request.signal) {
    return {
      signal: timeoutController.signal,
      cleanup: () => {
        clearTimeout(timer);
      },
    };
  }

  if (request.signal.aborted) {
    timeoutController.abort();
  } else {
    request.signal.addEventListener("abort", () => timeoutController.abort(), {
      once: true,
    });
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timer);
    },
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
    async request(input: RawHttpRequest): Promise<RawHttpResponse> {
      const mergedHeaders = mergeHeaders(defaultHeaders, input.headers);
      const signalState = withTimeout(input);

      try {
        const response = await requestFetch(input.url, {
          ...(defaultRequestInit ?? {}),
          method: input.method,
          headers: mergedHeaders,
          body: input.body,
          signal: signalState.signal,
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          bodyText: await response.text(),
        };
      } finally {
        signalState.cleanup();
      }
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
