import { describe, expect, it, vi } from "vitest";

import { TransportError } from "../src/errors.js";
import { PushSubscriptionRenewalManager } from "../src/subscriptionManager.js";
import { RegisterWebPushSubscriptionInput } from "../src/types.js";

const INPUT: RegisterWebPushSubscriptionInput = {
  resourceUrl: "https://example.com/dav/cal/",
  pushResource: "https://push.example/sub/abc",
  subscriptionPublicKey: "PUBLIC",
  authSecret: "SECRET",
  trigger: {
    contentUpdate: { depth: "1" },
  },
};

describe("PushSubscriptionRenewalManager", () => {
  it("schedules renewal and avoids duplicate timers when started repeatedly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T10:00:00.000Z"));

    const register = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        status: 204,
        location: "https://example.com/subscriptions/1",
        expires: new Date("2026-04-17T10:00:02.000Z"),
        rawResponseBody: "",
      },
    });

    const manager = new PushSubscriptionRenewalManager(
      {
        registerWebPushSubscription: register,
      } as any,
      {
        earlyRefreshMs: 0,
      },
    );

    await manager.start(INPUT);
    await manager.start(INPUT);

    await vi.advanceTimersByTimeAsync(2200);

    // 2 immediate starts + 1 scheduled renewal call.
    expect(register).toHaveBeenCalledTimes(3);

    manager.stop();
    vi.useRealTimers();
  });

  it("emits failure callback after retry exhaustion", async () => {
    const register = vi.fn().mockResolvedValue({
      ok: false,
      error: new TransportError("network", {
        operation: "registerWebPushSubscription",
        retryable: true,
        headersSnapshot: {},
      }),
    });

    const onRenewalFailure = vi.fn();

    const manager = new PushSubscriptionRenewalManager(
      {
        registerWebPushSubscription: register,
      } as any,
      {
        retry: {
          maxAttempts: 2,
          baseDelayMs: 0,
          jitterRatio: 0,
        },
        onRenewalFailure,
      },
    );

    const result = await manager.start(INPUT);

    expect(result.ok).toBe(false);
    expect(onRenewalFailure).toHaveBeenCalledTimes(1);
  });
});
