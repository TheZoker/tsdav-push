import { XMLBuilder } from "fast-xml-parser";
import { DavDepth, PushMessage, PushTransportInfo, SupportedTrigger } from "./types.js";
export declare function buildPushPropertiesPropfindBody(): string;
export declare function parsePushPropertiesFromMultistatus(xml: string): {
    transports: PushTransportInfo[];
    topic?: string;
    supportedTriggers: SupportedTrigger[];
    metadata: {
        hasMultistatus: boolean;
        hasResponse: boolean;
        hasOkPropstat: boolean;
        hasPushPropertyNode: boolean;
    };
};
export declare function buildRegisterBody(input: {
    pushResource: string;
    subscriptionPublicKey: string;
    authSecret: string;
    contentEncoding: string;
    requestedExpiration?: Date;
    trigger: {
        contentUpdate?: {
            depth: DavDepth;
        };
        propertyUpdate?: {
            depth: DavDepth;
            properties?: Array<{
                namespace: string;
                name: string;
            }>;
        };
    };
}): string;
export declare function parsePushMessage(xml: string): PushMessage;
export declare function parsePushMessageWithMetadata(xml: string): {
    message: PushMessage;
    metadata: {
        hasPushMessageRoot: boolean;
        hasKnownUpdateNode: boolean;
    };
};
export declare function formatImfFixDate(date: Date): string;
export declare const PUSH_XML_NAMESPACES: {
    push: string;
    dav: string;
};
export declare const xmlBuilder: XMLBuilder;
