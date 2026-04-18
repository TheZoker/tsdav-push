import type { WebDavPushError } from "./errors.js";
export type DavDepth = "0" | "1" | "infinity";
export type PushTransportId = "web-push" | string;
export interface PushTransportInfo {
    id: PushTransportId;
    vapidPublicKey?: {
        value: string;
        type?: string;
    };
}
export interface SupportedTrigger {
    type: "content-update" | "property-update";
    depth: DavDepth;
}
export interface WebDavPushCapabilities {
    supportedByDavHeader: boolean;
    transports: PushTransportInfo[];
    topic?: string;
    supportedTriggers: SupportedTrigger[];
    rawDavHeader?: string;
    webPush: {
        available: boolean;
        hasVapidPublicKey: boolean;
        missingVapidPublicKey: boolean;
    };
}
export interface RegisterWebPushSubscriptionInput {
    resourceUrl: string;
    pushResource: string;
    subscriptionPublicKey: string;
    authSecret: string;
    contentEncoding?: "aes128gcm" | string;
    requestedExpiration?: Date;
    trigger: {
        contentUpdate?: {
            depth: DavDepth;
        };
        propertyUpdate?: {
            depth: DavDepth;
            properties?: Array<{
                namespace: string;
                name: string;
            }>;
        };
    };
    headers?: Record<string, string>;
}
export interface RegisterWebPushSubscriptionResult {
    status: number;
    location?: string;
    expires?: Date;
    rawResponseBody: string;
}
export interface UnregisterResult {
    status: number;
    removed: boolean;
    reason: "removed" | "already-missing" | "unauthorized" | "server-error" | "unexpected-status" | "transport-error";
}
export interface PushMessage {
    topic?: string;
    hasContentUpdate: boolean;
    hasPropertyUpdate: boolean;
    syncToken?: string;
    changedProperties: Array<{
        namespace: string;
        name: string;
    }>;
}
export interface RawHttpResponse {
    status: number;
    statusText: string;
    headers: Headers;
    bodyText: string;
}
export interface RawHttpRequest {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface RawHttpRequester {
    request(input: RawHttpRequest): Promise<RawHttpResponse>;
}
export interface TsdavLikeClient {
    authHeaders?: Record<string, string>;
    fetchOptions?: RequestInit;
    fetchOverride?: typeof fetch;
}
export interface RenewalManagerOptions {
    earlyRefreshMs?: number;
    retry?: RetryOptions;
    onRenewalSuccess?: (result: RegisterWebPushSubscriptionResult) => void;
    onRenewalFailure?: (error: WebDavPushError) => void;
    onNextAttemptScheduled?: (nextAttemptAt: Date) => void;
}
export interface RegisterResponsePolicy {
    isSuccessStatus(status: number): boolean;
    requiresLocationOnSuccess: boolean;
}
export interface UnregisterResponsePolicy {
    isRemovedStatus(status: number): boolean;
    isAlreadyMissingStatus(status: number): boolean;
}
export interface ClientOptions {
    defaultHeaders?: Record<string, string>;
    strictMode?: boolean;
    strictPayloadMode?: boolean;
    strictUnregisterErrors?: boolean;
    parseDiagnostics?: boolean;
    registerPolicy?: Partial<RegisterResponsePolicy>;
    unregisterPolicy?: Partial<UnregisterResponsePolicy>;
}
export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    seed?: number;
    shouldRetry?: (error: unknown) => boolean;
}
export type WebDavPushResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: WebDavPushError;
};
