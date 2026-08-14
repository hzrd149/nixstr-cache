// This module derives a rendering-ready status snapshot from injected scalars
// and public Nostr data only. It never receives the validated configuration
// object, the signer capability, or the write repository, so it cannot render
// a secret even by mistake.

import type {
  HealthSnapshot,
  ProcessHealthReason,
  ReadHealthReason,
  WriteHealthReason,
} from "./health.ts";
import type { SelectedPublication } from "../nostr/selection.ts";
import type { EndpointWork } from "../persistence/write_repository.ts";
import { cacheIdentity } from "../protocol/publication.ts";
import { safeEndpoint } from "./diagnostics.ts";

export interface StatusInputs {
  readonly health: HealthSnapshot;
  readonly endpoint: { readonly host: string; readonly port: number };
  readonly caches: readonly SelectedPublication[];
  readonly writableIdentity?: string;
  readonly overlayEntries: number;
  readonly storage?: {
    readonly ok: boolean;
    readonly readyBytes: number;
    readonly reservedBytes: number;
    readonly capacityBytes: number;
    readonly tombstones: number;
  };
  readonly write: {
    readonly enabled: boolean;
    readonly acceptingUploads: boolean;
    readonly signerStatus?:
      | "disconnected"
      | "connecting"
      | "ready"
      | "failed";
    readonly signerPubkey?: string;
    readonly destinations: number;
    readonly relays: number;
    readonly pending?: { readonly blobs: number; readonly bytes: number };
    readonly batchId?: number;
    readonly endpointWork?: readonly EndpointWork[];
  };
}

export interface StatusCacheView {
  readonly priority: number;
  readonly kind: 17091 | 37091;
  readonly pubkey: string;
  readonly name?: string;
  readonly identity: string;
  readonly nhash: string;
  readonly keyCount: number;
  readonly keyNames: readonly string[];
  readonly updatedAt: number;
  readonly expiresAt?: number;
  readonly expired: boolean;
  readonly writable: boolean;
  readonly blossomServers: readonly string[];
}

export interface EndpointProgress {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly retries: number;
  readonly exhausted: number;
}

export interface StatusSnapshot {
  readonly timestamp: string;
  readonly overall: {
    readonly level: "ok" | "degraded" | "down";
    readonly summary: string;
    readonly reasons: readonly string[];
  };
  readonly read: {
    readonly status: "ok" | "unavailable";
    readonly caches: readonly StatusCacheView[];
    readonly overlayEntries: number;
  };
  readonly storage: {
    readonly available: boolean;
    readonly readyBytes: number;
    readonly reservedBytes: number;
    readonly capacityBytes: number;
    readonly usedPercent: number;
    readonly tombstones: number;
  };
  readonly write: {
    readonly status: "disabled" | "blocked" | "ready" | "repairing";
    readonly reasons: readonly string[];
    readonly signerStatus?:
      | "disconnected"
      | "connecting"
      | "ready"
      | "failed";
    readonly signerDetail: string;
    readonly destinations: number;
    readonly relays: number;
    readonly acceptingUploads: boolean;
    readonly pending?: { readonly blobs: number; readonly bytes: number };
    readonly publication?: {
      readonly batchId: number;
      readonly replicas: EndpointProgress;
      readonly relays: EndpointProgress;
    };
  };
  readonly setup: {
    readonly substituter: string;
    readonly trustedPublicKeys: readonly string[];
  };
}

export interface StatusSnapshotProvider {
  current(): StatusSnapshot;
}

// Exhaustive over the three health reason unions declared in ./health.ts, so
// `deno task check` fails the build if a reason is added upstream without a
// matching human sentence here.
export const REASON_TEXT: Record<
  ProcessHealthReason | ReadHealthReason | WriteHealthReason,
  string
> = {
  repository_unavailable: "the state repository is unavailable",
  fatal_error: "a fatal internal error occurred",
  no_read_sources: "no caches are selected and the writable overlay is empty",
  write_disabled: "writes are disabled",
  write_repository_unavailable: "the write repository is unavailable",
  signer_disconnected: "the signer is disconnected",
  signer_connecting: "the signer is still connecting",
  signer_failed: "the signer failed",
  signer_ownership_mismatch:
    "the signer does not own the configured writable identity",
  write_initializing: "write capability is still initializing",
  write_activation_failed: "write activation failed",
  no_blossom_destination: "no Blossom upload destination is configured",
  no_publication_relay: "no publication relay is configured or reachable",
  no_complete_replica: "no Blossom replica has a complete upload yet",
  relay_not_acknowledged:
    "no publication relay has acknowledged the signed event yet",
  repair_pending: "a previous publication is still being repaired",
};

export function summarizeEndpointWork(
  work: readonly EndpointWork[],
  kind: "replica" | "relay",
): EndpointProgress {
  const selected = work.filter((row) => row.kind === kind);
  return {
    total: selected.length,
    succeeded: selected.filter((row) => row.status === "complete").length,
    failed:
      selected.filter((row) => row.attempts > 0 && row.status !== "complete")
        .length,
    retries: selected.reduce(
      (sum, row) => sum + Math.max(0, row.attempts - 1),
      0,
    ),
    exhausted: selected.filter((row) => row.status === "exhausted").length,
  };
}

function overallLevel(health: HealthSnapshot): "ok" | "degraded" | "down" {
  if (health.process.status === "failed") return "down";
  if (
    health.read.status === "ok" &&
    (health.write.status === "ready" || health.write.status === "disabled")
  ) return "ok";
  return "degraded";
}

