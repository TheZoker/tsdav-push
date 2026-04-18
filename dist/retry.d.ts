import { RetryOptions, WebDavPushResult } from "./types.js";
export declare function withRetry<T>(operation: () => Promise<WebDavPushResult<T>>, options?: RetryOptions): Promise<WebDavPushResult<T>>;
