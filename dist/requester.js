const REQUIRED_FETCH_ERROR = "No fetch implementation available. Pass one explicitly or provide a global fetch.";
function getFetchOrThrow(fetchFn) {
    const resolved = fetchFn ?? globalThis.fetch;
    if (!resolved) {
        throw new Error(REQUIRED_FETCH_ERROR);
    }
    return resolved;
}
function mergeHeaders(first, second) {
    return {
        ...(first ?? {}),
        ...(second ?? {}),
    };
}
function withTimeout(request) {
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
    }
    else {
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
export function createFetchRequester(options) {
    const requestFetch = getFetchOrThrow(options?.fetch);
    const defaultHeaders = options?.defaultHeaders;
    const defaultRequestInit = options?.defaultRequestInit;
    return {
        async request(input) {
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
            }
            finally {
                signalState.cleanup();
            }
        },
    };
}
export function createTsdavRequester(client) {
    return createFetchRequester({
        fetch: client.fetchOverride,
        defaultHeaders: client.authHeaders,
        defaultRequestInit: client.fetchOptions,
    });
}
