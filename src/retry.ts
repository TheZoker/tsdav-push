import {
  HttpStatusError,
  RetryExhaustedError,
  WebDavPushError,
  isRetryableStatus,
} from "./errors.js";
import { RetryOptions, WebDavPushResult } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 15_000;
const DEFAULT_JITTER_RATIO = 0.2;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof HttpStatusError)) {
    return undefined;
  }

  const retryAfter = error.metadata.headersSnapshot["retry-after"];
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const date = new Date(retryAfter);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return Math.max(0, date.getTime() - Date.now());
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof WebDavPushError)) {
    return false;
  }

  if (error.metadata.retryable) {
    return true;
  }

  const status = error.metadata.status;
  if (typeof status === "number") {
    return isRetryableStatus(status);
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeDelayMs(
  attempt: number,
  random: () => number,
  options: Required<
    Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitterRatio">
  >,
): number {
  const exp = Math.min(
    options.baseDelayMs * 2 ** (attempt - 1),
    options.maxDelayMs,
  );
  const jitterSpan = exp * options.jitterRatio;
  const jitter = jitterSpan === 0 ? 0 : (random() * 2 - 1) * jitterSpan;
  return Math.max(0, Math.round(exp + jitter));
}

export async function withRetry<T>(
  operation: () => Promise<WebDavPushResult<T>>,
  options?: RetryOptions,
): Promise<WebDavPushResult<T>> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = options?.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const shouldRetry = options?.shouldRetry ?? isRetryableError;
  const random = createSeededRandom(options?.seed ?? 42);

  let attempts = 0;
  let lastError: WebDavPushError | undefined;

  while (attempts < maxAttempts) {
    attempts += 1;
    const result = await operation();
    if (result.ok) {
      return result;
    }

    lastError = result.error;
    if (!shouldRetry(lastError) || attempts >= maxAttempts) {
      break;
    }

    const retryAfterMs = getRetryAfterMs(lastError);
    const computedDelay = computeDelayMs(attempts, random, {
      baseDelayMs,
      maxDelayMs,
      jitterRatio,
    });

    await delay(retryAfterMs ?? computedDelay);
  }

  if (!lastError) {
    return {
      ok: false,
      error: new RetryExhaustedError(
        "Retry exhausted without receiving a result.",
        {
          operation: "retry",
          retryable: false,
          headersSnapshot: {},
        },
        attempts,
      ),
    };
  }

  return {
    ok: false,
    error: new RetryExhaustedError(
      `Retry exhausted after ${attempts} attempts.`,
      {
        operation: "retry",
        status: lastError.metadata.status,
        retryable: false,
        bodySnippet: lastError.metadata.bodySnippet,
        headersSnapshot: lastError.metadata.headersSnapshot,
      },
      attempts,
    ),
  };
}
