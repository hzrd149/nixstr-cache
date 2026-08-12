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
  readonly bindPort?: string;
  readonly publisherPubkeys?: string;
  readonly cacheIdentities?: string;
  readonly relayUrls?: string;
  readonly preferredBlossomUrl?: string;
  readonly localBlossomUrl?: string;
  readonly databasePath?: string;
  readonly spoolDirectory?: string;
  readonly signerMode?: string;
  readonly writableIdentity?: string;
  readonly localKeyPath?: string;
  readonly nip46SessionPath?: string;
  readonly stagingDirectory?: string;
  readonly stagingBodyBytes?: string;
  readonly stagingAggregateBytes?: string;
  readonly nixSigKeys?: string;
  readonly publicationLifetimeSeconds?: string;
  readonly localRelayUrl?: string;
  readonly publicationConcurrency?: string;
  readonly publicationMaxAttempts?: string;
  readonly limits?: Partial<Record<keyof Limits, string>>;
}

export interface CacheIdentity {
  readonly kind: 17091 | 37091;
  readonly pubkey: string;
  readonly identifier: string;
}

export type WritableIdentity = CacheIdentity;

export const MAX_CACHE_IDENTITIES = 32;

export type WriteIntent =
  | { readonly mode: "disabled" }
  | {
    readonly mode: "nip46" | "local";
    readonly identity: WritableIdentity;
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
  readonly localKeyPath?: string;
  readonly nip46SessionPath?: string;
  readonly stagingDirectory?: string;
  readonly stagingBodyBytes: number;
  readonly stagingAggregateBytes: number;
  readonly nixSigKeys: readonly string[];
  readonly publicationLifetimeSeconds: number;
  readonly localRelayUrl?: URL;
  readonly publicationConcurrency: number;
  readonly publicationMaxAttempts: number;
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
  raw: RawConfig,
  _hooks: ParseConfigHooks = {},
): ConfigResult {
  const diagnostics: ConfigDiagnostic[] = [];
  const signerMode = raw.signerMode?.trim() || "disabled";
  if (
    signerMode !== "disabled" && signerMode !== "nip46" &&
    signerMode !== "local"
  ) {
    diagnostics.push({
      field: "signerMode",
      code: "invalid",
      message: "signerMode must be disabled, nip46, or local",
    });
  }
  const writableIdentity = raw.writableIdentity === undefined
    ? undefined
    : parseWritableIdentity(raw.writableIdentity, diagnostics);
  if (signerMode === "disabled" && raw.writableIdentity !== undefined) {
    diagnostics.push({
      field: "writableIdentity",
      code: "invalid",
      message: "writableIdentity must be absent when signerMode is disabled",
    });
  } else if (
    (signerMode === "nip46" || signerMode === "local") &&
    raw.writableIdentity === undefined
  ) {
    diagnostics.push({
      field: "writableIdentity",
      code: "required",
      message: "writableIdentity is required when signerMode is enabled",
    });
  }
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

  const legacyPublisherValues = (raw.publisherPubkeys ?? "").split(",").map(
    (value) => value.trim(),
  ).filter(Boolean);
  const identityValues = raw.cacheIdentities === undefined
    ? legacyPublisherValues.map((pubkey) => `17091:${pubkey}:`)
    : raw.cacheIdentities.split(",").map((value) => value.trim()).filter(
      Boolean,
    );
  if (identityValues.length === 0) {
    diagnostics.push({
      field: "cacheIdentities",
      code: "required",
      message: "at least one cache identity is required",
    });
  }
  if (identityValues.length > MAX_CACHE_IDENTITIES) {
    diagnostics.push({
      field: "cacheIdentities",
      code: "out_of_range",
      message: `cache identities must not exceed ${MAX_CACHE_IDENTITIES}`,
    });
  }
  const parsedIdentities: CacheIdentity[] = [];
  const seenIdentities = new Set<string>();
  for (const [index, value] of identityValues.entries()) {
    const parsed = parseCacheIdentity(
      value,
      `cacheIdentities[${index}]`,
      diagnostics,
    );
    if (seenIdentities.has(value)) {
      diagnostics.push({
        field: `cacheIdentities[${index}]`,
        code: "invalid",
        message: "cache identities must be unique",
      });
    }
    seenIdentities.add(value);
    if (parsed) parsedIdentities.push(parsed);
  }
  const publisherValues = [
    ...new Set(parsedIdentities.map((item) => item.pubkey)),
  ];

  const relayValues = (raw.relayUrls ?? "").split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
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
  const localKeyPath = raw.localKeyPath === undefined
    ? undefined
    : parseOwnerPath(raw.localKeyPath, "localKeyPath", diagnostics);
  const nip46SessionPath = raw.nip46SessionPath === undefined
    ? undefined
    : parseOwnerPath(raw.nip46SessionPath, "nip46SessionPath", diagnostics);
  const stagingDirectory = raw.stagingDirectory === undefined
    ? undefined
    : parseOwnerPath(raw.stagingDirectory, "stagingDirectory", diagnostics);
  const stagingBodyBytes = parsePositiveBytes(
    raw.stagingBodyBytes,
    "stagingBodyBytes",
    1024 * 1024 * 1024,
    diagnostics,
  );
  const stagingAggregateBytes = parsePositiveBytes(
    raw.stagingAggregateBytes,
    "stagingAggregateBytes",
    8 * 1024 * 1024 * 1024,
    diagnostics,
  );
  const nixSigKeys = (raw.nixSigKeys ?? "").split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
  const seenNixKeys = new Set<string>();
  if (nixSigKeys.length > 32) {
    diagnostics.push({
      field: "nixSigKeys",
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
        field: `nixSigKeys[${index}]`,
        code: "invalid",
        message:
          "Nix signature keys must be unique canonical name:base64 public keys",
      });
    }
    seenNixKeys.add(key);
  }
  const publicationLifetimeSeconds = parseBoundedPositive(
    raw.publicationLifetimeSeconds,
    "publicationLifetimeSeconds",
    2_592_000,
    31_536_000,
    diagnostics,
  );
  const publicationConcurrency = parseBoundedPositive(
    raw.publicationConcurrency,
    "publicationConcurrency",
    2,
    64,
    diagnostics,
  );
  const publicationMaxAttempts = parseBoundedPositive(
    raw.publicationMaxAttempts,
    "publicationMaxAttempts",
    8,
    32,
    diagnostics,
  );
  let localRelayUrl: URL | undefined;
  if (raw.localRelayUrl) {
    try {
      const parsed = new URL(raw.localRelayUrl);
      if (
        !(parsed.protocol === "ws:" || parsed.protocol === "wss:") ||
        parsed.username || parsed.password
      ) throw new TypeError();
      localRelayUrl = parsed;
    } catch {
      diagnostics.push({
        field: "localRelayUrl",
        code: "invalid",
        message: "local relay must be an absolute credential-free WS(S) URL",
      });
    }
  }
  if (signerMode !== "disabled") {
    if (!stagingDirectory) {
      diagnostics.push({
        field: "stagingDirectory",
        code: "required",
        message: "stagingDirectory is required when signerMode is enabled",
      });
    }
    if (signerMode === "local" && !localKeyPath) {
      diagnostics.push({
        field: "localKeyPath",
        code: "required",
        message: "localKeyPath is required for local signer mode",
      });
    }
    if (signerMode === "nip46" && !nip46SessionPath) {
      diagnostics.push({
        field: "nip46SessionPath",
        code: "required",
        message: "nip46SessionPath is required for nip46 signer mode",
      });
    }
    if (
      signerMode === "local" && nip46SessionPath ||
      signerMode === "nip46" && localKeyPath
    ) {
      diagnostics.push({
        field: "signerMode",
        code: "invalid",
        message: "exactly the protected source matching signerMode is allowed",
      });
    }
  } else if (localKeyPath || nip46SessionPath || stagingDirectory) {
    diagnostics.push({
      field: "signerMode",
      code: "invalid",
      message: "write paths must be absent when signerMode is disabled",
    });
  }
  if (stagingAggregateBytes < stagingBodyBytes) {
    diagnostics.push({
      field: "stagingAggregateBytes",
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
  const writeIntent: WriteIntent = signerMode === "disabled"
    ? Object.freeze({ mode: "disabled" })
    : Object.freeze({
      mode: signerMode as "nip46" | "local",
      identity: writableIdentity!,
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
      identities: Object.freeze([...identityValues]),
      writeIntent,
      localKeyPath,
      nip46SessionPath,
      stagingDirectory,
      stagingBodyBytes,
      stagingAggregateBytes,
      nixSigKeys: Object.freeze([...nixSigKeys]),
      publicationLifetimeSeconds,
      localRelayUrl,
      publicationConcurrency,
      publicationMaxAttempts,
      limits: Object.freeze(limits as unknown as Limits),
    }),
  };
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

function parseWritableIdentity(
  value: string,
  diagnostics: ConfigDiagnostic[],
): WritableIdentity | undefined {
  return parseCacheIdentity(value, "writableIdentity", diagnostics);
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
  const identifierBytes = new TextEncoder().encode(identifier);
  const validNamedIdentifier = identifierBytes.length > 0 &&
    identifierBytes.length <= 64 &&
    !identifier.includes(":") &&
    !Array.from(identifier).some((character) =>
      /\s/u.test(character) || character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127
    );
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
