# Browser + Service Worker Example

This example shows one practical integration pattern for Web Push + WebDAV Push in a browser app:

1. Discover WebDAV Push capability and fetch the `web-push` VAPID key from your DAV resource.
2. Create a browser Web Push subscription using that VAPID key.
3. Register the subscription at your WebDAV resource via `registerWebPushSubscription`.
4. Handle incoming push notifications in a service worker and trigger your app sync pipeline.

## Files

- `app.ts`: app-side setup and registration flow
- `service-worker.ts`: push event handling and message forwarding to app clients

## Important

- This is a template and omits your authentication/session glue.
- Browser push payload encryption/decryption is handled by the browser Push API, not by this library.
- You still need periodic fallback sync (push is an acceleration signal).
