import {
  PushMessage,
  RawHttpRequester,
  RegisterWebPushSubscriptionInput,
  RegisterWebPushSubscriptionResult,
  UnregisterResult,
  WebDavPushCapabilities,
} from "./types.js";
import {
  buildPushPropertiesPropfindBody,
  buildRegisterBody,
  parsePushMessage,
  parsePushPropertiesFromMultistatus,
} from "./xml.js";

function isDavPushAdvertised(davHeader: string | null): boolean {
  if (!davHeader) {
    return false;
  }
  return davHeader
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes("webdav-push");
}

export class WebDavPushClient {
  constructor(
    private readonly requester: RawHttpRequester,
    private readonly defaultHeaders?: Record<string, string>,
  ) {}

  async discoverCapabilities(
    resourceUrl: string,
    headers?: Record<string, string>,
  ): Promise<WebDavPushCapabilities> {
    const requestHeaders = {
      ...(this.defaultHeaders ?? {}),
      ...(headers ?? {}),
    };

    const optionsResponse = await this.requester.request({
      url: resourceUrl,
      method: "OPTIONS",
      headers: requestHeaders,
    });

    const davHeader = optionsResponse.headers.get("dav");

    const propfindResponse = await this.requester.request({
      url: resourceUrl,
      method: "PROPFIND",
      headers: {
        depth: "0",
        "content-type": "application/xml; charset=utf-8",
        ...requestHeaders,
      },
      body: buildPushPropertiesPropfindBody(),
    });

    const parsed = parsePushPropertiesFromMultistatus(
      propfindResponse.bodyText,
    );

    return {
      supportedByDavHeader: isDavPushAdvertised(davHeader),
      transports: parsed.transports,
      topic: parsed.topic,
      supportedTriggers: parsed.supportedTriggers,
      rawDavHeader: davHeader ?? undefined,
    };
  }

  async registerWebPushSubscription(
    input: RegisterWebPushSubscriptionInput,
  ): Promise<RegisterWebPushSubscriptionResult> {
    const body = buildRegisterBody({
      pushResource: input.pushResource,
      subscriptionPublicKey: input.subscriptionPublicKey,
      authSecret: input.authSecret,
      contentEncoding: input.contentEncoding ?? "aes128gcm",
      requestedExpiration: input.requestedExpiration,
      trigger: input.trigger,
    });

    const response = await this.requester.request({
      url: input.resourceUrl,
      method: "POST",
      headers: {
        "content-type": "application/xml; charset=utf-8",
        ...(this.defaultHeaders ?? {}),
        ...(input.headers ?? {}),
      },
      body,
    });

    return {
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      expires: parseExpiresHeader(response.headers.get("expires")),
      rawResponseBody: response.bodyText,
    };
  }

  async unregister(
    registrationUrl: string,
    headers?: Record<string, string>,
  ): Promise<UnregisterResult> {
    const response = await this.requester.request({
      url: registrationUrl,
      method: "DELETE",
      headers: {
        ...(this.defaultHeaders ?? {}),
        ...(headers ?? {}),
      },
    });

    return {
      status: response.status,
      removed: response.status === 204,
    };
  }

  parsePushMessage(xml: string): PushMessage {
    return parsePushMessage(xml);
  }

  buildPushDontNotifyHeaderValue(registrationUrls: string[] | "*"): string {
    if (registrationUrls === "*") {
      return "*";
    }

    return registrationUrls.map((url) => `"${url}"`).join(", ");
  }
}

function parseExpiresHeader(expiresHeader: string | null): Date | undefined {
  if (!expiresHeader) {
    return undefined;
  }

  const parsed = new Date(expiresHeader);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
