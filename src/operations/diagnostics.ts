export type OperationalDiagnostic =
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
  };

export interface OperationalDiagnosticSink {
  emit(diagnostic: OperationalDiagnostic): void;
}

export interface JsonDiagnosticSinkOptions {
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

function base(item: OperationalDiagnostic, timestamp: string) {
  return { type: item.type, timestamp, code: item.code };
}

export function serializeOperationalDiagnostic(
  item: OperationalDiagnostic,
  timestamp: string,
): string {
  let safe: Record<string, unknown>;
  switch (item.type) {
    case "staging_failure":
      safe = {
        ...base(item, timestamp),
        routeClass: item.routeClass,
        status: item.status,
      };
      break;
    case "batch_build_failure":
      safe = {
        ...base(item, timestamp),
        batchId: item.batchId,
        count: item.count,
      };
      break;
    case "event_rejection":
      safe = {
        ...base(item, timestamp),
        eventId: item.eventId,
        cacheIdentity: item.cacheIdentity,
      };
      break;
    case "merge_conflict":
      safe = {
        ...base(item, timestamp),
        storePathHash: item.storePathHash,
        winnerIdentity: item.winnerIdentity,
        loserIdentity: item.loserIdentity,
        differingFields: [...item.differingFields],
      };
      break;
    case "upstream_failure":
      safe = {
        ...base(item, timestamp),
        endpoint: item.endpoint && endpoint(item.endpoint),
        attempt: item.attempt,
        durationMs: item.durationMs,
      };
      break;
    case "signer_transition":
      safe = {
        ...base(item, timestamp),
        status: item.status,
        cacheIdentity: item.cacheIdentity,
      };
      break;
    case "batch_transition":
      safe = {
        ...base(item, timestamp),
        batchId: item.batchId,
        count: item.count,
        rootHash: item.rootHash,
      };
      break;
    case "replica_attempt":
      safe = {
        ...base(item, timestamp),
        cacheIdentity: item.cacheIdentity,
        rootHash: item.rootHash,
        endpoint: endpoint(item.endpoint),
        attempt: item.attempt,
        count: item.count,
        durationMs: item.durationMs,
        ok: item.ok,
      };
      break;
    case "relay_acknowledgement":
      safe = {
        ...base(item, timestamp),
        eventId: item.eventId,
        endpoint: endpoint(item.endpoint),
        attempt: item.attempt,
        durationMs: item.durationMs,
        ok: item.ok,
      };
      break;
    case "promotion":
      safe = {
        ...base(item, timestamp),
        batchId: item.batchId,
        eventId: item.eventId,
        rootHash: item.rootHash,
      };
      break;
  }
  return JSON.stringify(
    safe,
    (_key, value) => value === undefined ? undefined : value,
  );
}

export function createJsonDiagnosticSink(
  options: JsonDiagnosticSinkOptions = {},
): OperationalDiagnosticSink {
  const write = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  return Object.freeze({
    emit(item: OperationalDiagnostic): void {
      try {
        write(
          serializeOperationalDiagnostic(item, new Date(now()).toISOString()),
        );
      } catch {
        // Diagnostics are deliberately non-authoritative.
      }
    },
  });
}
