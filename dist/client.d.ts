import { ClientOptions, PushMessage, RawHttpRequester, RegisterWebPushSubscriptionInput, RegisterWebPushSubscriptionResult, UnregisterResult, WebDavPushResult, WebDavPushCapabilities } from "./types.js";
export declare class WebDavPushClient {
    private readonly requester;
    private readonly defaultHeaders?;
    private readonly options?;
    constructor(requester: RawHttpRequester, defaultHeadersOrOptions?: Record<string, string> | ClientOptions);
    discoverCapabilities(resourceUrl: string, headers?: Record<string, string>): Promise<WebDavPushResult<WebDavPushCapabilities>>;
    registerWebPushSubscription(input: RegisterWebPushSubscriptionInput): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>>;
    unregister(registrationUrl: string, headers?: Record<string, string>): Promise<WebDavPushResult<UnregisterResult>>;
    parsePushMessage(xml: string): WebDavPushResult<PushMessage>;
    buildPushDontNotifyHeaderValue(registrationUrls: string[] | "*"): WebDavPushResult<string>;
}
