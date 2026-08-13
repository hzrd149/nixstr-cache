import { nip19 } from "nostr-tools";

export interface Limits {
  readonly manifestWireBytes: number;
  readonly decodedMetadataBytes: number;
  readonly blobTransferBytes: number;
  readonly requestTransferBytes: number;
  readonly requestOutputBytes: number;
  readonly traversalDepth: number;
  readonly linksPerNode: number;
  readonly uniqueManifestNodes: number;
  readonly totalDecodedManifestBytes: number;
  readonly sourceAttempts: number;
  readonly maxRedirects: number;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly concurrentFetches: number;
}

export interface RawConfig {
  readonly bindHost?: string;
  readonly bindPort?: string | number;
  readonly caches?: string | readonly string[];
  readonly relayUrls?: string | readonly string[];
  readonly preferredBlossomUrl?: string;
  readonly localBlossomUrl?: string;
  readonly databasePath?: string;
  readonly spoolDirectory?: string;
  readonly writable?: RawWritableConfig;
  readonly limits?: Partial<Record<keyof Limits, string | number>>;
}

export interface RawWritableConfig {
  readonly enabled?: boolean | string;
  readonly type?: string;
  readonly name?: string;
  readonly signer?: {
    readonly type?: string;
    readonly path?: string;
    readonly ncryptsec?: string;
  };
  readonly staging?: {
    readonly directory?: string;
    readonly bodyBytes?: string | number;
    readonly aggregateBytes?: string | number;
  };
  readonly publication?: {
    readonly nixSigKeys?: string | readonly string[];
    readonly lifetimeSeconds?: string | number;
    readonly localRelayUrl?: string;
    readonly concurrency?: string | number;
    readonly maxAttempts?: string | number;
  };
}

interface NormalizedRawConfig extends Omit<RawConfig, "bindPort" | "limits"> {
  readonly bindPort?: string;
  readonly caches?: string | readonly string[];
  readonly relayUrls?: string | readonly string[];
  readonly limits?: Partial<Record<keyof Limits, string>>;
}

export interface CacheIdentity {
  readonly kind: 17091 | 37091;
  readonly pubkey: string;
  readonly identifier: string;
}

export interface WritableIdentity {
  readonly kind: 17091 | 37091;
  readonly identifier: string;
}

export const MAX_CACHE_IDENTITIES = 32;

export type WriteIntent =
  | { readonly mode: "disabled" }
  | {
    readonly mode: "nip46" | "local";
    readonly identity: WritableIdentity;
    readonly signerPath: string;
  }
  | {
    readonly mode: "ncryptsec";
    readonly identity: WritableIdentity;
    readonly ncryptsec: string;
  };

export type ValidatedWritableConfig =
  | { readonly enabled: false }
  | {
    readonly enabled: true;
    readonly identity: WritableIdentity;
    readonly signer:
      | { readonly type: "local" | "nip46"; readonly path: string }
      | { readonly type: "ncryptsec"; readonly ncryptsec: string };
    readonly staging: {
      readonly directory: string;
      readonly bodyBytes: number;
      readonly aggregateBytes: number;
    };
    readonly publication: {
      readonly nixSigKeys: readonly string[];
      readonly lifetimeSeconds: number;
      readonly localRelayUrl?: URL;
      readonly concurrency: number;
      readonly maxAttempts: number;
    };
  };

export interface ValidatedConfig {
  readonly bindHost: string;
  readonly bindPort: number;
  readonly publisherPubkeys: readonly string[];
  readonly relayUrls: readonly URL[];
  readonly preferredBlossomUrl?: URL;
  readonly localBlossomUrl?: URL;
  readonly databasePath: string;
  readonly spoolDirectory: string;
  readonly identities: readonly string[];
  readonly writeIntent: WriteIntent;
  readonly writable: ValidatedWritableConfig;
  readonly limits: Limits;
}

export interface ConfigDiagnostic {
  readonly field: string;
  readonly code: "required" | "invalid" | "out_of_range";
  readonly message: string;
}

export type ConfigResult =
  | {
    readonly ok: true;
    readonly value: ValidatedConfig;
    readonly diagnostics: readonly [];
  }
  | { readonly ok: false; readonly diagnostics: readonly ConfigDiagnostic[] };

export interface ParseConfigHooks {
  /** Test-only tripwire proving validation never invokes a side effect. */
  readonly onSideEffect?: () => void;
}

