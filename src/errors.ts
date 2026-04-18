type ErrorOperation =
  | "discoverCapabilities"
  | "registerWebPushSubscription"
  | "unregister"
  | "parsePushMessage"
  | "buildPushDontNotifyHeaderValue"
  | "retry"
  | "renewal";

export interface ErrorMetadata {
  operation: ErrorOperation;
  status?: number;
  retryable: boolean;
  bodySnippet?: string;
  headersSnapshot: Record<string, string>;
}

const BODY_SNIPPET_MAX_LENGTH = 400;

export abstract class WebDavPushError extends Error {
  readonly metadata: ErrorMetadata;

  constructor(message: string, metadata: ErrorMetadata) {
    super(message);
    this.metadata = metadata;
    this.name = new.target.name;
  }
}

export class TransportError extends WebDavPushError {}

export class HttpStatusError extends WebDavPushError {}

export class ProtocolValidationError extends WebDavPushError {}

export class XmlParseError extends WebDavPushError {}

export class RetryExhaustedError extends WebDavPushError {
  readonly attempts: number;

  constructor(message: string, metadata: ErrorMetadata, attempts: number) {
    super(message, metadata);
    this.attempts = attempts;
  }
}

export function truncateBodySnippet(
  bodyText: string | undefined,
): string | undefined {
  if (!bodyText) {
    return undefined;
  }

  if (bodyText.length <= BODY_SNIPPET_MAX_LENGTH) {
    return bodyText;
  }

  return `${bodyText.slice(0, BODY_SNIPPET_MAX_LENGTH)}...`;
}

export function headersToSnapshot(
  headers: Headers | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  const snapshot: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    snapshot[name.toLowerCase()] = value;
  }
  return snapshot;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}
