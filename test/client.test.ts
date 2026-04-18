import { describe, expect, it, vi } from "vitest";

import { WebDavPushClient } from "../src/client.js";
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

    expect(result.supportedByDavHeader).toBe(true);
    expect(result.topic).toBe("topic-123");
    expect(result.transports[0]?.id).toBe("web-push");
    expect(result.transports[0]?.vapidPublicKey?.value).toBe("PUBKEY");
    expect(result.supportedTriggers).toEqual([
      { type: "content-update", depth: "1" },
      { type: "property-update", depth: "0" },
    ]);
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

    expect(registration.status).toBe(204);
    expect(registration.location).toBe("https://example.com/subscriptions/42");
    expect(registration.expires?.toUTCString()).toBe(
      "Wed, 02 Oct 2024 07:28:00 GMT",
    );

    const call = request.mock.calls[0]?.[0];
    expect(call.method).toBe("POST");
    expect(call.body).toContain("<p:push-register");
    expect(call.body).toContain("<p:content-update>");
  });

  it("builds Push-Dont-Notify value", () => {
    const client = new WebDavPushClient({
      request: vi.fn<RawHttpRequester["request"]>(),
    });

    expect(client.buildPushDontNotifyHeaderValue("*")).toBe("*");
    expect(
      client.buildPushDontNotifyHeaderValue([
        "https://example.com/subscriptions/1",
        "https://example.com/subscriptions/2",
      ]),
    ).toBe(
      '"https://example.com/subscriptions/1", "https://example.com/subscriptions/2"',
    );
  });
});
