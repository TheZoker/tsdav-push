type PushEventLike = Event & {
  data?: {
    text(): string;
  };
  waitUntil(promise: Promise<unknown>): void;
};

type ServiceWorkerLike = typeof self & {
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled?: boolean;
    }): Promise<Array<{ postMessage(message: unknown): void }>>;
  };
  addEventListener(type: "push", listener: (event: Event) => void): void;
};

const serviceWorker = self as ServiceWorkerLike;

serviceWorker.addEventListener("push", (event: Event) => {
  const pushEvent = event as PushEventLike;
  const payloadText = pushEvent.data?.text() ?? "";

  // Forward raw payload to active app pages. Your app can parse and map topic -> collection sync.
  pushEvent.waitUntil(
    serviceWorker.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({
            type: "webdav-push",
            payloadText,
          });
        }
      }),
  );
});
