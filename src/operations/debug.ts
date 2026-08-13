import { createDebug } from "@grammyjs/debug";

type DebugFields = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;
interface CompactDebug {
  (message: string, fields?: DebugFields): void;
  enabled: boolean;
}

function compactDebug(namespace: string): CompactDebug {
  const debug = createDebug(namespace);
  const compact = (message: string, fields: DebugFields = {}): void => {
    const suffix = Object.entries(fields).map(([key, value]) =>
      `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`
    ).join(" ");
    debug(suffix ? `${message} ${suffix}` : message);
  };
  Object.defineProperty(compact, "enabled", {
    get: () => debug.enabled,
    set: (value: boolean) => debug.enabled = value,
  });
  return compact as CompactDebug;
}

export const debugHttpRequest = compactDebug("nixstr:http:request");
export const debugHttpRoute = compactDebug("nixstr:http:route");
export const debugHttpUpstream = compactDebug("nixstr:http:upstream");
export const debugHashtreeCache = compactDebug("nixstr:hashtree:cache");
export const debugCacheState = compactDebug("nixstr:cache:state");
export const debugWriteHashtreeState = compactDebug(
  "nixstr:write:hashtree",
);

let nextInboundId = 0;
let nextOutboundId = 0;

export function inboundRequestId(): number {
  nextInboundId = nextInboundId === Number.MAX_SAFE_INTEGER
    ? 1
    : nextInboundId + 1;
  return nextInboundId;
}

export function outboundRequestId(): number {
  nextOutboundId = nextOutboundId === Number.MAX_SAFE_INTEGER
    ? 1
    : nextOutboundId + 1;
  return nextOutboundId;
}

export function debugPath(value: string): string {
  const path = value.split(/[?#]/, 1)[0];
  return path.replace(/[^A-Za-z0-9._+\/-]/g, "?");
}

export function debugEndpoint(value: string | URL): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return "invalid";
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "invalid";
  }
}