function summaryText(
  cachesCount: number,
  writeEnabled: boolean,
  writeStatus: HealthSnapshot["write"]["status"],
): string {
  const cachesPart = cachesCount === 0
    ? "No caches selected."
    : `Serving ${cachesCount} cache${cachesCount === 1 ? "" : "s"}.`;
  const writePart = !writeEnabled
    ? "Writes disabled."
    : writeStatus === "ready"
    ? "Writes ready."
    : writeStatus === "repairing"
    ? "Repairing publication."
    : "Uploads blocked.";
  return `${cachesPart} ${writePart}`;
}

function normalizeHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::" || host === "[::]") return "[::1]";
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

function substituterOrigin(host: string, port: number): string {
  const url = new URL(`http://${normalizeHost(host)}:${port}`);
  return url.origin;
}

function trustedPublicKeys(
  caches: readonly SelectedPublication[],
): readonly string[] {
  const keys = new Set<string>();
  for (const cache of caches) {
    for (const key of cache.nixSigKeys) keys.add(`${key.name}:${key.encoded}`);
  }
  return [...keys].sort();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function signerDetail(pubkey: string | undefined): string {
  if (!pubkey) return "";
  return `${pubkey.slice(0, 6)}…`;
}

const NHASH_PATTERN = /^nhash1[023456789acdefghjklmnpqrstuvwxyz]{6,120}$/;

function cacheView(
  publication: SelectedPublication,
  index: number,
  writableIdentity: string | undefined,
  nowSeconds: number,
): StatusCacheView {
  const identity = cacheIdentity(publication);
  return {
    priority: index + 1,
    kind: publication.identity.kind,
    pubkey: publication.identity.pubkey,
    ...(publication.identity.name === undefined
      ? {}
      : { name: publication.identity.name }),
    identity,
    nhash: NHASH_PATTERN.test(publication.root.nhash)
      ? publication.root.nhash
      : "",
    keyCount: publication.nixSigKeys.length,
    keyNames: publication.nixSigKeys.map((key) => key.name),
    updatedAt: publication.event.created_at,
    ...(publication.expiresAt === undefined
      ? {}
      : { expiresAt: publication.expiresAt }),
    expired: publication.expiresAt !== undefined &&
      publication.expiresAt <= nowSeconds,
    writable: writableIdentity !== undefined &&
      identity === writableIdentity,
    blossomServers: publication.blossomServers
      .map((server) => safeEndpoint(server))
      .filter((server): server is string => server !== undefined),
  };
}

export function createStatusSnapshotProvider(
  current: () => StatusInputs,
  now: () => number = Date.now,
): StatusSnapshotProvider {
  return Object.freeze({
    current(): StatusSnapshot {
      const inputs = current();
      const nowMs = now();
      const nowSeconds = Math.floor(nowMs / 1000);
      const { health } = inputs;
      const caches = inputs.caches.map((publication, index) =>
        cacheView(publication, index, inputs.writableIdentity, nowSeconds)
      );
      const storage = inputs.storage
        ? {
          available: true,
          readyBytes: inputs.storage.readyBytes,
          reservedBytes: inputs.storage.reservedBytes,
          capacityBytes: inputs.storage.capacityBytes,
          usedPercent: inputs.storage.capacityBytes > 0
            ? clamp(
              Math.round(
                inputs.storage.readyBytes / inputs.storage.capacityBytes *
                  100,
              ),
              0,
              100,
            )
            : 0,
          tombstones: inputs.storage.tombstones,
        }
        : {
          available: false,
          readyBytes: 0,
          reservedBytes: 0,
          capacityBytes: 0,
          usedPercent: 0,
          tombstones: 0,
        };
      const endpointWork = inputs.write.endpointWork ?? [];
      const batchWork = inputs.write.batchId === undefined
        ? []
        : endpointWork.filter((row) => row.batchId === inputs.write.batchId);
      return Object.freeze({
        timestamp: new Date(nowMs).toISOString(),
        overall: Object.freeze({
          level: overallLevel(health),
          summary: summaryText(
            caches.length,
            inputs.write.enabled,
            health.write.status,
          ),
          reasons: Object.freeze([
            ...health.process.reasons,
            ...health.read.reasons,
            ...health.write.reasons,
          ].map((reason) => REASON_TEXT[reason])),
        }),
        read: Object.freeze({
          status: health.read.status,
          caches: Object.freeze(caches),
          overlayEntries: inputs.overlayEntries,
        }),
        storage: Object.freeze(storage),
        write: Object.freeze({
          status: health.write.status,
          reasons: Object.freeze(
            health.write.reasons.map((reason) => REASON_TEXT[reason]),
          ),
          signerStatus: inputs.write.signerStatus,
          signerDetail: signerDetail(inputs.write.signerPubkey),
          destinations: inputs.write.destinations,
          relays: inputs.write.relays,
          acceptingUploads: inputs.write.acceptingUploads,
          ...(inputs.write.pending ? { pending: inputs.write.pending } : {}),
          ...(inputs.write.batchId === undefined ? {} : {
            publication: Object.freeze({
              batchId: inputs.write.batchId,
              replicas: summarizeEndpointWork(batchWork, "replica"),
              relays: summarizeEndpointWork(batchWork, "relay"),
            }),
          }),
        }),
        setup: Object.freeze({
          substituter: substituterOrigin(
            inputs.endpoint.host,
            inputs.endpoint.port,
          ),
          trustedPublicKeys: Object.freeze(trustedPublicKeys(inputs.caches)),
        }),
      });
    },
  });
}
