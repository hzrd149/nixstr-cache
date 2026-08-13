import { parseArgs } from "@std/cli/parse-args";
import { bech32 } from "@scure/base";
import { NostrConnectSigner } from "applesauce-signers";
import { nip19 } from "nostr-tools";
import type { RawConfig, SignerOverride } from "./src/config/config.ts";
import { launchDaemon } from "./src/runtime/daemon.ts";
import { dirname, isAbsolute, resolve } from "node:path";

const SUPPORTED_ENVIRONMENT_NAMES = [
  "NIXSTR_BIND_HOST",
  "NIXSTR_BIND_PORT",
  "NIXSTR_CACHES",
  "NIXSTR_RELAY_URLS",
  "NIXSTR_PREFERRED_BLOSSOM_URL",
  "NIXSTR_LOCAL_BLOSSOM_URL",
  "NIXSTR_DATABASE_PATH",
  "NIXSTR_SPOOL_DIRECTORY",
  "NIXSTR_WRITABLE_ENABLED",
  "NIXSTR_WRITABLE_TYPE",
  "NIXSTR_WRITABLE_NAME",
  "NIXSTR_WRITABLE_SIGNER_TYPE",
  "NIXSTR_WRITABLE_SIGNER_PATH",
  "NIXSTR_WRITABLE_SIGNER_NCRYPTSEC",
  "NIXSTR_WRITABLE_STAGING_DIRECTORY",
  "NIXSTR_WRITABLE_STAGING_BODY_BYTES",
  "NIXSTR_WRITABLE_STAGING_AGGREGATE_BYTES",
  "NIXSTR_WRITABLE_PUBLICATION_NIX_SIG_KEYS",
  "NIXSTR_WRITABLE_PUBLICATION_LIFETIME_SECONDS",
  "NIXSTR_WRITABLE_PUBLICATION_LOCAL_RELAY_URL",
  "NIXSTR_WRITABLE_PUBLICATION_CONCURRENCY",
  "NIXSTR_WRITABLE_PUBLICATION_MAX_ATTEMPTS",
  "NIXSTR_LIMIT_MANIFEST_WIRE_BYTES",
  "NIXSTR_LIMIT_DECODED_METADATA_BYTES",
  "NIXSTR_LIMIT_BLOB_TRANSFER_BYTES",
  "NIXSTR_LIMIT_REQUEST_TRANSFER_BYTES",
  "NIXSTR_LIMIT_REQUEST_OUTPUT_BYTES",
  "NIXSTR_LIMIT_TRAVERSAL_DEPTH",
  "NIXSTR_LIMIT_LINKS_PER_NODE",
  "NIXSTR_LIMIT_UNIQUE_MANIFEST_NODES",
  "NIXSTR_LIMIT_TOTAL_DECODED_MANIFEST_BYTES",
  "NIXSTR_LIMIT_SOURCE_ATTEMPTS",
  "NIXSTR_LIMIT_MAX_REDIRECTS",
  "NIXSTR_LIMIT_CONNECT_TIMEOUT_MS",
  "NIXSTR_LIMIT_IDLE_TIMEOUT_MS",
  "NIXSTR_LIMIT_TOTAL_TIMEOUT_MS",
  "NIXSTR_LIMIT_CONCURRENT_FETCHES",
] as const;

export type EnvironmentReader = (name: string) => string | undefined;

export interface StartupConfigLoaderHooks {
  readonly readEnvironment?: EnvironmentReader;
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly warn?: (message: string) => void;
}

export interface StartupArguments {
  readonly configPath?: string;
  readonly signerOverride?: SignerOverride;
}

const OWNER_PATH_FIELDS = [
  "databasePath",
  "spoolDirectory",
] as const;

const JSON_CONFIG_FIELDS = new Set([
  "bindHost",
  "bindPort",
  "caches",
  "relayUrls",
  "preferredBlossomUrl",
  "localBlossomUrl",
  "databasePath",
  "spoolDirectory",
  "writable",
  "limits",
]);

const JSON_LIMIT_FIELDS = new Set([
  "manifestWireBytes",
  "decodedMetadataBytes",
  "blobTransferBytes",
  "requestTransferBytes",
  "requestOutputBytes",
  "traversalDepth",
  "linksPerNode",
  "uniqueManifestNodes",
  "totalDecodedManifestBytes",
  "sourceAttempts",
  "maxRedirects",
  "connectTimeoutMs",
  "idleTimeoutMs",
  "totalTimeoutMs",
  "concurrentFetches",
]);

