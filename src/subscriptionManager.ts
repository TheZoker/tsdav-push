import {
  RegisterWebPushSubscriptionInput,
  RenewalManagerOptions,
} from "./types.js";
import { WebDavPushClient } from "./client.js";

const DEFAULT_EARLY_REFRESH_MS = 1000 * 60 * 60 * 6;

export class PushSubscriptionRenewalManager {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: WebDavPushClient,
    private readonly options?: RenewalManagerOptions,
  ) {}

  async registerAndSchedule(
    input: RegisterWebPushSubscriptionInput,
  ): Promise<void> {
    const result = await this.client.registerWebPushSubscription(input);

    if (!result.expires) {
      return;
    }

    this.scheduleNextRenewal(result.expires, async () => {
      await this.registerAndSchedule(input);
    });
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextRenewal(
    expiresAt: Date,
    renewal: () => Promise<void>,
  ): void {
    const earlyRefreshMs =
      this.options?.earlyRefreshMs ?? DEFAULT_EARLY_REFRESH_MS;
    const msUntilRenewal = Math.max(
      expiresAt.getTime() - Date.now() - earlyRefreshMs,
      1000,
    );

    this.stop();

    this.timer = setTimeout(() => {
      void renewal();
    }, msUntilRenewal);
  }
}
