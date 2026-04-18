import { describe, expect, it } from "vitest";

import {
  buildPushPropertiesPropfindBody,
  buildRegisterBody,
  parsePushMessage,
} from "../src/xml.js";

describe("xml helpers", () => {
  it("builds push properties PROPFIND body", () => {
    const body = buildPushPropertiesPropfindBody();
    expect(body).toContain("<p:transports/>");
    expect(body).toContain("<p:topic/>");
    expect(body).toContain("<p:supported-triggers/>");
  });

  it("builds register body with triggers and escape handling", () => {
    const body = buildRegisterBody({
      pushResource: "https://push.example/sub/1?a=1&b=2",
      subscriptionPublicKey: "ABC<DEF",
      authSecret: 'XYZ"123',
      contentEncoding: "aes128gcm",
      trigger: {
        contentUpdate: { depth: "1" },
        propertyUpdate: {
          depth: "0",
          properties: [{ namespace: "DAV:", name: "displayname" }],
        },
      },
    });

    expect(body).toContain("&amp;");
    expect(body).toContain("&lt;");
    expect(body).toContain("&quot;");
    expect(body).toContain("<p:property-update>");
    expect(body).toContain('<x:displayname xmlns:x="DAV:"/>');
  });

  it("parses push message content and property updates", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<p:push-message xmlns:p="https://bitfire.at/webdav-push" xmlns:d="DAV:" xmlns:c="urn:custom">
  <p:topic>abc</p:topic>
  <p:content-update>
    <d:sync-token>http://example.com/sync/10</d:sync-token>
  </p:content-update>
  <p:property-update>
    <d:prop>
      <c:color xmlns:c="urn:custom"/>
    </d:prop>
  </p:property-update>
</p:push-message>`;

    const parsed = parsePushMessage(xml);

    expect(parsed.topic).toBe("abc");
    expect(parsed.hasContentUpdate).toBe(true);
    expect(parsed.hasPropertyUpdate).toBe(true);
    expect(parsed.syncToken).toBe("http://example.com/sync/10");
    expect(parsed.changedProperties).toEqual([
      { namespace: "urn:custom", name: "color" },
    ]);
  });

  it("parses namespace variations and ignores unknown elements", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<p:push-message xmlns:p="https://bitfire.at/webdav-push" xmlns:d="DAV:">
  <p:topic>topic-x</p:topic>
  <p:unknown>ignored</p:unknown>
  <p:content-update>
    <d:sync-token>sync-1</d:sync-token>
  </p:content-update>
</p:push-message>`;

    const parsed = parsePushMessage(xml);

    expect(parsed.topic).toBe("topic-x");
    expect(parsed.hasContentUpdate).toBe(true);
    expect(parsed.hasPropertyUpdate).toBe(false);
    expect(parsed.changedProperties).toEqual([]);
  });

  it("throws on malformed push payload XML", () => {
    expect(() => parsePushMessage("<p:push-message><broken")).toThrow();
  });
});