export function collectRawConfigFromEnvironment(
  readEnvironment: EnvironmentReader = (name) => Deno.env.get(name),
): RawConfig {
  const environment: Record<string, string> = {};
  for (const name of SUPPORTED_ENVIRONMENT_NAMES) {
    const value = readEnvironment(name);
    if (value !== undefined) environment[name] = value;
  }
  return rawConfigFromEnvironment(environment);
}

export function rawConfigFromEnvironment(
  environment: Record<string, string>,
): RawConfig {
  return {
    bindHost: environment.NIXSTR_BIND_HOST,
    bindPort: environment.NIXSTR_BIND_PORT,
    caches: environment.NIXSTR_CACHES,
    relayUrls: environment.NIXSTR_RELAY_URLS,
    preferredBlossomUrl: environment.NIXSTR_PREFERRED_BLOSSOM_URL,
    localBlossomUrl: environment.NIXSTR_LOCAL_BLOSSOM_URL,
    databasePath: environment.NIXSTR_DATABASE_PATH,
    spoolDirectory: environment.NIXSTR_SPOOL_DIRECTORY,
    writable: writableFromEnvironment(environment),
    limits: {
      manifestWireBytes: environment.NIXSTR_LIMIT_MANIFEST_WIRE_BYTES,
      decodedMetadataBytes: environment.NIXSTR_LIMIT_DECODED_METADATA_BYTES,
      blobTransferBytes: environment.NIXSTR_LIMIT_BLOB_TRANSFER_BYTES,
      requestTransferBytes: environment.NIXSTR_LIMIT_REQUEST_TRANSFER_BYTES,
      requestOutputBytes: environment.NIXSTR_LIMIT_REQUEST_OUTPUT_BYTES,
      traversalDepth: environment.NIXSTR_LIMIT_TRAVERSAL_DEPTH,
      linksPerNode: environment.NIXSTR_LIMIT_LINKS_PER_NODE,
      uniqueManifestNodes: environment.NIXSTR_LIMIT_UNIQUE_MANIFEST_NODES,
      totalDecodedManifestBytes:
        environment.NIXSTR_LIMIT_TOTAL_DECODED_MANIFEST_BYTES,
      sourceAttempts: environment.NIXSTR_LIMIT_SOURCE_ATTEMPTS,
      maxRedirects: environment.NIXSTR_LIMIT_MAX_REDIRECTS,
      connectTimeoutMs: environment.NIXSTR_LIMIT_CONNECT_TIMEOUT_MS,
      idleTimeoutMs: environment.NIXSTR_LIMIT_IDLE_TIMEOUT_MS,
      totalTimeoutMs: environment.NIXSTR_LIMIT_TOTAL_TIMEOUT_MS,
      concurrentFetches: environment.NIXSTR_LIMIT_CONCURRENT_FETCHES,
    },
  };
}

export async function loadStartupConfig(
  args: readonly string[],
  hooks: StartupConfigLoaderHooks = {},
): Promise<RawConfig> {
  const readEnvironment = hooks.readEnvironment ??
    ((name) => Deno.env.get(name));
  const invocation = parseStartupArguments(args);
  let raw: RawConfig;
  if (!invocation.configPath) {
    raw = collectRawConfigFromEnvironment(readEnvironment);
  } else {
    raw = await loadConfigFile(invocation.configPath, readEnvironment, hooks);
  }
  if (!invocation.signerOverride) return raw;
  (hooks.warn ?? console.warn)(
    "warning: --signer values may be visible in shell history and process listings",
  );
  return { ...raw, signerOverride: invocation.signerOverride };
}

