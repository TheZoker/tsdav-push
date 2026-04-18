import { RegisterWebPushSubscriptionInput, RegisterWebPushSubscriptionResult, RenewalManagerOptions, WebDavPushResult } from "./types.js";
import { WebDavPushClient } from "./client.js";
export declare class PushSubscriptionRenewalManager {
    private readonly client;
    private readonly options?;
    private timer;
    private active;
    private lastInput;
    private timerGeneration;
    constructor(client: WebDavPushClient, options?: RenewalManagerOptions | undefined);
    registerAndSchedule(input: RegisterWebPushSubscriptionInput): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>>;
    start(input: RegisterWebPushSubscriptionInput): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>>;
    stop(): void;
    private scheduleNextRenewal;
    private runScheduledRenewal;
}
