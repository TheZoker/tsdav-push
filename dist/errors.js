const BODY_SNIPPET_MAX_LENGTH = 400;
export class WebDavPushError extends Error {
    constructor(message, metadata) {
        super(message);
        this.metadata = metadata;
        this.name = new.target.name;
    }
}
export class TransportError extends WebDavPushError {
}
export class HttpStatusError extends WebDavPushError {
}
export class ProtocolValidationError extends WebDavPushError {
}
export class XmlParseError extends WebDavPushError {
}
export class RetryExhaustedError extends WebDavPushError {
    constructor(message, metadata, attempts) {
        super(message, metadata);
        this.attempts = attempts;
    }
}
export function truncateBodySnippet(bodyText) {
    if (!bodyText) {
        return undefined;
    }
    if (bodyText.length <= BODY_SNIPPET_MAX_LENGTH) {
        return bodyText;
    }
    return `${bodyText.slice(0, BODY_SNIPPET_MAX_LENGTH)}...`;
}
export function headersToSnapshot(headers) {
    if (!headers) {
        return {};
    }
    const snapshot = {};
    for (const [name, value] of headers.entries()) {
        snapshot[name.toLowerCase()] = value;
    }
    return snapshot;
}
export function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}
