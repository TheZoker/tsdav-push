type ErrorOperation = "discoverCapabilities" | "registerWebPushSubscription" | "unregister" | "parsePushMessage" | "buildPushDontNotifyHeaderValue" | "retry" | "renewal";
export interface ErrorMetadata {
    operation: ErrorOperation;
    status?: number;
    retryable: boolean;
    bodySnippet?: string;
    headersSnapshot: Record<string, string>;
}
export declare abstract class WebDavPushError extends Error {
    readonly metadata: ErrorMetadata;
    constructor(message: string, metadata: ErrorMetadata);
}
export declare class TransportError extends WebDavPushError {
}
export declare class HttpStatusError extends WebDavPushError {
}
export declare class ProtocolValidationError extends WebDavPushError {
}
export declare class XmlParseError extends WebDavPushError {
}
export declare class RetryExhaustedError extends WebDavPushError {
    readonly attempts: number;
    constructor(message: string, metadata: ErrorMetadata, attempts: number);
}
export declare function truncateBodySnippet(bodyText: string | undefined): string | undefined;
export declare function headersToSnapshot(headers: Headers | undefined): Record<string, string>;
export declare function isRetryableStatus(status: number): boolean;
export {};
