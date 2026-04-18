import { describe, expect, it, vi } from "vitest";

import { WebDavPushClient } from "../src/client.js";
import {
  HttpStatusError,
  ProtocolValidationError,
  TransportError,
  XmlParseError,
} from "../src/errors.js";
import { RawHttpRequester } from "../src/types.js";

function makeHeaders(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

describe("WebDavPushClient", () => {
  it("discovers capabilities via OPTIONS + PROPFIND", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: makeHeaders({ dav: "1, 2, webdav-push" }),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 207,
        statusText: "Multi-Status",
        headers: makeHeaders({}),
        bodyText: `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:p="https://bitfire.at/webdav-push">
  <d:response>
    <d:propstat>
      <d:prop>
        <p:transports>
          <p:web-push>
            <p:vapid-public-key type="p256ecdsa">PUBKEY</p:vapid-public-key>
          </p:web-push>
        </p:transports>
        <p:topic>topic-123</p:topic>
        <p:supported-triggers>
          <p:content-update><d:depth>1</d:depth></p:content-update>
          <p:property-update><d:depth>0</d:depth></p:property-update>
        </p:supported-triggers>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`,
      });

    const client = new WebDavPushClient({ request });

    const result = await client.discoverCapabilities("https://example.com/cal");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected discoverCapabilities success.");
    }

    expect(result.value.supportedByDavHeader).toBe(true);
    expect(result.value.topic).toBe("topic-123");
    expect(result.value.transports[0]?.id).toBe("web-push");
    expect(result.value.transports[0]?.vapidPublicKey?.value).toBe("PUBKEY");
    expect(result.value.webPush.hasVapidPublicKey).toBe(true);
    expect(result.value.supportedTriggers).toEqual([
      { type: "content-update", depth: "1" },
      { type: "property-update", depth: "0" },
    ]);
  });

  it("returns XML parse error for malformed discovery PROPFIND body", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: makeHeaders({ dav: "1, webdav-push" }),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 207,
        statusText: "Multi-Status",
        headers: makeHeaders({}),
        bodyText: "<d:multistatus><broken",
      });

    const client = new WebDavPushClient({ request });
    const result = await client.discoverCapabilities("https://example.com/cal");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discoverCapabilities failure.");
    }
    expect(result.error).toBeInstanceOf(XmlParseError);
  });

  it("returns protocol validation error when multistatus shape is invalid", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: makeHeaders({ dav: "1, webdav-push" }),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 207,
        statusText: "Multi-Status",
        headers: makeHeaders({}),
        bodyText: `<?xml version="1.0"?><root><not-multistatus/></root>`,
      });

    const client = new WebDavPushClient({ request });
    const result = await client.discoverCapabilities("https://example.com/cal");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discoverCapabilities failure.");
    }
    expect(result.error).toBeInstanceOf(ProtocolValidationError);
  });

  it("registers web push subscription and returns location/expires", async () => {
    const request = vi.fn<RawHttpRequester["request"]>().mockResolvedValue({
      status: 204,
      statusText: "No Content",
      headers: makeHeaders({
        location: "https://example.com/subscriptions/42",
        expires: "Wed, 02 Oct 2024 07:28:00 GMT",
      }),
      bodyText: "",
    });

    const client = new WebDavPushClient({ request });

    const registration = await client.registerWebPushSubscription({
      resourceUrl: "https://example.com/dav/cal/",
      pushResource: "https://push.example/sub/abc",
      subscriptionPublicKey: "PUBLIC",
      authSecret: "SECRET",
      trigger: {
        contentUpdate: { depth: "1" },
      },
    });

    expect(registration.ok).toBe(true);
    if (!registration.ok) {
      throw new Error("Expected registerWebPushSubscription success.");
    }

    expect(registration.value.status).toBe(204);
    expect(registration.value.location).toBe(
      "https://example.com/subscriptions/42",
    );
    expect(registration.value.expires?.toUTCString()).toBe(
      "Wed, 02 Oct 2024 07:28:00 GMT",
    );

    const call = request.mock.calls[0]?.[0];
    expect(call.method).toBe("POST");
    expect(call.body).toContain("<p:push-register");
    expect(call.body).toContain("<p:content-update>");
  });

  it("returns HTTP status error for non-success register response", async () => {
    const request = vi.fn<RawHttpRequester["request"]>().mockResolvedValue({
      status: 500,
      statusText: "Server Error",
      headers: makeHeaders({}),
      bodyText: "oops",
    });

    const client = new WebDavPushClient({ request });
    const result = await client.registerWebPushSubscription({
      resourceUrl: "https://example.com/dav/cal/",
      pushResource: "https://push.example/sub/abc",
      subscriptionPublicKey: "PUBLIC",
      authSecret: "SECRET",
      trigger: {
        contentUpdate: { depth: "1" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected registerWebPushSubscription failure.");
    }
    expect(result.error).toBeInstanceOf(HttpStatusError);
  });

  it("returns protocol validation error for missing Location when required", async () => {
    const request = vi.fn<RawHttpRequester["request"]>().mockResolvedValue({
      status: 204,
      statusText: "No Content",
      headers: makeHeaders({}),
      bodyText: "",
    });

    const client = new WebDavPushClient({ request });
    const result = await client.registerWebPushSubscription({
      resourceUrl: "https://example.com/dav/cal/",
      pushResource: "https://push.example/sub/abc",
      subscriptionPublicKey: "PUBLIC",
      authSecret: "SECRET",
      trigger: {
        contentUpdate: { depth: "1" },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected registerWebPushSubscription failure.");
    }
    expect(result.error).toBeInstanceOf(ProtocolValidationError);
  });

  it("classifies unregister statuses with deterministic reason categories", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockResolvedValueOnce({
        status: 204,
        statusText: "No Content",
        headers: makeHeaders({}),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: "Not Found",
        headers: makeHeaders({}),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 401,
        statusText: "Unauthorized",
        headers: makeHeaders({}),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        headers: makeHeaders({}),
        bodyText: "",
      });

    const client = new WebDavPushClient({ request });

    const removed = await client.unregister("https://example.com/sub/1");
    const missing = await client.unregister("https://example.com/sub/2");
    const unauthorized = await client.unregister("https://example.com/sub/3");
    const serverError = await client.unregister("https://example.com/sub/4");

    expect(removed.ok && removed.value.reason === "removed").toBe(true);
    expect(missing.ok && missing.value.reason === "already-missing").toBe(true);
    expect(
      unauthorized.ok && unauthorized.value.reason === "unauthorized",
    ).toBe(true);
    expect(serverError.ok && serverError.value.reason === "server-error").toBe(
      true,
    );
  });

  it("returns transport error on network failure", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockRejectedValue(new Error("network"));

    const client = new WebDavPushClient({ request });
    const result = await client.unregister("https://example.com/sub/1");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unregister failure.");
    }
    expect(result.error).toBeInstanceOf(TransportError);
  });

  it("builds Push-Dont-Notify value", () => {
    const client = new WebDavPushClient({
      request: vi.fn<RawHttpRequester["request"]>(),
    });

    const star = client.buildPushDontNotifyHeaderValue("*");
    expect(star.ok && star.value === "*").toBe(true);

    const value = client.buildPushDontNotifyHeaderValue([
      "https://example.com/subscriptions/1",
      "https://example.com/subscriptions/2",
    ]);

    expect(
      value.ok &&
        value.value ===
          '"https://example.com/subscriptions/1", "https://example.com/subscriptions/2"',
    ).toBe(true);
  });

  it("rejects invalid Push-Dont-Notify input", () => {
    const client = new WebDavPushClient({
      request: vi.fn<RawHttpRequester["request"]>(),
    });

    const empty = client.buildPushDontNotifyHeaderValue([]);
    expect(empty.ok).toBe(false);

    const injected = client.buildPushDontNotifyHeaderValue([
      "https://example.com/subscriptions/1\nX-Test: 1",
    ]);

    expect(injected.ok).toBe(false);
  });

  it("returns typed parse error on malformed push payload", () => {
    const client = new WebDavPushClient({
      request: vi.fn<RawHttpRequester["request"]>(),
    });

    const parsed = client.parsePushMessage("<p:push-message><broken");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected parsePushMessage failure.");
    }
    expect(parsed.error).toBeInstanceOf(XmlParseError);
  });
});
