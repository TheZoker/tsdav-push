import { describe, expect, it, vi } from "vitest";

import {
  HttpStatusError,
  RetryExhaustedError,
  TransportError,
} from "../src/errors.js";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("retries retryable transport failures and eventually succeeds", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: new TransportError("network", {
          operation: "retry",
          retryable: true,
          headersSnapshot: {},
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: "ok",
      });

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 0,
      jitterRatio: 0,
    });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value === "ok").toBe(true);
  });

  it("respects Retry-After header when present", async () => {
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: new HttpStatusError("too many requests", {
          operation: "retry",
          status: 429,
          retryable: true,
          headersSnapshot: {
            "retry-after": "1",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: "ok",
      });

    const promise = withRetry(operation, {
      maxAttempts: 2,
      baseDelayMs: 10,
      jitterRatio: 0,
      seed: 1,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(operation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);

    vi.useRealTimers();
  });

  it("returns RetryExhaustedError after max attempts", async () => {
    const operation = vi.fn().mockResolvedValue({
      ok: false,
      error: new TransportError("network", {
        operation: "retry",
        retryable: true,
        headersSnapshot: {},
      }),
    });

    const result = await withRetry(operation, {
      maxAttempts: 2,
      baseDelayMs: 0,
      jitterRatio: 0,
    });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected retry to fail.");
    }
    expect(result.error).toBeInstanceOf(RetryExhaustedError);
  });
});