const LIMIT_SPECS: {
  readonly [K in keyof Limits]: {
    readonly defaultValue: number;
    readonly ceiling: number;
  };
} = {
  manifestWireBytes: {
    defaultValue: 4 * 1024 * 1024,
    ceiling: 32 * 1024 * 1024,
  },
  decodedMetadataBytes: { defaultValue: 1024 * 1024, ceiling: 8 * 1024 * 1024 },
  blobTransferBytes: {
    defaultValue: 256 * 1024 * 1024,
    ceiling: 4 * 1024 * 1024 * 1024,
  },
  requestTransferBytes: {
    defaultValue: 1024 * 1024 * 1024,
    ceiling: 8 * 1024 * 1024 * 1024,
  },
  requestOutputBytes: {
    defaultValue: 1024 * 1024 * 1024,
    ceiling: 8 * 1024 * 1024 * 1024,
  },
  traversalDepth: { defaultValue: 32, ceiling: 128 },
  linksPerNode: { defaultValue: 174, ceiling: 1024 },
  uniqueManifestNodes: { defaultValue: 2048, ceiling: 16_384 },
  totalDecodedManifestBytes: {
    defaultValue: 64 * 1024 * 1024,
    ceiling: 512 * 1024 * 1024,
  },
  sourceAttempts: { defaultValue: 10, ceiling: 32 },
  maxRedirects: { defaultValue: 3, ceiling: 8 },
  connectTimeoutMs: { defaultValue: 5_000, ceiling: 30_000 },
  idleTimeoutMs: { defaultValue: 30_000, ceiling: 300_000 },
  totalTimeoutMs: { defaultValue: 300_000, ceiling: 1_800_000 },
  concurrentFetches: { defaultValue: 8, ceiling: 64 },
};

function parseUrl(
  value: string,
  field: string,
  diagnostics: ConfigDiagnostic[],
): URL | undefined {
  try {
    const url = new URL(value);
    if (
      !(["http:", "https:"] as string[]).includes(url.protocol) ||
      url.username || url.password
    ) {
      throw new TypeError("URL must be HTTP(S) without userinfo");
    }
    return url;
  } catch {
    diagnostics.push({
      field,
      code: "invalid",
      message: `${field} must be an absolute HTTP(S) URL without userinfo`,
    });
    return undefined;
  }
}

