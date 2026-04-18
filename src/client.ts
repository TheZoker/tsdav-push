import {
  ClientOptions,
  PushMessage,
  RawHttpRequester,
  RegisterWebPushSubscriptionInput,
  RegisterWebPushSubscriptionResult,
  UnregisterResult,
  WebDavPushResult,
  WebDavPushCapabilities,
} from "./types.js";
import {
  buildPushPropertiesPropfindBody,
  buildRegisterBody,
  parsePushMessage,
  parsePushPropertiesFromMultistatus,
} from "./xml.js";
import {
  HttpStatusError,
  ProtocolValidationError,
  TransportError,
  XmlParseError,
  headersToSnapshot,
  isRetryableStatus,
  truncateBodySnippet,
} from "./errors.js";

const DEFAULT_REGISTER_POLICY = {
  isSuccessStatus: (status: number): boolean => status >= 200 && status <= 299,
  requiresLocationOnSuccess: true,
};

const DEFAULT_UNREGISTER_POLICY = {
  isRemovedStatus: (status: number): boolean => status >= 200 && status <= 299,
  isAlreadyMissingStatus: (status: number): boolean => status === 404,
};

function isClientOptions(
  value: Record<string, string> | ClientOptions | undefined,
): value is ClientOptions {
  if (!value) {
    return false;
  }

  return (
    "defaultHeaders" in value ||
    "strictMode" in value ||
    "parseDiagnostics" in value ||
    "registerPolicy" in value ||
    "unregisterPolicy" in value
  );
}

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
  private readonly defaultHeaders?: Record<string, string>;
  private readonly options?: ClientOptions;

  constructor(
    private readonly requester: RawHttpRequester,
    defaultHeadersOrOptions?: Record<string, string> | ClientOptions,
  ) {
    if (defaultHeadersOrOptions && !isClientOptions(defaultHeadersOrOptions)) {
      this.defaultHeaders = defaultHeadersOrOptions;
      this.options = { defaultHeaders: defaultHeadersOrOptions };
      return;
    }

    this.options = defaultHeadersOrOptions;
    this.defaultHeaders = defaultHeadersOrOptions?.defaultHeaders;
  }

  async discoverCapabilities(
    resourceUrl: string,
    headers?: Record<string, string>,
  ): Promise<WebDavPushResult<WebDavPushCapabilities>> {
    const requestHeaders = {
      ...(this.defaultHeaders ?? {}),
      ...(headers ?? {}),
    };

    let optionsResponse;
    try {
      optionsResponse = await this.requester.request({
        url: resourceUrl,
        method: "OPTIONS",
        headers: requestHeaders,
      });
    } catch (error) {
      return {
        ok: false,
        error: new TransportError("OPTIONS request failed.", {
          operation: "discoverCapabilities",
          retryable: true,
          headersSnapshot: {},
        }),
      };
    }

    if (optionsResponse.status < 200 || optionsResponse.status > 299) {
      return {
        ok: false,
        error: new HttpStatusError(
          `OPTIONS returned unexpected status ${optionsResponse.status}.`,
          {
            operation: "discoverCapabilities",
            status: optionsResponse.status,
            retryable: isRetryableStatus(optionsResponse.status),
            bodySnippet: truncateBodySnippet(optionsResponse.bodyText),
            headersSnapshot: headersToSnapshot(optionsResponse.headers),
          },
        ),
      };
    }

    const davHeader = optionsResponse.headers.get("dav");

    let propfindResponse;
    try {
      propfindResponse = await this.requester.request({
        url: resourceUrl,
        method: "PROPFIND",
        headers: {
          depth: "0",
          "content-type": "application/xml; charset=utf-8",
          ...requestHeaders,
        },
        body: buildPushPropertiesPropfindBody(),
      });
    } catch {
      return {
        ok: false,
        error: new TransportError("PROPFIND request failed.", {
          operation: "discoverCapabilities",
          retryable: true,
          headersSnapshot: {},
        }),
      };
    }

    if (
      !(
        propfindResponse.status === 207 ||
        (propfindResponse.status >= 200 && propfindResponse.status <= 299)
      )
    ) {
      return {
        ok: false,
        error: new HttpStatusError(
          `PROPFIND returned unexpected status ${propfindResponse.status}.`,
          {
            operation: "discoverCapabilities",
            status: propfindResponse.status,
            retryable: isRetryableStatus(propfindResponse.status),
            bodySnippet: truncateBodySnippet(propfindResponse.bodyText),
            headersSnapshot: headersToSnapshot(propfindResponse.headers),
          },
        ),
      };
    }

    let parsed;
    try {
      parsed = parsePushPropertiesFromMultistatus(propfindResponse.bodyText);
    } catch {
      return {
        ok: false,
        error: new XmlParseError("Failed to parse PROPFIND multistatus XML.", {
          operation: "discoverCapabilities",
          status: propfindResponse.status,
          retryable: false,
          bodySnippet: truncateBodySnippet(propfindResponse.bodyText),
          headersSnapshot: headersToSnapshot(propfindResponse.headers),
        }),
      };
    }

    const strictMode = this.options?.strictMode ?? true;
    if (
      strictMode &&
      (!parsed.metadata.hasMultistatus ||
        !parsed.metadata.hasResponse ||
        !parsed.metadata.hasOkPropstat)
    ) {
      const diagnostics = this.options?.parseDiagnostics
        ? ` hasMultistatus=${parsed.metadata.hasMultistatus}, hasResponse=${parsed.metadata.hasResponse}, hasOkPropstat=${parsed.metadata.hasOkPropstat}, hasPushPropertyNode=${parsed.metadata.hasPushPropertyNode}`
        : "";

      return {
        ok: false,
        error: new ProtocolValidationError(
          `PROPFIND multistatus response is missing required DAV structure.${diagnostics}`,
          {
            operation: "discoverCapabilities",
            status: propfindResponse.status,
            retryable: false,
            bodySnippet: truncateBodySnippet(propfindResponse.bodyText),
            headersSnapshot: headersToSnapshot(propfindResponse.headers),
          },
        ),
      };
    }

    const webPushTransport = parsed.transports.find(
      (item) => item.id === "web-push",
    );
    const hasVapidPublicKey = Boolean(webPushTransport?.vapidPublicKey?.value);

    return {
      ok: true,
      value: {
        supportedByDavHeader: isDavPushAdvertised(davHeader),
        transports: parsed.transports,
        topic: parsed.topic,
        supportedTriggers: parsed.supportedTriggers,
        rawDavHeader: davHeader ?? undefined,
        webPush: {
          available: Boolean(webPushTransport),
          hasVapidPublicKey,
          missingVapidPublicKey:
            Boolean(webPushTransport) && !hasVapidPublicKey,
        },
      },
    };
  }

  async registerWebPushSubscription(
    input: RegisterWebPushSubscriptionInput,
  ): Promise<WebDavPushResult<RegisterWebPushSubscriptionResult>> {
    if (!input.trigger.contentUpdate && !input.trigger.propertyUpdate) {
      return {
        ok: false,
        error: new ProtocolValidationError(
          "At least one trigger is required for registration.",
          {
            operation: "registerWebPushSubscription",
            retryable: false,
            headersSnapshot: {},
          },
        ),
      };
    }

    let body: string;
    try {
      body = buildRegisterBody({
        pushResource: input.pushResource,
        subscriptionPublicKey: input.subscriptionPublicKey,
        authSecret: input.authSecret,
        contentEncoding: input.contentEncoding ?? "aes128gcm",
        requestedExpiration: input.requestedExpiration,
        trigger: input.trigger,
      });
    } catch {
      return {
        ok: false,
        error: new ProtocolValidationError(
          "Failed to build push-register XML body.",
          {
            operation: "registerWebPushSubscription",
            retryable: false,
            headersSnapshot: {},
          },
        ),
      };
    }

    let response;
    try {
      response = await this.requester.request({
        url: input.resourceUrl,
        method: "POST",
        headers: {
          "content-type": "application/xml; charset=utf-8",
          ...(this.defaultHeaders ?? {}),
          ...(input.headers ?? {}),
        },
        body,
      });
    } catch {
      return {
        ok: false,
        error: new TransportError("Registration request failed.", {
          operation: "registerWebPushSubscription",
          retryable: true,
          headersSnapshot: {},
        }),
      };
    }

    const registerPolicy = {
      ...DEFAULT_REGISTER_POLICY,
      ...(this.options?.registerPolicy ?? {}),
    };

    if (!registerPolicy.isSuccessStatus(response.status)) {
      return {
        ok: false,
        error: new HttpStatusError(
          `Registration returned unexpected status ${response.status}.`,
          {
            operation: "registerWebPushSubscription",
            status: response.status,
            retryable: isRetryableStatus(response.status),
            bodySnippet: truncateBodySnippet(response.bodyText),
            headersSnapshot: headersToSnapshot(response.headers),
          },
        ),
      };
    }

    const location = response.headers.get("location") ?? undefined;
    const parsedExpires = parseExpiresHeader(response.headers.get("expires"));
    if (response.headers.has("expires") && !parsedExpires) {
      return {
        ok: false,
        error: new ProtocolValidationError(
          "Registration returned invalid Expires header.",
          {
            operation: "registerWebPushSubscription",
            status: response.status,
            retryable: false,
            bodySnippet: truncateBodySnippet(response.bodyText),
            headersSnapshot: headersToSnapshot(response.headers),
          },
        ),
      };
    }

    if (registerPolicy.requiresLocationOnSuccess && !location) {
      return {
        ok: false,
        error: new ProtocolValidationError(
          "Registration success response is missing Location header.",
          {
            operation: "registerWebPushSubscription",
            status: response.status,
            retryable: false,
            bodySnippet: truncateBodySnippet(response.bodyText),
            headersSnapshot: headersToSnapshot(response.headers),
          },
        ),
      };
    }

    return {
      ok: true,
      value: {
        status: response.status,
        location,
        expires: parsedExpires,
        rawResponseBody: response.bodyText,
      },
    };
  }

  async unregister(
    registrationUrl: string,
    headers?: Record<string, string>,
  ): Promise<WebDavPushResult<UnregisterResult>> {
    let response;
    try {
      response = await this.requester.request({
        url: registrationUrl,
        method: "DELETE",
        headers: {
          ...(this.defaultHeaders ?? {}),
          ...(headers ?? {}),
        },
      });
    } catch {
      return {
        ok: false,
        error: new TransportError("Unregister request failed.", {
          operation: "unregister",
          retryable: true,
          headersSnapshot: {},
        }),
      };
    }

    const unregisterPolicy = {
      ...DEFAULT_UNREGISTER_POLICY,
      ...(this.options?.unregisterPolicy ?? {}),
    };

    if (unregisterPolicy.isRemovedStatus(response.status)) {
      return {
        ok: true,
        value: {
          status: response.status,
          removed: true,
          reason: "removed",
        },
      };
    }

    if (unregisterPolicy.isAlreadyMissingStatus(response.status)) {
      return {
        ok: true,
        value: {
          status: response.status,
          removed: false,
          reason: "already-missing",
        },
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: true,
        value: {
          status: response.status,
          removed: false,
          reason: "unauthorized",
        },
      };
    }

    if (response.status >= 500 && response.status <= 599) {
      return {
        ok: true,
        value: {
          status: response.status,
          removed: false,
          reason: "server-error",
        },
      };
    }

    return {
      ok: true,
      value: {
        status: response.status,
        removed: false,
        reason: "unexpected-status",
      },
    };
  }

  parsePushMessage(xml: string): WebDavPushResult<PushMessage> {
    try {
      return {
        ok: true,
        value: parsePushMessage(xml),
      };
    } catch {
      return {
        ok: false,
        error: new XmlParseError("Failed to parse push-message XML.", {
          operation: "parsePushMessage",
          retryable: false,
          headersSnapshot: {},
          bodySnippet: truncateBodySnippet(xml),
        }),
      };
    }
  }

  buildPushDontNotifyHeaderValue(
    registrationUrls: string[] | "*",
  ): WebDavPushResult<string> {
    if (registrationUrls === "*") {
      return { ok: true, value: "*" };
    }

    if (registrationUrls.length === 0) {
      return {
        ok: false,
        error: new ProtocolValidationError(
          "Push-Dont-Notify URL list must not be empty.",
          {
            operation: "buildPushDontNotifyHeaderValue",
            retryable: false,
            headersSnapshot: {},
          },
        ),
      };
    }

    for (const url of registrationUrls) {
      if (/\r|\n/.test(url) || url.includes('"') || url.includes(",")) {
        return {
          ok: false,
          error: new ProtocolValidationError(
            "Push-Dont-Notify URL contains illegal characters.",
            {
              operation: "buildPushDontNotifyHeaderValue",
              retryable: false,
              headersSnapshot: {},
            },
          ),
        };
      }

      try {
        new URL(url);
      } catch {
        return {
          ok: false,
          error: new ProtocolValidationError(
            "Push-Dont-Notify URL is not a valid absolute URL.",
            {
              operation: "buildPushDontNotifyHeaderValue",
              retryable: false,
              headersSnapshot: {},
            },
          ),
        };
      }
    }

    return {
      ok: true,
      value: registrationUrls.map((url) => `"${url}"`).join(", "),
    };
  }
}

function parseExpiresHeader(expiresHeader: string | null): Date | undefined {
  if (!expiresHeader) {
    return undefined;
  }

  const parsed = new Date(expiresHeader);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
