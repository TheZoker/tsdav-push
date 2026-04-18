import { RawHttpRequester, TsdavLikeClient } from "./types.js";
export declare function createFetchRequester(options?: {
    fetch?: typeof fetch;
    defaultHeaders?: Record<string, string>;
    defaultRequestInit?: RequestInit;
}): RawHttpRequester;
export declare function createTsdavRequester(client: TsdavLikeClient): RawHttpRequester;
