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
}

export interface RegisterWebPushSubscriptionInput {
  resourceUrl: string;
  pushResource: string;
  subscriptionPublicKey: string;
  authSecret: string;
  contentEncoding?: "aes128gcm" | string;
  requestedExpiration?: Date;
  trigger: {
    contentUpdate?: { depth: DavDepth };
    propertyUpdate?: {
      depth: DavDepth;
      properties?: Array<{ namespace: string; name: string }>;
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
}

export interface PushMessage {
  topic?: string;
  hasContentUpdate: boolean;
  hasPropertyUpdate: boolean;
  syncToken?: string;
  changedProperties: Array<{ namespace: string; name: string }>;
}

export interface RawHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  bodyText: string;
}

export interface RawHttpRequester {
  request(input: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<RawHttpResponse>;
}

export interface TsdavLikeClient {
  authHeaders?: Record<string, string>;
  fetchOptions?: RequestInit;
  fetchOverride?: typeof fetch;
}

export interface RenewalManagerOptions {
  earlyRefreshMs?: number;
}
