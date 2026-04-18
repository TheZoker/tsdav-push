# tsdav-push

WebDAV Push helper library for applications that already use [tsdav](https://github.com/natelindev/tsdav).

This package implements protocol-focused client behavior for the current WebDAV Push draft and DAVx/Nextcloud-style deployments:

- service detection (`OPTIONS` + push properties via `PROPFIND`)
- Web Push subscription registration (`POST` with `push-register` XML)
- unregistration (`DELETE` registration URL)
- utility for `Push-Dont-Notify` header values
- parsing incoming push XML payloads (`push-message`)
- optional retry/backoff utilities
- generic renewal lifecycle manager hooks

## Installation

```bash
npm install tsdav-push
```

## Run Locally

```bash
npm install
npm run typecheck
npm run test
npm run build
```

## Quick Start (with tsdav)

```ts
import { DAVClient } from "tsdav";
import { WebDavPushClient, createTsdavRequester } from "tsdav-push";

const davClient = new DAVClient({
  serverUrl: "https://example.com/remote.php/dav",
  credentials: {
    username: "alice",
    password: "app-password",
  },
  authMethod: "Basic",
});

await davClient.login();

const pushClient = new WebDavPushClient(createTsdavRequester(davClient));

const capabilitiesResult = await pushClient.discoverCapabilities(
  "https://example.com/remote.php/dav/calendars/alice/work/",
);

if (!capabilitiesResult.ok) {
  throw capabilitiesResult.error;
}

const capabilities = capabilitiesResult.value;

if (!capabilities.supportedByDavHeader) {
  throw new Error("Server does not advertise webdav-push in DAV header.");
}

const webPush = capabilities.transports.find(
  (transport) => transport.id === "web-push",
);
if (!webPush?.vapidPublicKey?.value) {
  throw new Error("Server does not provide a web-push VAPID key.");
}

// Values from your browser/UnifiedPush subscription payload:
const pushResource = "https://push.example.net/subscription/123";
const subscriptionPublicKey = "BCf...";
const authSecret = "fE2...";

const registrationResult = await pushClient.registerWebPushSubscription({
  resourceUrl: "https://example.com/remote.php/dav/calendars/alice/work/",
  pushResource,
  subscriptionPublicKey,
  authSecret,
  trigger: {
    contentUpdate: { depth: "1" },
    propertyUpdate: { depth: "0" },
  },
});

if (!registrationResult.ok) {
  throw registrationResult.error;
}

const registration = registrationResult.value;

console.log("Registration URL:", registration.location);
console.log("Subscription expires:", registration.expires?.toISOString());
```

## Typed Result Pattern

Public operations return a typed result union:

```ts
type WebDavPushResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WebDavPushError };
```

Use `instanceof` for robust error handling:

```ts
import {
  HttpStatusError,
  ProtocolValidationError,
  TransportError,
  XmlParseError,
} from "tsdav-push";

const result = await pushClient.discoverCapabilities(resourceUrl);

if (!result.ok) {
  if (result.error instanceof TransportError) {
    // network/transport issue
  } else if (result.error instanceof HttpStatusError) {
    // HTTP status class mismatch
  } else if (result.error instanceof ProtocolValidationError) {
    // semantically invalid response
  } else if (result.error instanceof XmlParseError) {
    // malformed XML
  }
}
```

All typed errors include metadata:

- `operation`
- `status` (when available)
- `retryable`
- `bodySnippet` (safe-truncated)
- `headersSnapshot`

## Push Payload Parsing

Inside your service worker push handler (or UnifiedPush message receiver), parse the decrypted XML payload:

```ts
const parsedResult = pushClient.parsePushMessage(xmlPayload);

if (!parsedResult.ok) {
  throw parsedResult.error;
}

const parsed = parsedResult.value;

if (parsed.hasContentUpdate) {
  // Trigger tsdav sync logic for the affected collection/topic
}
```

## `Push-Dont-Notify` helper

```ts
const headerResult = pushClient.buildPushDontNotifyHeaderValue([
  "https://example.com/apps/dav_push/subscriptions/42",
]);

if (!headerResult.ok) {
  throw headerResult.error;
}

const headerValue = headerResult.value;

// send in write requests that should not trigger self-notifications
// Push-Dont-Notify: "https://example.com/apps/dav_push/subscriptions/42"
```

The helper validates illegal input to prevent header injection patterns.

## Status Semantics

`discoverCapabilities`:

- expects `OPTIONS` 2xx and `PROPFIND` 207 or 2xx
- strict mode (default) validates multistatus shape
- malformed XML returns `XmlParseError`

`registerWebPushSubscription`:

- defaults to 2xx success policy
- validates `Expires` header parseability
- validates required `Location` by default
- policy can be overridden with `registerPolicy`

`unregister`:

- returns categorized result for known statuses
- maps to reason categories: `removed`, `already-missing`, `unauthorized`, `server-error`, `unexpected-status`
- transport failures return typed `TransportError`
- optional `strictUnregisterErrors` mode maps 401/403/5xx/unexpected statuses to `HttpStatusError`

## Strict and Diagnostics Modes

`WebDavPushClient` supports:

- `strictMode` (default `true`): enforce required DAV response structure
- `strictPayloadMode` (default `false`): require semantic payload shape (`push-message` root and known update node)
- `strictUnregisterErrors` (default `false`): convert non-removal unregister statuses into typed errors
- `parseDiagnostics` (default `false`): include parser shape diagnostics in protocol validation messages

```ts
const pushClient = new WebDavPushClient(requester, {
  strictMode: true,
  strictPayloadMode: true,
  strictUnregisterErrors: true,
  parseDiagnostics: true,
});
```

## Retry Helpers

Use `withRetry` for retryable operations.

Defaults:

- max attempts: `3`
- base delay: `250ms`
- max delay: `15000ms`
- jitter ratio: `0.2`
- retryable classes: transport errors, `429`, and selected `5xx`

`Retry-After` is honored when present on HTTP status errors.

```ts
import { withRetry } from "tsdav-push";

const result = await withRetry(
  () => pushClient.registerWebPushSubscription(input),
  {
    maxAttempts: 5,
    seed: 123,
  },
);
```

## Renewal Manager

`PushSubscriptionRenewalManager` is generic and persistence-free.

Features:

- idempotent `start` / `stop` lifecycle
- retry integration through `retry` options
- callbacks for renewal success/failure/next attempt scheduling
- safe timer lifecycle with no fire-and-forget unhandled rejections

```ts
const manager = new PushSubscriptionRenewalManager(pushClient, {
  earlyRefreshMs: 1000 * 60 * 60 * 6,
  retry: { maxAttempts: 4 },
  onRenewalFailure: (error) => {
    console.warn("renewal failed", error);
  },
});

const result = await manager.start(input);
if (!result.ok) {
  throw result.error;
}
```

## API Overview

- `WebDavPushClient.discoverCapabilities(resourceUrl)`
- `WebDavPushClient.registerWebPushSubscription(input)`
- `WebDavPushClient.unregister(registrationUrl)`
- `WebDavPushClient.parsePushMessage(xml)`
- `WebDavPushClient.buildPushDontNotifyHeaderValue(urlsOrStar)`
- `PushSubscriptionRenewalManager.start(input)`
- `PushSubscriptionRenewalManager.registerAndSchedule(input)`
- `PushSubscriptionRenewalManager.stop()`
- `withRetry(operation, options)`

## Browser + Service Worker

See [examples/browser/README.md](examples/browser/README.md) for a full browser pattern with:

- capability discovery + VAPID key usage
- browser push subscription creation
- WebDAV Push registration
- service-worker push event forwarding

Example files:

- [examples/browser/app.ts](examples/browser/app.ts)
- [examples/browser/service-worker.ts](examples/browser/service-worker.ts)

## Testing

The project includes Vitest unit tests for:

- request wrapper behavior
- capability discovery and registration flow
- XML build/parse helpers
- retry behavior (including deterministic seeded jitter and Retry-After)
- renewal manager lifecycle behavior
- status/error classification paths

Contract-style fixture tests are included for:

- Nextcloud-like discovery response variants
- Rustical-like partial discovery responses
- malformed/partial multistatus strict vs permissive behavior

Run tests with:

```bash
npm run test
```

## Publishing

The `prepublishOnly` script runs a full verification pipeline before publish:

- clean output
- typecheck
- tests
- build

Publish when ready:

```bash
npm publish
```

For GitHub Actions based publishing, workflows are included:

- [ci.yml](.github/workflows/ci.yml)
- [publish.yml](.github/workflows/publish.yml)

To enable workflow publishing, set `NPM_TOKEN` in repository secrets.

## Notes

- The WebDAV Push specification is still draft/experimental.
- Keep regular polling/sync as fallback. Push should reduce polling frequency, not replace it completely.
- For browser use, your app must already be able to create a Web Push subscription (using the server-provided VAPID key) before registering it with WebDAV Push.
