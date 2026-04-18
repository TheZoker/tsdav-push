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
  isArray: (name) => name === "response" || name === "propstat",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseDepth(value: string | number | undefined): DavDepth | undefined {
  const normalized = typeof value === "number" ? String(value) : value;

  if (normalized === "0" || normalized === "1" || normalized === "infinity") {
    return normalized;
  }

  return undefined;
}

function extractChangedPropertiesFromRawXml(
  xml: string,
): Array<{ namespace: string; name: string }> {
  const namespaceMap = new Map<string, string>();
  const xmlnsRegex = /xmlns:([A-Za-z_][\w.-]*)="([^"]+)"/g;
  let xmlnsMatch: RegExpExecArray | null;
  while ((xmlnsMatch = xmlnsRegex.exec(xml)) !== null) {
    namespaceMap.set(xmlnsMatch[1], xmlnsMatch[2]);
  }

  const propBlockMatch = xml.match(
    /<[^>]*property-update[^>]*>[\s\S]*?<[^>]*prop[^>]*>([\s\S]*?)<\/[^>]*prop>/i,
  );
  if (!propBlockMatch?.[1]) {
    return [];
  }

  const result: Array<{ namespace: string; name: string }> = [];
  const seen = new Set<string>();
  const tagRegex = /<([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)(\s|\/|>)/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(propBlockMatch[1])) !== null) {
    const prefix = tagMatch[1];
    const name = tagMatch[2];
    if (prefix === "d" || prefix === "p") {
      continue;
    }

    const namespace = namespaceMap.get(prefix) ?? "";
    const key = `${namespace}:${name}`;
    if (!seen.has(key)) {
      result.push({ namespace, name });
      seen.add(key);
    }
  }

  return result;
}

function parseDepthFromTriggerNode(node: any): DavDepth | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  return parseDepth(node.depth);
}

function parseSupportedTriggers(triggerNode: any): SupportedTrigger[] {
  const triggers: SupportedTrigger[] = [];

  const contentDepth = parseDepthFromTriggerNode(
    triggerNode?.["content-update"],
  );
  if (contentDepth) {
    triggers.push({ type: "content-update", depth: contentDepth });
  }

  const propertyDepth = parseDepthFromTriggerNode(
    triggerNode?.["property-update"],
  );
  if (propertyDepth) {
    triggers.push({ type: "property-update", depth: propertyDepth });
  }

  return triggers;
}

function normalizeSupportedTriggersNode(triggerNode: any): any {
  if (Array.isArray(triggerNode)) {
    return triggerNode[0];
  }

  return triggerNode;
}

function normalizePropNode(propNode: any): any {
  if (Array.isArray(propNode)) {
    return propNode[0];
  }

  return propNode;
}

function normalizePushProperties(parsed: any): any | undefined {
  const prop = pickPushProp(parsed);
  if (!prop || typeof prop !== "object") {
    return undefined;
  }

  return {
    ...prop,
    "supported-triggers": normalizeSupportedTriggersNode(
      prop["supported-triggers"],
    ),
  };
}

function normalizePushMessageRoot(root: any): any {
  if (!root || typeof root !== "object") {
    return root;
  }

  return {
    ...root,
    "property-update": root["property-update"]
      ? {
          ...root["property-update"],
          prop: normalizePropNode(root["property-update"].prop),
        }
      : root["property-update"],
  };
}

function parsePushMessageRoot(parsed: any): any {
  return normalizePushMessageRoot(
    parsed?.["push-message"] ??
      parsed?.["p:push-message"] ??
      parsed?.pushMessage,
  );
}

function parseChangedProperties(
  root: any,
  xml: string,
): Array<{ namespace: string; name: string }> {
  const fromRawXml = extractChangedPropertiesFromRawXml(xml);
  if (fromRawXml.length > 0) {
    return fromRawXml;
  }

  const changedProperties: Array<{ namespace: string; name: string }> = [];
  const propNode = root?.["property-update"]?.prop;

  if (propNode && typeof propNode === "object") {
    for (const [name, value] of Object.entries(propNode)) {
      if (name.startsWith("@_")) {
        continue;
      }

      const xmlValue = value as Record<string, unknown>;
      const xmlnsEntry = Object.entries(xmlValue ?? {}).find(([key]) =>
        key.startsWith("@_xmlns"),
      );
      const namespace =
        typeof xmlnsEntry?.[1] === "string" ? (xmlnsEntry[1] as string) : "";

      changedProperties.push({ namespace, name });
    }
  }

  return changedProperties;
}

function parsePushTopic(prop: any): string | undefined {
  return typeof prop.topic === "string" ? prop.topic : undefined;
}

function parseTransports(prop: any): PushTransportInfo[] {
  const transportsValue = prop.transports;
  const transportEntries: PushTransportInfo[] = [];

  if (!transportsValue || typeof transportsValue !== "object") {
    return transportEntries;
  }

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

  return transportEntries;
}

function parseSyncToken(root: any): string | undefined {
  return root?.["content-update"]?.["sync-token"];
}

function parseHasContentUpdate(root: any): boolean {
  return Boolean(root?.["content-update"]);
}

function parseHasPropertyUpdate(root: any): boolean {
  return Boolean(root?.["property-update"]);
}

function parsePushMessageTopic(root: any): string | undefined {
  return typeof root?.topic === "string" ? root.topic : undefined;
}

function parsePushProperties(xml: string): {
  transports: PushTransportInfo[];
  topic?: string;
  supportedTriggers: SupportedTrigger[];
} {
  const parsed = parser.parse(xml);
  const prop = normalizePushProperties(parsed);

  if (!prop) {
    return { transports: [], supportedTriggers: [] };
  }

  return {
    transports: parseTransports(prop),
    topic: parsePushTopic(prop),
    supportedTriggers: parseSupportedTriggers(prop["supported-triggers"]),
  };
}

function parsePushMessageFromXml(xml: string): PushMessage {
  const parsed = parser.parse(xml);
  const root = parsePushMessageRoot(parsed);

  if (!root || typeof root !== "object") {
    return {
      topic: undefined,
      hasContentUpdate: false,
      hasPropertyUpdate: false,
      syncToken: undefined,
      changedProperties: [],
    };
  }

  return {
    topic: parsePushMessageTopic(root),
    hasContentUpdate: parseHasContentUpdate(root),
    hasPropertyUpdate: parseHasPropertyUpdate(root),
    syncToken: parseSyncToken(root),
    changedProperties: parseChangedProperties(root, xml),
  };
}

function pickPushProp(multistatus: any): any | undefined {
  const responses = asArray(multistatus?.multistatus?.response);
  const okPropstats = responses
    .flatMap((response) => asArray(response?.propstat))
    .filter((propstat) => String(propstat?.status ?? "").includes(" 200 "));

  for (const propstat of okPropstats) {
    const rawProp = propstat?.prop;
    const prop = Array.isArray(rawProp) ? rawProp[0] : rawProp;
    if (
      prop &&
      typeof prop === "object" &&
      (prop.transports || prop.topic || prop["supported-triggers"])
    ) {
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
  return parsePushProperties(xml);
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
  return parsePushMessageFromXml(xml);
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