export function parseConfig(
  input: RawConfig,
  _hooks: ParseConfigHooks = {},
): ConfigResult {
  const diagnostics: ConfigDiagnostic[] = [];
  const raw = normalizeRawConfig(input, diagnostics);
  const bindHost = raw.bindHost?.trim() || "127.0.0.1";
  const portText = raw.bindPort?.trim() || "8787";
  const bindPort = Number(portText);
  if (!Number.isSafeInteger(bindPort) || bindPort < 1 || bindPort > 65_535) {
    diagnostics.push({
      field: "bindPort",
      code: "out_of_range",
      message: "bindPort must be an integer from 1 through 65535",
    });
  }

  const identityValues = listValues(raw.caches);
  if (identityValues.length === 0) {
    diagnostics.push({
      field: "caches",
      code: "required",
      message: "at least one cache identity is required",
    });
  }
  if (identityValues.length > MAX_CACHE_IDENTITIES) {
    diagnostics.push({
      field: "caches",
      code: "out_of_range",
      message: `cache identities must not exceed ${MAX_CACHE_IDENTITIES}`,
    });
  }
  const parsedIdentities: CacheIdentity[] = [];
  const normalizedIdentities: string[] = [];
  const seenIdentities = new Set<string>();
  for (const [index, value] of identityValues.entries()) {
    const parsed = parseReadCacheIdentity(
      value,
      `caches[${index}]`,
      diagnostics,
    );
    if (!parsed) continue;
    const canonical = formatCacheIdentity(parsed);
    if (seenIdentities.has(canonical)) {
      diagnostics.push({
        field: `caches[${index}]`,
        code: "invalid",
        message: "cache identities must be unique",
      });
    }
    seenIdentities.add(canonical);
    parsedIdentities.push(parsed);
    normalizedIdentities.push(canonical);
  }
  const publisherValues = [
    ...new Set(parsedIdentities.map((item) => item.pubkey)),
  ];

  const relayValues = listValues(raw.relayUrls);
  if (relayValues.length === 0) {
    diagnostics.push({
      field: "relayUrls",
      code: "required",
      message: "at least one relay URL is required",
    });
  }
  const relayUrls: URL[] = [];
  const seenRelays = new Set<string>();
  if (relayValues.length > 32) {
    diagnostics.push({
      field: "relayUrls",
      code: "out_of_range",
      message: "relay URLs must not exceed 32",
    });
  }
  for (const [index, value] of relayValues.entries()) {
    try {
      const url = new URL(value);
      if (
        !(url.protocol === "ws:" || url.protocol === "wss:") || url.username ||
        url.password
      ) throw new TypeError();
      if (seenRelays.has(url.href)) throw new TypeError();
      seenRelays.add(url.href);
      relayUrls.push(url);
    } catch {
      diagnostics.push({
        field: `relayUrls[${index}]`,
        code: "invalid",
        message: "relay URLs must be absolute WS(S) URLs without userinfo",
      });
    }
  }

  const preferredBlossomUrl = raw.preferredBlossomUrl
    ? parseUrl(raw.preferredBlossomUrl, "preferredBlossomUrl", diagnostics)
    : undefined;
  const localBlossomUrl = raw.localBlossomUrl
    ? parseUrl(raw.localBlossomUrl, "localBlossomUrl", diagnostics)
    : undefined;
  const databasePath = parseOwnerPath(
    raw.databasePath,
    "databasePath",
    diagnostics,
  );
  const spoolDirectory = parseOwnerPath(
    raw.spoolDirectory,
    "spoolDirectory",
    diagnostics,
  );
  const writableRaw = raw.writable;
  const writableEnabled = writableRaw?.enabled === true ||
    writableRaw?.enabled === "true";
  if (
    writableRaw?.enabled !== undefined &&
    ![true, false, "true", "false"].includes(writableRaw.enabled)
  ) {
    diagnostics.push({
      field: "writable.enabled",
      code: "invalid",
      message: "writable.enabled must be a boolean",
    });
  }
  const writableType = writableEnabled ? writableRaw?.type?.trim() : undefined;
  if (writableEnabled && writableType !== "root" && writableType !== "named") {
    diagnostics.push({
      field: "writable.type",
      code: "invalid",
      message: "writable.type must be root or named",
    });
  }
  const writableName = writableRaw?.name?.trim();
  let writableIdentity: WritableIdentity | undefined;
  if (writableEnabled && writableType === "root") {
    if (writableRaw?.name !== undefined) {
      diagnostics.push({
        field: "writable.name",
        code: "invalid",
        message: "writable.name must be absent for root",
      });
    }
    writableIdentity = Object.freeze({ kind: 17091, identifier: "" });
  } else if (writableEnabled && writableType === "named") {
    if (!writableName || !validCacheIdentifier(writableName)) {
      diagnostics.push({
        field: "writable.name",
        code: "invalid",
        message: "writable.name must be a valid non-empty cache name",
      });
    } else {writableIdentity = Object.freeze({
        kind: 37091,
        identifier: writableName,
      });}
  }
  const signerMode = writableEnabled
    ? writableRaw?.signer?.type?.trim()
    : undefined;
  if (
    writableEnabled && signerMode !== "local" && signerMode !== "nip46" &&
    signerMode !== "ncryptsec"
  ) {
    diagnostics.push({
      field: "writable.signer.type",
      code: "invalid",
      message: "writable.signer.type must be local, nip46, or ncryptsec",
    });
  }
  const signerPath = writableEnabled && signerMode !== "ncryptsec"
    ? parseOwnerPath(
      writableRaw?.signer?.path,
      "writable.signer.path",
      diagnostics,
    )
    : undefined;
  const ncryptsec = writableEnabled && signerMode === "ncryptsec"
    ? writableRaw?.signer?.ncryptsec?.trim()
    : undefined;
  if (writableEnabled && signerMode === "ncryptsec") {
    if (
      !ncryptsec || !ncryptsec.startsWith("ncryptsec1") ||
      ncryptsec.length > 4096
    ) {
      diagnostics.push({
        field: "writable.signer.ncryptsec",
        code: "invalid",
        message: "writable.signer.ncryptsec must be a bounded ncryptsec value",
      });
    }
    if (writableRaw?.signer?.path !== undefined) {
      diagnostics.push({
        field: "writable.signer.path",
        code: "invalid",
        message: "writable.signer.path must be absent for ncryptsec",
      });
    }
  } else if (writableEnabled && writableRaw?.signer?.ncryptsec !== undefined) {
    diagnostics.push({
      field: "writable.signer.ncryptsec",
      code: "invalid",
      message: "writable.signer.ncryptsec is only valid for ncryptsec",
    });
  }
  const stagingDirectory = writableEnabled
    ? parseOwnerPath(
      writableRaw?.staging?.directory,
      "writable.staging.directory",
      diagnostics,
    )
    : undefined;
  const stagingBodyBytes = parsePositiveBytes(
    writableEnabled ? stringNumber(writableRaw?.staging?.bodyBytes) : undefined,
    "writable.staging.bodyBytes",
    1024 * 1024 * 1024,
    diagnostics,
  );
  const stagingAggregateBytes = parsePositiveBytes(
    writableEnabled
      ? stringNumber(writableRaw?.staging?.aggregateBytes)
      : undefined,
    "writable.staging.aggregateBytes",
    8 * 1024 * 1024 * 1024,
    diagnostics,
  );
  const nixSigKeys = listValues(
    writableEnabled ? writableRaw?.publication?.nixSigKeys : undefined,
  );
  const seenNixKeys = new Set<string>();
  if (nixSigKeys.length > 32) {
    diagnostics.push({
      field: "writable.publication.nixSigKeys",
      code: "out_of_range",
      message: "Nix signature keys must not exceed 32",
    });
  }
  for (const [index, key] of nixSigKeys.entries()) {
    const separator = key.indexOf(":");
    let canonical = false;
    try {
      const encoded = separator > 0 ? key.slice(separator + 1) : "";
      const decoded = Uint8Array.from(
        atob(encoded),
        (char) => char.charCodeAt(0),
      );
      canonical = separator > 0 && !key.slice(0, separator).includes(":") &&
        decoded.length === 32 &&
        btoa(String.fromCharCode(...decoded)) === encoded;
    } catch { /* diagnostic below */ }
    if (!canonical || seenNixKeys.has(key)) {
      diagnostics.push({
        field: `writable.publication.nixSigKeys[${index}]`,
        code: "invalid",
        message:
          "Nix signature keys must be unique canonical name:base64 public keys",
      });
    }
    seenNixKeys.add(key);
  }
  const publicationLifetimeSeconds = parseBoundedPositive(
    writableEnabled
      ? stringNumber(writableRaw?.publication?.lifetimeSeconds)
      : undefined,
    "writable.publication.lifetimeSeconds",
    2_592_000,
    31_536_000,
    diagnostics,
  );
  const publicationConcurrency = parseBoundedPositive(
    writableEnabled
      ? stringNumber(writableRaw?.publication?.concurrency)
      : undefined,
    "writable.publication.concurrency",
    2,
    64,
    diagnostics,
  );
  const publicationMaxAttempts = parseBoundedPositive(
    writableEnabled
      ? stringNumber(writableRaw?.publication?.maxAttempts)
      : undefined,
    "writable.publication.maxAttempts",
    8,
    32,
    diagnostics,
  );
  let localRelayUrl: URL | undefined;
  if (writableEnabled && writableRaw?.publication?.localRelayUrl) {
    try {
      const parsed = new URL(writableRaw.publication.localRelayUrl);
      if (
        !(parsed.protocol === "ws:" || parsed.protocol === "wss:") ||
        parsed.username || parsed.password
      ) throw new TypeError();
      localRelayUrl = parsed;
    } catch {
      diagnostics.push({
        field: "writable.publication.localRelayUrl",
        code: "invalid",
        message: "local relay must be an absolute credential-free WS(S) URL",
      });
    }
  }
  if (stagingAggregateBytes < stagingBodyBytes) {
    diagnostics.push({
      field: "writable.staging.aggregateBytes",
      code: "out_of_range",
      message: "stagingAggregateBytes must be at least stagingBodyBytes",
    });
  }
  const limits = {} as Record<keyof Limits, number>;
  for (const key of Object.keys(LIMIT_SPECS) as (keyof Limits)[]) {
    const spec = LIMIT_SPECS[key];
    const supplied = raw.limits?.[key];
    const value = supplied === undefined ? spec.defaultValue : Number(supplied);
    if (!Number.isSafeInteger(value) || value <= 0 || value > spec.ceiling) {
      diagnostics.push({
        field: `limits.${key}`,
        code: "out_of_range",
        message:
          `${key} must be a positive integer no greater than ${spec.ceiling}`,
      });
    }
    limits[key] = value;
  }
  if (
    Number.isFinite(limits.totalTimeoutMs) &&
    Number.isFinite(limits.connectTimeoutMs) &&
    limits.totalTimeoutMs < limits.connectTimeoutMs
  ) {
    diagnostics.push({
      field: "limits.totalTimeoutMs",
      code: "out_of_range",
      message: "totalTimeoutMs must be at least connectTimeoutMs",
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const writeIntent: WriteIntent = !writableEnabled
    ? Object.freeze({ mode: "disabled" })
    : signerMode === "ncryptsec"
    ? Object.freeze({
      mode: "ncryptsec",
      identity: writableIdentity!,
      ncryptsec: ncryptsec!,
    })
    : Object.freeze({
      mode: signerMode as "nip46" | "local",
      identity: writableIdentity!,
      signerPath: signerPath!,
    });
  const writable: ValidatedWritableConfig = !writableEnabled
    ? Object.freeze({ enabled: false })
    : Object.freeze({
      enabled: true,
      identity: writableIdentity!,
      signer: signerMode === "ncryptsec"
        ? Object.freeze({ type: "ncryptsec", ncryptsec: ncryptsec! })
        : Object.freeze({
          type: signerMode as "local" | "nip46",
          path: signerPath!,
        }),
      staging: Object.freeze({
        directory: stagingDirectory!,
        bodyBytes: stagingBodyBytes,
        aggregateBytes: stagingAggregateBytes,
      }),
      publication: Object.freeze({
        nixSigKeys: Object.freeze([...nixSigKeys]),
        lifetimeSeconds: publicationLifetimeSeconds,
        ...(localRelayUrl ? { localRelayUrl } : {}),
        concurrency: publicationConcurrency,
        maxAttempts: publicationMaxAttempts,
      }),
    });
  return {
    ok: true,
    diagnostics: [],
    value: Object.freeze({
      bindHost,
      bindPort,
      publisherPubkeys: Object.freeze(publisherValues),
      relayUrls: Object.freeze(relayUrls),
      preferredBlossomUrl,
      localBlossomUrl,
      databasePath: databasePath!,
      spoolDirectory: spoolDirectory!,
      identities: Object.freeze(normalizedIdentities),
      writeIntent,
      writable,
      limits: Object.freeze(limits as unknown as Limits),
    }),
  };
}

function normalizeRawConfig(
  input: RawConfig,
  diagnostics: ConfigDiagnostic[],
): NormalizedRawConfig {
  const normalized = { ...input } as Record<string, unknown>;
  for (
    const field of [
      "bindHost",
      "preferredBlossomUrl",
      "localBlossomUrl",
      "databasePath",
      "spoolDirectory",
    ]
  ) {
    const value = normalized[field];
    if (value !== undefined && typeof value !== "string") {
      invalidNativeType(field, "a string", diagnostics);
      normalized[field] = undefined;
    }
  }
  for (
    const field of [
      "bindPort",
    ]
  ) {
    const value = normalized[field];
    if (
      value !== undefined && typeof value !== "string" &&
      typeof value !== "number"
    ) {
      invalidNativeType(field, "a number", diagnostics);
      normalized[field] = undefined;
    } else if (typeof value === "number") normalized[field] = String(value);
  }
  for (
    const field of [
      "caches",
      "relayUrls",
    ]
  ) {
    const value = normalized[field];
    if (value === undefined || typeof value === "string") continue;
    if (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    ) {
      normalized[field] = Object.freeze([...value]);
    } else {
      invalidNativeType(field, "an array of strings", diagnostics);
      normalized[field] = undefined;
    }
  }
  const suppliedLimits = normalized.limits;
  const limits: Partial<Record<keyof Limits, string>> = {};
  if (suppliedLimits !== undefined) {
    if (!isPlainObject(suppliedLimits)) {
      invalidNativeType("limits", "an object", diagnostics);
    } else {
      for (const key of Object.keys(LIMIT_SPECS) as (keyof Limits)[]) {
        const value = suppliedLimits[key];
        if (value === undefined) continue;
        if (typeof value !== "string" && typeof value !== "number") {
          invalidNativeType(`limits.${key}`, "a number", diagnostics);
        } else limits[key] = String(value);
      }
    }
  }
  normalized.limits = limits;
  if (
    normalized.writable !== undefined && !isPlainObject(normalized.writable)
  ) {
    invalidNativeType("writable", "an object", diagnostics);
    normalized.writable = undefined;
  }
  return normalized as unknown as NormalizedRawConfig;
}

function stringNumber(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function listValues(
  value: string | readonly string[] | undefined,
): string[] {
  return (typeof value === "string" ? value.split(",") : value ?? []).map(
    (item) => item.trim(),
  ).filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidNativeType(
  field: string,
  expected: string,
  diagnostics: ConfigDiagnostic[],
): void {
  diagnostics.push({
    field,
    code: "invalid",
    message: `${field} must be ${expected}`,
  });
}

function parseBoundedPositive(
  value: string | undefined,
  field: string,
  fallback: number,
  ceiling: number,
  diagnostics: ConfigDiagnostic[],
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > ceiling) {
    diagnostics.push({
      field,
      code: "out_of_range",
      message: `${field} must be a positive integer no greater than ${ceiling}`,
    });
    return fallback;
  }
  return parsed;
}

function parsePositiveBytes(
  value: string | undefined,
  field: string,
  fallback: number,
  diagnostics: ConfigDiagnostic[],
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    diagnostics.push({
      field,
      code: "out_of_range",
      message: `${field} must be a positive safe integer`,
    });
    return fallback;
  }
  return parsed;
}

function parseReadCacheIdentity(
  value: string,
  field: string,
  diagnostics: ConfigDiagnostic[],
): CacheIdentity | undefined {
  if (/^[0-9a-f]{64}$/.test(value)) {
    return Object.freeze({ kind: 17091, pubkey: value, identifier: "" });
  }

  if (value.startsWith("npub1") || value.startsWith("naddr1")) {
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(value);
    } catch {
      diagnostics.push({
        field,
        code: "invalid",
        message: "cache identity contains malformed NIP-19 data",
      });
      return;
    }
    if (decoded.type === "npub") {
      return Object.freeze({
        kind: 17091,
        pubkey: decoded.data,
        identifier: "",
      });
    }
    if (decoded.type === "naddr" && decoded.data.kind === 37091) {
      return parseCacheIdentity(
        `37091:${decoded.data.pubkey}:${decoded.data.identifier}`,
        field,
        diagnostics,
      );
    }
    diagnostics.push({
      field,
      code: "invalid",
      message: "cache identity must be an npub or a kind-37091 naddr",
    });
    return;
  }

  return parseCacheIdentity(value, field, diagnostics);
}

function formatCacheIdentity(identity: CacheIdentity): string {
  return `${identity.kind}:${identity.pubkey}:${identity.identifier}`;
}

export function parseCacheIdentity(
  value: string,
  field = "cacheIdentity",
  diagnostics: ConfigDiagnostic[] = [],
): CacheIdentity | undefined {
  const match = /^(17091|37091):([0-9a-f]{64}):(.*)$/.exec(value);
  if (!match) {
    diagnostics.push({
      field,
      code: "invalid",
      message:
        "cache identity must be a raw kind-17091 or kind-37091 cache identity",
    });
    return;
  }
  const kind = Number(match[1]) as 17091 | 37091;
  const identifier = match[3];
  const validNamedIdentifier = validCacheIdentifier(identifier);
  if (
    (kind === 17091 && identifier !== "") ||
    (kind === 37091 && !validNamedIdentifier)
  ) {
    diagnostics.push({
      field,
      code: "invalid",
      message: kind === 17091
        ? "kind-17091 cache identity must have an empty identifier"
        : "kind-37091 cache identity must have one valid non-empty identifier",
    });
    return;
  }
  return Object.freeze({ kind, pubkey: match[2], identifier });
}

function validCacheIdentifier(identifier: string): boolean {
  const bytes = new TextEncoder().encode(identifier);
  return bytes.length > 0 && bytes.length <= 64 && !identifier.includes(":") &&
    !Array.from(identifier).some((character) =>
      /\s/u.test(character) || character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127
    );
}

function parseOwnerPath(
  value: string | undefined,
  field: string,
  diagnostics: ConfigDiagnostic[],
): string | undefined {
  const path = value?.trim();
  if (!path) {
    diagnostics.push({
      field,
      code: "required",
      message: `${field} is required`,
    });
    return;
  }
  if (!path.startsWith("/") || path.includes("\0")) {
    diagnostics.push({
      field,
      code: "invalid",
      message: `${field} must be an absolute filesystem path`,
    });
    return;
  }
  return path;
}
