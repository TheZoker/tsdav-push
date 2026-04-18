import { DAVClient } from "tsdav";
import {
  PushSubscriptionRenewalManager,
  WebDavPushClient,
  createTsdavRequester,
} from "../../src/index.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const output = urlBase64ToUint8Array(base64String);
  const arrayBuffer = new ArrayBuffer(output.byteLength);

  // Create a concrete ArrayBuffer so the return type is never SharedArrayBuffer.
  new Uint8Array(arrayBuffer).set(output);

  return arrayBuffer;
}

export async function setupWebDavPushInBrowser(
  resourceUrl: string,
): Promise<void> {
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
  const capabilitiesResult = await pushClient.discoverCapabilities(resourceUrl);
  if (!capabilitiesResult.ok) {
    throw capabilitiesResult.error;
  }

  const capabilities = capabilitiesResult.value;
  const webPushTransport = capabilities.transports.find(
    (item) => item.id === "web-push",
  );

  if (
    !capabilities.supportedByDavHeader ||
    !webPushTransport?.vapidPublicKey?.value
  ) {
    throw new Error("WebDAV Push not available for this resource.");
  }

  const swRegistration =
    await navigator.serviceWorker.register("/service-worker.js");

  const browserSubscription = await swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(
      webPushTransport.vapidPublicKey.value,
    ),
  });

  const browserSubscriptionJson = browserSubscription.toJSON();
  const p256dh = browserSubscriptionJson.keys?.p256dh;
  const auth = browserSubscriptionJson.keys?.auth;

  if (!browserSubscription.endpoint || !p256dh || !auth) {
    throw new Error("Browser Push subscription is missing endpoint or keys.");
  }

  const renewalManager = new PushSubscriptionRenewalManager(pushClient, {
    earlyRefreshMs: 1000 * 60 * 60 * 12,
  });

  const registrationResult = await renewalManager.registerAndSchedule({
    resourceUrl,
    pushResource: browserSubscription.endpoint,
    subscriptionPublicKey: p256dh,
    authSecret: auth,
    trigger: {
      contentUpdate: { depth: "1" },
      propertyUpdate: { depth: "0" },
    },
  });

  if (!registrationResult.ok) {
    throw registrationResult.error;
  }
}
