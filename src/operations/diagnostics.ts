export type OperationalDiagnostic =
  | {
    readonly type: "blob_store";
    readonly code: "capacity_exhausted" | "reconcile_failure" | "delete_retry";
    readonly readyBytes: number;
    readonly reservedBytes: number;
    readonly capacityBytes: number;
    readonly count?: number;
  }
  | {
    readonly type: "staging_failure";
    readonly code:
      | "staging_conflict"
      | "staging_too_large"
      | "staging_invalid_narinfo"
      | "staging_unavailable";
    readonly routeClass: "narinfo" | "nar";
    readonly status: 400 | 409 | 413 | 503;
  }
  | {
    readonly type: "batch_build_failure";
    readonly code: "hashtree_build_failed";
    readonly batchId: number;
    readonly count: number;
  }
  | {
    readonly type: "event_rejection";
    readonly code: string;
    readonly eventId?: string;
    readonly cacheIdentity?: string;
  }
  | {
    readonly type: "merge_conflict";
    readonly code: "narinfo_semantic_conflict";
    readonly storePathHash: string;
    readonly winnerIdentity: string;
    readonly loserIdentity: string;
    readonly differingFields: readonly string[];
  }
  | {
    readonly type: "upstream_failure";
    readonly code: string;
    readonly endpoint?: string;
    readonly attempt?: number;
    readonly durationMs?: number;
  }
  | {
    readonly type: "signer_transition";
    readonly code: string;
    readonly status: string;
    readonly cacheIdentity?: string;
  }
  | {
    readonly type: "batch_transition";
    readonly code: string;
    readonly batchId: number;
    readonly count?: number;
    readonly rootHash?: string;
  }
  | {
    readonly type: "publication_stage";
    readonly code: string;
    readonly stage:
      | "authorization"
      | "replication"
      | "root_signing"
      | "relay_publication"
      | "selection_admission";
    readonly status: "started" | "complete" | "waiting" | "failed";
    readonly batchId: number;
    readonly rootHash: string;
    readonly count?: number;
  }
  | {
    readonly type: "replica_attempt";
    readonly code: string;
    readonly cacheIdentity?: string;
    readonly rootHash?: string;
    readonly endpoint: string;
    readonly attempt: number;
    readonly count?: number;
    readonly durationMs: number;
    readonly ok: boolean;
  }
  | {
    readonly type: "relay_acknowledgement";
    readonly code: string;
    readonly eventId?: string;
    readonly endpoint: string;
    readonly attempt: number;
    readonly durationMs?: number;
    readonly ok: boolean;
  }
  | {
    readonly type: "promotion";
    readonly code: string;
    readonly batchId: number;
    readonly eventId: string;
    readonly rootHash: string;
  }
  | {
    readonly type: "http_request";
    readonly code: "request_handled";
    readonly method: "GET" | "HEAD";
    readonly path: string;
    readonly status: number;
    readonly durationMs: number;
  }
  | {
    readonly type: "write_transition";
    readonly code:
      | "write_activation_started"
      | "write_activation_ready"
      | "write_activation_failed";
    readonly status: "initializing" | "ready" | "failed";
  }
  | {
    readonly type: "writable_identity_mismatch";
    readonly code: "durable_writable_identity_mismatch";
    readonly configuredIdentity: string;
    readonly durableIdentity: string;
  }
  | {
    readonly type: "blossom_server_list";
    readonly code: "write_server_list_changed";
    readonly count: number;
    readonly endpoints: readonly string[];
  }
  | {
    readonly type: "write_relay_list";
    readonly code: "write_relay_list_found" | "write_relay_list_changed";
    readonly count: number;
    readonly configuredCount: number;
    readonly outboxCount: number;
    readonly endpoints: readonly string[];
  }
  | {
    readonly type: "cache_selection";
    readonly code: "cache_selection_found" | "cache_selection_changed";
    readonly count: number;
    readonly caches: readonly string[];
    readonly htreeLinks?: readonly string[];
  }
  | {
    readonly type: "hashtree_nar";
    readonly code: "nar_resolution_failed";
    readonly method: "GET" | "HEAD";
    readonly path: string;
    readonly cacheIdentity: string;
    readonly rootHash: string;
    readonly eventId: string;
    readonly route: "pinned" | "fallback";
  };

