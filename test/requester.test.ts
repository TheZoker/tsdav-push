import { describe, expect, it, vi } from "vitest";

import {
  createFetchRequester,
  createTsdavRequester,
} from "../src/requester.js";

describe("createFetchRequester", () => {
  it("merges default and request headers", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => response);

    const requester = createFetchRequester({
      fetch: fetchMock as unknown as typeof fetch,
      defaultHeaders: {
        authorization: "Basic token",
      },
    });

    await requester.request({
      url: "https://example.com/dav",
      method: "OPTIONS",
      headers: {
        depth: "0",
      },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("OPTIONS");
    expect(init.headers).toEqual({
      authorization: "Basic token",
      depth: "0",
    });
  });

  it("keeps explicit method/body over defaults", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => response);

    const requester = createFetchRequester({
      fetch: fetchMock as unknown as typeof fetch,
      defaultRequestInit: {
        method: "GET",
        body: "default-body",
      },
    });

    await requester.request({
      url: "https://example.com/dav",
      method: "POST",
      body: "payload",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("payload");
  });

  it("forwards abort signal and timeout", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => response);

    const requester = createFetchRequester({
      fetch: fetchMock as unknown as typeof fetch,
    });

    const controller = new AbortController();

    await requester.request({
      url: "https://example.com/dav",
      method: "OPTIONS",
      signal: controller.signal,
      timeoutMs: 500,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeDefined();
  });
});

describe("createTsdavRequester", () => {
  it("uses tsdav auth headers and fetch options", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => response);

    const requester = createTsdavRequester({
      fetchOverride: fetchMock as unknown as typeof fetch,
      authHeaders: {
        authorization: "Bearer abc",
      },
      fetchOptions: {
        cache: "no-store",
      },
    });

    await requester.request({
      url: "https://example.com/dav",
      method: "OPTIONS",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ authorization: "Bearer abc" });
    expect(init.cache).toBe("no-store");
  });
});
