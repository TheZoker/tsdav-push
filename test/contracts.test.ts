import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { WebDavPushClient } from "../src/client.js";
import { ProtocolValidationError } from "../src/errors.js";
import { RawHttpRequester } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "fixtures", "discovery", name),
    "utf-8",
  );
}

function makeHeaders(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

describe("contract fixtures", () => {
  it("parses nextcloud-like discovery response", async () => {
    const request = vi
      .fn<RawHttpRequester["request"]>()
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: makeHeaders({
          dav: "1, 3, calendar-access, WebDAV-Push, extended-mkcol",
        }),
        bodyText: "",
      })
      .mockResolvedValueOnce({
        status: 207,
        statusText: "Multi-Status",
        headers: makeHeaders({}),
        bodyText: fixture("nextcloud-like.xml"),
      });

    const client = new WebDavPushClient({ request });
    const result = await client.discoverCapabilities("https://example.com/cal");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success for nextcloud-like fixture.");
    }

    expect(result.value.supportedByDavHeader).toBe(true);
    expect(result.value.topic).toBe("nextcloud-topic");
    expect(result.value.webPush.hasVapidPublicKey).toBe(true);
  });

  it("parses rustical-like partial discovery response with missing key flags", async () => {
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
        bodyText: fixture("rustical-like-partial.xml"),
      });

    const client = new WebDavPushClient({ request });
    const result = await client.discoverCapabilities("https://example.com/cal");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success for rustical-like partial fixture.");
    }

    expect(result.value.webPush.available).toBe(true);
    expect(result.value.webPush.missingVapidPublicKey).toBe(true);
  });

  it("fails malformed partial multistatus in strict mode and allows permissive mode", async () => {
    const strictRequest = vi
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
        bodyText: fixture("malformed-partial.xml"),
      });

    const strictClient = new WebDavPushClient({ request: strictRequest });
    const strictResult = await strictClient.discoverCapabilities(
      "https://example.com/cal",
    );

    expect(strictResult.ok).toBe(false);
    if (strictResult.ok) {
      throw new Error(
        "Expected strict mode to reject malformed partial fixture.",
      );
    }
    expect(strictResult.error).toBeInstanceOf(ProtocolValidationError);

    const permissiveRequest = vi
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
        bodyText: fixture("malformed-partial.xml"),
      });

    const permissiveClient = new WebDavPushClient(
      { request: permissiveRequest },
      { strictMode: false },
    );

    const permissiveResult = await permissiveClient.discoverCapabilities(
      "https://example.com/cal",
    );

    expect(permissiveResult.ok).toBe(true);
    if (!permissiveResult.ok) {
      throw new Error(
        "Expected permissive mode to allow malformed partial fixture.",
      );
    }
    expect(permissiveResult.value.transports).toEqual([]);
  });
});
