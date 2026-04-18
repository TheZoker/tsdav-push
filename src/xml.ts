import { XMLBuilder, XMLParser } from "fast-xml-parser";

import {
  DavDepth,
  PushMessage,
  PushTransportInfo,
  SupportedTrigger,
} from "./types.js";

const PUSH_NS = "https://bitfire.at/webdav-push";
const DAV_NS = "DAV:";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) =>
    name === "response" || name === "propstat" || name === "prop",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseDepth(value: string | undefined): DavDepth | undefined {
  if (value === "0" || value === "1" || value === "infinity") {
    return value;
  }
  return undefined;
}

function pickPushProp(multistatus: any): any | undefined {
  const responses = asArray(multistatus?.multistatus?.response);
  const okPropstats = responses
    .flatMap((response) => asArray(response?.propstat))
    .filter((propstat) => String(propstat?.status ?? "").includes(" 200 "));

  for (const propstat of okPropstats) {
    const prop = propstat?.prop;
    if (prop && (prop.transports || prop.topic || prop["supported-triggers"])) {
      return prop;
    }
  }

  return undefined;
}

export function buildPushPropertiesPropfindBody(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<d:propfind xmlns:d="${DAV_NS}" xmlns:p="${PUSH_NS}">`,
    "  <d:prop>",
    "    <p:transports/>",
    "    <p:topic/>",
    "    <p:supported-triggers/>",
    "  </d:prop>",
    "</d:propfind>",
  ].join("\n");
}

export function parsePushPropertiesFromMultistatus(xml: string): {
  transports: PushTransportInfo[];
  topic?: string;
  supportedTriggers: SupportedTrigger[];
} {
  const parsed = parser.parse(xml);
  const prop = pickPushProp(parsed);

  if (!prop) {
    return { transports: [], supportedTriggers: [] };
  }

  const transportsValue = prop.transports;
  const transportEntries: PushTransportInfo[] = [];
  if (transportsValue && typeof transportsValue === "object") {
    const keys = Object.keys(transportsValue);
    for (const key of keys) {
      const entry = transportsValue[key];
      const transport: PushTransportInfo = { id: key };
      if (key === "web-push" && entry && typeof entry === "object") {
        const vapid = entry["vapid-public-key"];
        if (typeof vapid === "string") {
          transport.vapidPublicKey = { value: vapid };
        } else if (vapid && typeof vapid === "object") {
          transport.vapidPublicKey = {
            value: vapid["#text"] ?? "",
            type: vapid["@_type"],
          };
        }
      }
      transportEntries.push(transport);
    }
  }

  const triggers: SupportedTrigger[] = [];
  const triggerNode = prop["supported-triggers"];
  if (triggerNode && typeof triggerNode === "object") {
    const contentDepth = parseDepth(triggerNode["content-update"]?.depth);
    if (contentDepth) {
      triggers.push({ type: "content-update", depth: contentDepth });
    }

    const propertyDepth = parseDepth(triggerNode["property-update"]?.depth);
    if (propertyDepth) {
      triggers.push({ type: "property-update", depth: propertyDepth });
    }
  }

  return {
    transports: transportEntries,
    topic: typeof prop.topic === "string" ? prop.topic : undefined,
    supportedTriggers: triggers,
  };
}

export function buildRegisterBody(input: {
  pushResource: string;
  subscriptionPublicKey: string;
  authSecret: string;
  contentEncoding: string;
  requestedExpiration?: Date;
  trigger: {
    contentUpdate?: { depth: DavDepth };
    propertyUpdate?: {
      depth: DavDepth;
      properties?: Array<{ namespace: string; name: string }>;
    };
  };
}): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(`<p:push-register xmlns:p="${PUSH_NS}" xmlns:d="${DAV_NS}">`);
  lines.push("  <p:subscription>");
  lines.push("    <p:web-push-subscription>");
  lines.push(
    `      <p:push-resource>${escapeXml(input.pushResource)}</p:push-resource>`,
  );
  lines.push(
    `      <p:content-encoding>${escapeXml(input.contentEncoding)}</p:content-encoding>`,
  );
  lines.push(
    `      <p:subscription-public-key type=\"p256dh\">${escapeXml(input.subscriptionPublicKey)}</p:subscription-public-key>`,
  );
  lines.push(
    `      <p:auth-secret>${escapeXml(input.authSecret)}</p:auth-secret>`,
  );
  lines.push("    </p:web-push-subscription>");
  lines.push("  </p:subscription>");
  lines.push("  <p:trigger>");

  if (input.trigger.contentUpdate) {
    lines.push("    <p:content-update>");
    lines.push(`      <d:depth>${input.trigger.contentUpdate.depth}</d:depth>`);
    lines.push("    </p:content-update>");
  }

  if (input.trigger.propertyUpdate) {
    lines.push("    <p:property-update>");
    lines.push(
      `      <d:depth>${input.trigger.propertyUpdate.depth}</d:depth>`,
    );

    const props = input.trigger.propertyUpdate.properties;
    if (props && props.length > 0) {
      lines.push("      <d:prop>");
      for (const prop of props) {
        lines.push(
          `        <x:${escapeXml(prop.name)} xmlns:x=\"${escapeXml(prop.namespace)}\"/>`,
        );
      }
      lines.push("      </d:prop>");
    }

    lines.push("    </p:property-update>");
  }

  lines.push("  </p:trigger>");

  if (input.requestedExpiration) {
    lines.push(
      `  <p:expires>${formatImfFixDate(input.requestedExpiration)}</p:expires>`,
    );
  }

  lines.push("</p:push-register>");

  return lines.join("\n");
}

export function parsePushMessage(xml: string): PushMessage {
  const parsed = parser.parse(xml);
  const root =
    parsed?.["push-message"] ??
    parsed?.["p:push-message"] ??
    parsed?.pushMessage;

  if (!root || typeof root !== "object") {
    return {
      topic: undefined,
      hasContentUpdate: false,
      hasPropertyUpdate: false,
      syncToken: undefined,
      changedProperties: [],
    };
  }

  const contentUpdate = root["content-update"];
  const propertyUpdate = root["property-update"];

  const changedProperties: Array<{ namespace: string; name: string }> = [];
  const propNode = propertyUpdate?.prop;
  if (propNode && typeof propNode === "object") {
    for (const [name, value] of Object.entries(propNode)) {
      const ns = (value as any)?.["@_xmlns"];
      changedProperties.push({
        namespace: typeof ns === "string" ? ns : "",
        name,
      });
    }
  }

  return {
    topic: typeof root.topic === "string" ? root.topic : undefined,
    hasContentUpdate: Boolean(contentUpdate),
    hasPropertyUpdate: Boolean(propertyUpdate),
    syncToken: contentUpdate?.["sync-token"],
    changedProperties,
  };
}

export function formatImfFixDate(date: Date): string {
  return date.toUTCString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const PUSH_XML_NAMESPACES = {
  push: PUSH_NS,
  dav: DAV_NS,
};

export const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
});
