# tsdav-push

WebDAV Push helper library for applications that already use [tsdav](https://github.com/natelindev/tsdav).

This package implements the client-side workflow needed by the current WebDAV Push draft and DAVx/Nextcloud-style deployments:

- service detection (`OPTIONS` + push properties via `PROPFIND`)
- Web Push subscription registration (`POST` with `push-register` XML)
- unregistration (`DELETE` registration URL)
- utility for `Push-Dont-Notify` header values
- parsing incoming push XML payloads (`push-message`)

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

const capabilities = await pushClient.discoverCapabilities(
  "https://example.com/remote.php/dav/calendars/alice/work/",
);

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

const registration = await pushClient.registerWebPushSubscription({
  resourceUrl: "https://example.com/remote.php/dav/calendars/alice/work/",
  pushResource,
  subscriptionPublicKey,
  authSecret,
  trigger: {
    contentUpdate: { depth: "1" },
    propertyUpdate: { depth: "0" },
  },
});

console.log("Registration URL:", registration.location);
console.log("Subscription expires:", registration.expires?.toISOString());
```

## Push Payload Parsing

Inside your service worker push handler (or UnifiedPush message receiver), parse the decrypted XML payload:

```ts
const parsed = pushClient.parsePushMessage(xmlPayload);

if (parsed.hasContentUpdate) {
  // Trigger tsdav sync logic for the affected collection/topic
}
```

## `Push-Dont-Notify` helper

```ts
const headerValue = pushClient.buildPushDontNotifyHeaderValue([
  "https://example.com/apps/dav_push/subscriptions/42",
]);

// send in write requests that should not trigger self-notifications
// Push-Dont-Notify: "https://example.com/apps/dav_push/subscriptions/42"
```

## API Overview

- `WebDavPushClient.discoverCapabilities(resourceUrl)`
- `WebDavPushClient.registerWebPushSubscription(input)`
- `WebDavPushClient.unregister(registrationUrl)`
- `WebDavPushClient.parsePushMessage(xml)`
- `WebDavPushClient.buildPushDontNotifyHeaderValue(urlsOrStar)`
- `PushSubscriptionRenewalManager.registerAndSchedule(input)`

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
