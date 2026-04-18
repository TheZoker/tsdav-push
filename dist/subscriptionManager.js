import { withRetry } from "./retry.js";
const DEFAULT_EARLY_REFRESH_MS = 1000 * 60 * 60 * 6;
export class PushSubscriptionRenewalManager {
    constructor(client, options) {
        this.client = client;
        this.options = options;
        this.active = false;
        this.timerGeneration = 0;
    }
    async registerAndSchedule(input) {
        return this.start(input);
    }
    async start(input) {
        this.active = true;
        this.lastInput = input;
        const result = await withRetry(() => this.client.registerWebPushSubscription(input), this.options?.retry);
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
    stop() {
        this.active = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    scheduleNextRenewal(expiresAt) {
        const earlyRefreshMs = this.options?.earlyRefreshMs ?? DEFAULT_EARLY_REFRESH_MS;
        const msUntilRenewal = Math.max(expiresAt.getTime() - Date.now() - earlyRefreshMs, 1000);
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
    async runScheduledRenewal(generation) {
        if (!this.active ||
            generation !== this.timerGeneration ||
            !this.lastInput) {
            return;
        }
        const result = await withRetry(() => this.client.registerWebPushSubscription(this.lastInput), this.options?.retry);
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
