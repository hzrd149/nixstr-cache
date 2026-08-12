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
  readonly relayUrls?: string;
  readonly preferredBlossomUrl?: string;
  readonly limits?: Partial<Record<keyof Limits, string>>;
}

export interface ValidatedConfig {
  readonly bindHost: string;
  readonly bindPort: number;
  readonly publisherPubkeys: readonly string[];
  readonly relayUrls: readonly URL[];
  readonly preferredBlossomUrl?: URL;
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

  const publisherValues = (raw.publisherPubkeys ?? "").split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
  if (publisherValues.length === 0) {
    diagnostics.push({
      field: "publisherPubkeys",
      code: "required",
      message: "at least one publisher pubkey is required",
    });
  }
  for (const [index, value] of publisherValues.entries()) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      diagnostics.push({
        field: `publisherPubkeys[${index}]`,
        code: "invalid",
        message: "publisher pubkeys must be 32-byte lowercase hex",
      });
    }
  }

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
  for (const [index, value] of relayValues.entries()) {
    try {
      const url = new URL(value);
      if (
        !(url.protocol === "ws:" || url.protocol === "wss:") || url.username ||
        url.password
      ) throw new TypeError();
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
  return {
    ok: true,
    diagnostics: [],
    value: Object.freeze({
      bindHost,
      bindPort,
      publisherPubkeys: Object.freeze(publisherValues),
      relayUrls: Object.freeze(relayUrls),
      preferredBlossomUrl,
      limits: Object.freeze(limits as unknown as Limits),
    }),
  };
}