export function parseStartupArguments(
  args: readonly string[],
): StartupArguments {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args, {
      string: ["config", "signer"],
      collect: ["config", "signer"],
      unknown: (argument) => {
        throw new Error(
          argument.startsWith("-")
            ? `unsupported argument ${argument}`
            : "positional arguments are not supported",
        );
      },
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  const configValues = parsed.config as string[];
  const signerValues = parsed.signer as string[];
  if (configValues.length > 1) {
    throw new Error("--config may be specified once");
  }
  if (signerValues.length > 1) {
    throw new Error("--signer may be specified once");
  }
  if (configValues.length === 1 && configValues[0] === "") {
    throw new Error("--config requires a path");
  }
  if (signerValues.length === 1 && signerValues[0] === "") {
    throw new Error("--signer requires a value");
  }
  return Object.freeze({
    ...(configValues[0] ? { configPath: resolve(configValues[0]) } : {}),
    ...(signerValues[0]
      ? { signerOverride: parseSignerOverride(signerValues[0]) }
      : {}),
  });
}

function parseSignerOverride(value: string): SignerOverride {
  try {
    if (value.startsWith("nsec1")) {
      const decoded = nip19.decode(value);
      if (decoded.type !== "nsec" || decoded.data.length !== 32) {
        throw new TypeError();
      }
      return Object.freeze({ type: "nsec", nsec: value });
    }
    if (value.startsWith("ncryptsec1")) {
      const decoded = bech32.decode(value, 5000);
      const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
      if (
        decoded.prefix !== "ncryptsec" || bytes.length !== 91 ||
        bytes[0] !== 2 || bytes[1] < 16 || bytes[1] > 22 || bytes[42] > 2
      ) throw new TypeError();
      return Object.freeze({ type: "ncryptsec", ncryptsec: value });
    }
    if (value.startsWith("nbunksec1")) {
      NostrConnectSigner.parseNbunksec(value);
      return Object.freeze({ type: "nbunksec", nbunksec: value });
    }
  } catch { /* sanitized below */ }
  throw new Error(
    "--signer must be a valid lowercase nsec, ncryptsec, or nbunksec",
  );
}

async function loadConfigFile(
  selectedPath: string,
  readEnvironment: EnvironmentReader,
  hooks: StartupConfigLoaderHooks,
): Promise<RawConfig> {
  const configPath = resolve(selectedPath);
  let text: string;
  try {
    text = await (hooks.readTextFile ?? Deno.readTextFile)(configPath);
  } catch (error) {
    throw new Error(
      `unable to read config file ${configPath}: ${errorMessage(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `config file ${configPath} must contain valid JSON: ${
        errorMessage(error)
      }`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`config file ${configPath} must have a JSON object root`);
  }

  const fileConfig: Record<string, unknown> = {
    ...parsed as Record<string, unknown>,
  };
  validateJsonTopLevel(fileConfig);
  const baseDirectory = dirname(configPath);
  for (const field of OWNER_PATH_FIELDS) {
    const value = fileConfig[field];
    if (typeof value === "string" && !isAbsolute(value)) {
      fileConfig[field] = resolve(baseDirectory, value);
    }
  }
  resolveWritablePaths(fileConfig, baseDirectory);
  const environment = collectRawConfigFromEnvironment(readEnvironment);
  const merged = mergeDefined(
    fileConfig,
    environment as Record<string, unknown>,
  );
  validateWritableJson(merged.writable);
  return merged as unknown as RawConfig;
}

function validateJsonTopLevel(config: Record<string, unknown>): void {
  for (const field of Object.keys(config)) {
    if (!JSON_CONFIG_FIELDS.has(field)) {
      throw new Error(`unknown config field ${field}`);
    }
  }
  for (
    const field of [
      "bindHost",
      "preferredBlossomUrl",
      "localBlossomUrl",
      "databasePath",
      "spoolDirectory",
    ]
  ) {
    if (config[field] !== undefined && typeof config[field] !== "string") {
      throw new Error(`config field ${field} must be a string`);
    }
  }
  for (
    const field of [
      "bindPort",
    ]
  ) {
    if (config[field] !== undefined && typeof config[field] !== "number") {
      throw new Error(`config field ${field} must be a number`);
    }
  }
  for (
    const field of [
      "caches",
      "relayUrls",
    ]
  ) {
    const value = config[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) throw new Error(`config field ${field} must be an array of strings`);
  }
  if (config.limits !== undefined && !isRecord(config.limits)) {
    throw new Error("config field limits must be an object");
  }
  if (isRecord(config.limits)) {
    for (const [field, value] of Object.entries(config.limits)) {
      if (!JSON_LIMIT_FIELDS.has(field)) {
        throw new Error(`unknown config field limits.${field}`);
      }
      if (typeof value !== "number") {
        throw new Error(`config field limits.${field} must be a number`);
      }
    }
  }
}

function mergeDefined(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      merged[key] = isRecord(value) && isRecord(merged[key])
        ? mergeDefined(merged[key] as Record<string, unknown>, value)
        : value;
    }
  }
  return merged;
}

function writableFromEnvironment(
  e: Record<string, string>,
): RawConfig["writable"] {
  const enabledText = e.NIXSTR_WRITABLE_ENABLED;
  const enabled = enabledText === undefined
    ? undefined
    : enabledText === "true"
    ? true
    : enabledText === "false"
    ? false
    : enabledText;
  const value = {
    enabled,
    type: e.NIXSTR_WRITABLE_TYPE,
    name: e.NIXSTR_WRITABLE_NAME,
    signer: {
      type: e.NIXSTR_WRITABLE_SIGNER_TYPE,
      path: e.NIXSTR_WRITABLE_SIGNER_PATH,
      ncryptsec: e.NIXSTR_WRITABLE_SIGNER_NCRYPTSEC,
    },
    staging: {
      directory: e.NIXSTR_WRITABLE_STAGING_DIRECTORY,
      bodyBytes: e.NIXSTR_WRITABLE_STAGING_BODY_BYTES,
      aggregateBytes: e.NIXSTR_WRITABLE_STAGING_AGGREGATE_BYTES,
    },
    publication: {
      nixSigKeys: e.NIXSTR_WRITABLE_PUBLICATION_NIX_SIG_KEYS,
      lifetimeSeconds: e.NIXSTR_WRITABLE_PUBLICATION_LIFETIME_SECONDS,
      localRelayUrl: e.NIXSTR_WRITABLE_PUBLICATION_LOCAL_RELAY_URL,
      concurrency: e.NIXSTR_WRITABLE_PUBLICATION_CONCURRENCY,
      maxAttempts: e.NIXSTR_WRITABLE_PUBLICATION_MAX_ATTEMPTS,
    },
  };
  const prune = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(o).flatMap(([k, v]) =>
        isRecord(v)
          ? (Object.keys(prune(v)).length ? [[k, prune(v)]] : [])
          : v === undefined
          ? []
          : [[k, v]]
      ),
    );
  const pruned = prune(value as unknown as Record<string, unknown>);
  return Object.keys(pruned).length
    ? pruned as RawConfig["writable"]
    : undefined;
}

function resolveWritablePaths(
  config: Record<string, unknown>,
  base: string,
): void {
  const writable = config.writable;
  if (!isRecord(writable)) return;
  for (const group of ["signer", "staging"] as const) {
    const object = writable[group];
    const key = group === "signer" ? "path" : "directory";
    if (
      isRecord(object) && typeof object[key] === "string" &&
      !isAbsolute(object[key] as string)
    ) object[key] = resolve(base, object[key] as string);
  }
}

function validateWritableJson(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error("config field writable must be an object");
  }
  if (value.enabled === false) return;
  const allowed = new Set([
    "enabled",
    "type",
    "name",
    "signer",
    "staging",
    "publication",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`unknown config field writable.${key}`);
    }
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error("config field writable.enabled must be a boolean");
  }
  for (const key of ["type", "name"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error(`config field writable.${key} must be a string`);
    }
  }
  const groups: Record<string, Record<string, string>> = {
    signer: {
      type: "string",
      path: "string",
      ncryptsec: "string",
      nbunksec: "string",
    },
    staging: {
      directory: "string",
      bodyBytes: "number",
      aggregateBytes: "number",
    },
    publication: {
      nixSigKeys: "array",
      lifetimeSeconds: "number",
      localRelayUrl: "string",
      concurrency: "number",
      maxAttempts: "number",
    },
  };
  for (const [group, fields] of Object.entries(groups)) {
    const object = value[group];
    if (object === undefined) continue;
    if (!isRecord(object)) {
      throw new Error(`config field writable.${group} must be an object`);
    }
    for (const [key, child] of Object.entries(object)) {
      if (!(key in fields)) {
        throw new Error(`unknown config field writable.${group}.${key}`);
      }
      const expected = fields[key];
      if (
        expected === "array"
          ? !Array.isArray(child) || child.some((x) => typeof x !== "string")
          : expected === "string"
          ? typeof child !== "string"
          : typeof child !== "number"
      ) {
        throw new Error(
          `config field writable.${group}.${key} has invalid type`,
        );
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  let raw: RawConfig;
  try {
    raw = await loadStartupConfig(Deno.args);
  } catch (error) {
    console.error(errorMessage(error));
    Deno.exit(1);
  }
  const result = await launchDaemon(raw);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) console.error(diagnostic);
    Deno.exit(1);
  }
  await result.finished;
}