export interface OperationalDiagnosticSink {
  emit(diagnostic: OperationalDiagnostic): void;
}

export interface ConsoleDiagnosticSinkOptions {
  readonly write?: (line: string) => void;
  readonly now?: () => number;
}

function endpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return undefined;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href.replace(/\/$/, url.pathname === "/" ? "" : "/");
  } catch {
    return undefined;
  }
}

function safePath(value: string): string {
  const path = value.split(/[?#]/, 1)[0];
  return path.replace(/[^A-Za-z0-9._+\/-]/g, "?");
}

function safeIdentity(value: string): string {
  if (value.length > 136 || /\s/.test(value)) return "invalid";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "invalid";
  }
  return /^(?:17091|37091):[0-9a-f]{64}:.{0,64}$/.test(value)
    ? value
    : "invalid";
}

function safeHtreeLink(value: string): string {
  return /^htree:\/\/nhash1[023456789acdefghjklmnpqrstuvwxyz]{6,120}$/.test(
      value,
    )
    ? value
    : "invalid";
}

export function formatOperationalDiagnostic(
  item: OperationalDiagnostic,
  timestamp: string,
): string {
  const fields: string[] = [];
  let level = "INFO";
  let message: string;
  switch (item.type) {
    case "blob_store":
      level = item.code === "delete_retry" ? "WARN" : "ERROR";
      message = `blob store: ${item.code}`;
      fields.push(
        `ready_bytes=${item.readyBytes}`,
        `reserved_bytes=${item.reservedBytes}`,
        `capacity_bytes=${item.capacityBytes}`,
      );
      if (item.count !== undefined) fields.push(`count=${item.count}`);
      break;
    case "staging_failure":
      level = "WARN";
      message = `upload staging failed: ${item.code}`;
      fields.push(`route=${item.routeClass}`, `status=${item.status}`);
      break;
    case "batch_build_failure":
      level = "ERROR";
      message = "cache tree build failed";
      fields.push(`batch=${item.batchId}`, `entries=${item.count}`);
      break;
    case "event_rejection":
      level = "WARN";
      message = `Nostr event rejected: ${item.code}`;
      if (item.eventId) fields.push(`event=${item.eventId}`);
      if (item.cacheIdentity) fields.push(`cache=${item.cacheIdentity}`);
      break;
    case "merge_conflict":
      level = "WARN";
      message = "narinfo publisher conflict";
      fields.push(
        `store=${item.storePathHash}`,
        `winner=${item.winnerIdentity}`,
        `loser=${item.loserIdentity}`,
        `fields=${item.differingFields.join(",")}`,
      );
      break;
    case "upstream_failure":
      level = "WARN";
      message = `upstream request failed: ${item.code}`;
      if (item.endpoint && endpoint(item.endpoint)) {
        fields.push(`endpoint=${endpoint(item.endpoint)}`);
      }
      if (item.attempt !== undefined) fields.push(`attempt=${item.attempt}`);
      if (item.durationMs !== undefined) {
        fields.push(`duration=${item.durationMs}ms`);
      }
      break;
    case "signer_transition":
      level = item.status === "failed" ? "ERROR" : "INFO";
      message = `signer ${item.status}: ${item.code}`;
      if (item.cacheIdentity) fields.push(`cache=${item.cacheIdentity}`);
      break;
    case "batch_transition":
      message = `publication batch: ${item.code}`;
      fields.push(`batch=${item.batchId}`);
      if (item.count !== undefined) fields.push(`entries=${item.count}`);
      if (item.rootHash) fields.push(`root=${item.rootHash}`);
      break;
    case "publication_stage":
      level = item.status === "failed"
        ? "ERROR"
        : item.status === "waiting"
        ? "WARN"
        : "INFO";
      message = `publication ${item.stage} ${item.status}: ${item.code}`;
      fields.push(`batch=${item.batchId}`, `root=${item.rootHash}`);
      if (item.count !== undefined) fields.push(`entries=${item.count}`);
      break;
    case "replica_attempt":
      level = item.ok ? "INFO" : "WARN";
      message = `Blossom replica ${
        item.ok ? "succeeded" : "failed"
      }: ${item.code}`;
      fields.push(
        `endpoint=${endpoint(item.endpoint) ?? "invalid"}`,
        `attempt=${item.attempt}`,
      );
      if (item.cacheIdentity) fields.push(`cache=${item.cacheIdentity}`);
      if (item.rootHash) fields.push(`root=${item.rootHash}`);
      if (item.count !== undefined) fields.push(`blobs=${item.count}`);
      fields.push(`duration=${item.durationMs}ms`);
      break;
    case "relay_acknowledgement":
      level = item.ok ? "INFO" : "WARN";
      message = `relay publication ${
        item.ok ? "acknowledged" : "failed"
      }: ${item.code}`;
      fields.push(
        `endpoint=${endpoint(item.endpoint) ?? "invalid"}`,
        `attempt=${item.attempt}`,
      );
      if (item.eventId) fields.push(`event=${item.eventId}`);
      if (item.durationMs !== undefined) {
        fields.push(`duration=${item.durationMs}ms`);
      }
      break;
    case "promotion":
      message = "cache publication promoted";
      fields.push(
        `batch=${item.batchId}`,
        `event=${item.eventId}`,
        `root=${item.rootHash}`,
      );
      break;
    case "http_request":
      level = item.status >= 500
        ? "ERROR"
        : item.status >= 400
        ? "WARN"
        : "INFO";
      message = `${item.method} ${safePath(item.path)} -> ${item.status}`;
      fields.push(`duration=${item.durationMs}ms`);
      break;
    case "write_transition":
      level = item.status === "failed" ? "ERROR" : "INFO";
      message = `write capability ${item.status}: ${item.code}`;
      break;
    case "writable_identity_mismatch":
      level = "ERROR";
      message = [
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
        "WRITABLE CACHE OWNER MISMATCH — WRITES HAVE BEEN DISABLED",
        `Configured signer: ${safeIdentity(item.configuredIdentity)}`,
        `Durable owner:     ${safeIdentity(item.durableIdentity)}`,
        "writable.enabled was honored, but this writable database already belongs",
        "to a different signer. PUT is disabled because the daemon refused to",
        "rebind it and risk accidental cache takeover or state corruption.",
        "Restore the original signer, or explicitly migrate/reset the writable state",
        "after preserving any cache data you need. Do not delete state casually.",
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
      ].join("\n");
      break;
    case "blossom_server_list":
      message = "write Blossom server list changed";
      fields.push(`servers=${item.count}`);
      if (item.endpoints.length) {
        fields.push(
          `endpoints=${
            item.endpoints.map((value) => endpoint(value) ?? "invalid").join(
              ",",
            )
          }`,
        );
      }
      break;
    case "write_relay_list":
      message = item.code === "write_relay_list_found"
        ? "write relay list found"
        : "write relay list changed";
      fields.push(
        `relays=${item.count}`,
        `configured=${item.configuredCount}`,
        `outboxes=${item.outboxCount}`,
      );
      if (item.endpoints.length) {
        fields.push(
          `endpoints=${
            item.endpoints.map((value) => endpoint(value) ?? "invalid").join(
              ",",
            )
          }`,
        );
      }
      break;
    case "cache_selection":
      message = item.code === "cache_selection_found"
        ? "cache selection found"
        : "cache selection changed";
      fields.push(`caches=${item.count}`);
      if (item.caches.length) {
        fields.push(`identities=${item.caches.map(safeIdentity).join(",")}`);
      }
      if (item.htreeLinks?.length) {
        fields.push(`htrees: ${item.htreeLinks.map(safeHtreeLink).join(",")}`);
      }
      break;
    case "hashtree_nar":
      level = "WARN";
      message = "NAR resolution failed in Hashtree cache";
      fields.push(
        `method=${item.method}`,
        `path=${safePath(item.path)}`,
        `cache=${safeIdentity(item.cacheIdentity)}`,
        `root=${item.rootHash}`,
        `event=${item.eventId}`,
        `route=${item.route}`,
      );
      break;
  }
  return `${timestamp} ${level.padEnd(5)} ${message}${
    fields.length ? ` ${fields.join(" ")}` : ""
  }`;
}

export function createConsoleDiagnosticSink(
  options: ConsoleDiagnosticSinkOptions = {},
): OperationalDiagnosticSink {
  const write = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  return Object.freeze({
    emit(item: OperationalDiagnostic): void {
      try {
        write(
          formatOperationalDiagnostic(item, new Date(now()).toISOString()),
        );
      } catch {
        // Diagnostics are deliberately non-authoritative.
      }
    },
  });
}
