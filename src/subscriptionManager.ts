import {
  RegisterWebPushSubscriptionInput,
  RegisterWebPushSubscriptionResult,
  RenewalManagerOptions,
  WebDavPushResult,
} from "./types.js";
import { WebDavPushClient } from "./client.js";
import { withRetry } from "./retry.js";

const DEFAULT_EARLY_REFRESH_MS = 1000 * 60 * 60 * 6;

export class PushSubscriptionRenewalManager {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private lastInput: RegisterWebPushSubscriptionInput | undefined;
  private timerGeneration = 0;

  constructor(
    private readonly client: WebDavPushClient,
    private readonly options?: RenewalManagerOptions,
  ) {}

  async registerAndSchedule(
    input: RegisterWebPushSubscriptionInput,
  ): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>> {
    return this.start(input);
  }

  async start(
    input: RegisterWebPushSubscriptionInput,
  ): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>> {
    this.active = true;
    this.lastInput = input;

    const result = await withRetry(
      () => this.client.registerWebPushSubscription(input),
      this.options?.retry,
    );

    if (!result.ok) {
      this.options?.onRenewalFailure?.(result.error);
      return result;
    }

    this.options?.onRenewalSuccess?.(result.value);

    if (result.value.expires) {
      this.scheduleNextRenewal(result.value.expires);
    }

    return result;
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextRenewal(expiresAt: Date): void {
    const earlyRefreshMs =
      this.options?.earlyRefreshMs ?? DEFAULT_EARLY_REFRESH_MS;
    const msUntilRenewal = Math.max(
      expiresAt.getTime() - Date.now() - earlyRefreshMs,
      1000,
    );

    const generation = this.timerGeneration + 1;
    this.timerGeneration = generation;

    this.stop();
    this.active = true;

    const nextAttemptAt = new Date(Date.now() + msUntilRenewal);
    this.options?.onNextAttemptScheduled?.(nextAttemptAt);

    this.timer = setTimeout(() => {
      void this.runScheduledRenewal(generation);
    }, msUntilRenewal);
  }

  private async runScheduledRenewal(generation: number): Promise<void> {
    if (
      !this.active ||
      generation !== this.timerGeneration ||
      !this.lastInput
    ) {
      return;
    }

    const result = await withRetry(
      () =>
        this.client.registerWebPushSubscription(
          this.lastInput as RegisterWebPushSubscriptionInput,
        ),
      this.options?.retry,
    );

    if (!this.active || generation !== this.timerGeneration) {
      return;
    }

    if (!result.ok) {
      this.options?.onRenewalFailure?.(result.error);
      return;
    }

    this.options?.onRenewalSuccess?.(result.value);
    if (result.value.expires) {
      this.scheduleNextRenewal(result.value.expires);
    }
  }
}
