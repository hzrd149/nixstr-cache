import { decode, encode } from "@msgpack/msgpack";

export type LinkType = 0 | 1 | 2 | 3;

export interface ManifestLink {
  readonly hash: Uint8Array;
  readonly key?: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly name?: string;
  readonly size: number;
  readonly type: LinkType;
}

export interface FileManifest {
  readonly type: "file";
  readonly links: readonly ManifestLink[];
}
export interface DirectoryManifest {
  readonly type: "directory";
  readonly links: readonly ManifestLink[];
}
export interface FanoutManifest {
  readonly type: "fanout";
  readonly links: readonly ManifestLink[];
}
export type Manifest = FileManifest | DirectoryManifest | FanoutManifest;

export interface ManifestLimits {
  readonly maxWireBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxLinks: number;
}

export class ManifestDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestDataError";
  }
}

const encoder = new TextEncoder();
const ownKeys = (value: object) => Object.keys(value).sort();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  !(value instanceof Uint8Array);
const exactKeys = (value: object, allowed: readonly string[]) => {
  const keys = ownKeys(value);
  if (
    keys.length !== allowed.length ||
    keys.some((key, i) => key !== [...allowed].sort()[i])
  ) {
    throw new ManifestDataError("unexpected or missing manifest field");
  }
};
const uint = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ManifestDataError(`${label} must be a safe unsigned integer`);
  }
  return value as number;
};
const bytes32 = (value: unknown, label: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new ManifestDataError(`${label} must be 32 bytes`);
  }
  return value.slice();
};
const byteCompare = (a: string, b: string): number => {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
};

function jsonMetadata(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new ManifestDataError("metadata must be a map");
  const visit = (v: unknown): unknown => {
    if (
      v === null || typeof v === "string" || typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    ) return v;
    if (Array.isArray(v)) return Object.freeze(v.map(visit));
    if (isRecord(v)) {
      return Object.freeze(
        Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)])),
      );
    }
    throw new ManifestDataError("metadata must be JSON-compatible");
  };
  return visit(value) as Readonly<Record<string, unknown>>;
}

function decodedCost(value: unknown): number {
  if (value === null) return 1;
  if (typeof value === "string") return encoder.encode(value).length;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (value instanceof Uint8Array) return value.length;
  if (Array.isArray(value)) {
    return value.reduce((n, x) => n + decodedCost(x), 0);
  }
  if (isRecord(value)) {
    return Object.entries(value).reduce(
      (n, [k, x]) => n + encoder.encode(k).length + decodedCost(x),
      0,
    );
  }
  return Number.MAX_SAFE_INTEGER;
}

export function decodeManifest(
  wire: Uint8Array,
  limits: ManifestLimits,
): Manifest {
  if (
    !Number.isSafeInteger(limits.maxWireBytes) ||
    wire.length > limits.maxWireBytes
  ) throw new ManifestDataError("manifest wire-size limit exceeded");
  let raw: unknown;
  try {
    raw = decode(wire);
  } catch (cause) {
    throw new ManifestDataError(
      `malformed MessagePack: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  const canonical = encode(raw);
  if (
    canonical.length !== wire.length ||
    canonical.some((byte, i) => byte !== wire[i])
  ) {
    throw new ManifestDataError("manifest is not canonically encoded");
  }
  if (decodedCost(raw) > limits.maxDecodedBytes) {
    throw new ManifestDataError("decoded metadata limit exceeded");
  }
  if (!isRecord(raw)) {
    throw new ManifestDataError("manifest root must be a map");
  }
  exactKeys(raw, ["l", "t"]);
  if (!Array.isArray(raw.l)) {
    throw new ManifestDataError("manifest links must be an array");
  }
  if (raw.l.length > limits.maxLinks) {
    throw new ManifestDataError("links-per-manifest limit exceeded");
  }
  if (raw.t !== 1 && raw.t !== 2 && raw.t !== 3) {
    throw new ManifestDataError("unsupported manifest type");
  }
  const links = raw.l.map((item, index): ManifestLink => {
    if (!isRecord(item)) {
      throw new ManifestDataError(`link ${index} must be a map`);
    }
    const required = raw.t === 2 ? ["h", "n", "s", "t"] : ["h", "s", "t"];
    const optional = ["k", "m"];
    for (const key of ownKeys(item)) {
      if (![...required, ...optional].includes(key)) {
        throw new ManifestDataError(`unknown link field ${key}`);
      }
    }
    for (const key of required) {
      if (!(key in item)) {
        throw new ManifestDataError(`missing link field ${key}`);
      }
    }
    if (item.t !== 0 && item.t !== 1 && item.t !== 2 && item.t !== 3) {
      throw new ManifestDataError("unsupported link type");
    }
    const link: ManifestLink = Object.freeze({
      hash: bytes32(item.h, "link hash"),
      ...(item.k === undefined ? {} : { key: bytes32(item.k, "link key") }),
      ...(item.m === undefined ? {} : { metadata: jsonMetadata(item.m) }),
      ...(item.n === undefined ? {} : {
        name: typeof item.n === "string" ? item.n : (() => {
          throw new ManifestDataError("link name must be UTF-8 text");
        })(),
      }),
      size: uint(item.s, "link size"),
      type: item.t,
    });
    return link;
  });
  if (raw.t === 1) {
    for (const link of links) {
      if (link.name !== undefined || (link.type !== 0 && link.type !== 1)) {
        throw new ManifestDataError("invalid file-manifest link");
      }
    }
    return Object.freeze({ type: "file", links: Object.freeze(links) });
  }
  if (raw.t === 2) {
    let previous: string | undefined;
    for (const link of links) {
      const name = link.name!;
      if (
        !name || name === "." || name === ".." || name.includes("/") ||
        name.includes("\0")
      ) throw new ManifestDataError("unsafe directory name");
      if (previous !== undefined && byteCompare(previous, name) >= 0) {
        throw new ManifestDataError(
          "directory names must be unique and bytewise sorted",
        );
      }
      previous = name;
    }
    return Object.freeze({ type: "directory", links: Object.freeze(links) });
  }
  let priorLast: string | undefined;
  for (const link of links) {
    if (
      link.name !== undefined || (link.type !== 2 && link.type !== 3) ||
      !link.metadata
    ) throw new ManifestDataError("invalid fanout link");
    exactKeys(link.metadata, ["count", "first", "last"]);
    const count = uint(link.metadata.count, "fanout count");
    const first = link.metadata.first, last = link.metadata.last;
    if (
      count === 0 || typeof first !== "string" || typeof last !== "string" ||
      byteCompare(first, last) > 0 ||
      (priorLast !== undefined && byteCompare(priorLast, first) >= 0)
    ) throw new ManifestDataError("invalid or overlapping fanout bounds");
    priorLast = last;
  }
  return Object.freeze({ type: "fanout", links: Object.freeze(links) });
}
