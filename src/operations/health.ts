export type ProcessHealthReason = "repository_unavailable" | "fatal_error";
export type ReadHealthReason = "no_read_sources";
export type WriteHealthReason =
  | "write_disabled"
  | "write_repository_unavailable"
  | "signer_disconnected"
  | "signer_connecting"
  | "signer_failed"
  | "signer_ownership_mismatch"
  | "write_initializing"
  | "write_activation_failed"
  | "no_blossom_destination"
  | "no_publication_relay"
  | "no_complete_replica"
  | "relay_not_acknowledged"
  | "repair_pending";

export interface HealthInputs {
  readonly process?: {
    readonly repositoryHealthy: boolean;
    readonly fatalCode?: string;
  };
  readonly read?: {
    readonly selectedPublications: number;
    readonly overlayEntries: number;
  };
  readonly write: {
    readonly enabled: boolean;
    readonly repositoryHealthy?: boolean;
    readonly signerStatus?: "disconnected" | "connecting" | "ready" | "failed";
    readonly signerOwned?: boolean;
    readonly activationStatus?: "initializing" | "ready" | "failed";
    readonly destinations?: number;
    readonly relays?: number;
    readonly publication?: {
      readonly phase: "idle" | "replicating" | "awaiting_relay" | "repairing";
      readonly completeReplica: boolean;
    };
  };
}

export interface HealthSnapshot {
  readonly timestamp: string;
  readonly process: {
    readonly status: "ok" | "failed";
    readonly reasons: readonly ProcessHealthReason[];
  };
  readonly read: {
    readonly status: "ok" | "unavailable";
    readonly reasons: readonly ReadHealthReason[];
  };
  readonly write: {
    readonly status: "disabled" | "blocked" | "ready" | "repairing";
    readonly reasons: readonly WriteHealthReason[];
  };
}

export interface HealthSnapshotProvider {
  current(): HealthSnapshot;
}

export function createHealthSnapshotProvider(
  current: () => HealthInputs,
  now: () => number = Date.now,
): HealthSnapshotProvider {
  return Object.freeze({
    current(): HealthSnapshot {
      const input = current();
      const processReasons: ProcessHealthReason[] = [];
      if (input.process?.repositoryHealthy === false) {
        processReasons.push("repository_unavailable");
      }
      if (input.process?.fatalCode) processReasons.push("fatal_error");
      const readReasons: ReadHealthReason[] = [];
      if (
        (input.read?.selectedPublications ?? 0) +
            (input.read?.overlayEntries ?? 0) === 0
      ) readReasons.push("no_read_sources");
      const writeReasons: WriteHealthReason[] = [];
      let writeStatus: HealthSnapshot["write"]["status"] = "ready";
      if (!input.write.enabled) {
        writeStatus = "disabled";
        writeReasons.push("write_disabled");
      } else {
        if (input.write.repositoryHealthy === false) {
          writeReasons.push("write_repository_unavailable");
        }
        if (input.write.signerStatus === "disconnected") {
          writeReasons.push("signer_disconnected");
        }
        if (input.write.signerStatus === "connecting") {
          writeReasons.push("signer_connecting");
        }
        if (input.write.signerStatus === "failed") {
          writeReasons.push(
            input.write.signerOwned === false
              ? "signer_ownership_mismatch"
              : "signer_failed",
          );
        }
        if (input.write.activationStatus === "initializing") {
          writeReasons.push("write_initializing");
        }
        if (input.write.activationStatus === "failed") {
          writeReasons.push("write_activation_failed");
        }
        if ((input.write.destinations ?? 0) === 0) {
          writeReasons.push("no_blossom_destination");
        }
        if ((input.write.relays ?? 0) === 0) {
          writeReasons.push("no_publication_relay");
        }
        if (
          input.write.publication?.phase === "replicating" &&
          !input.write.publication.completeReplica
        ) writeReasons.push("no_complete_replica");
        if (input.write.publication?.phase === "awaiting_relay") {
          writeReasons.push("relay_not_acknowledged");
        }
        if (input.write.publication?.phase === "repairing") {
          writeStatus = "repairing";
          writeReasons.push("repair_pending");
        } else if (writeReasons.length) writeStatus = "blocked";
      }
      return Object.freeze({
        timestamp: new Date(now()).toISOString(),
        process: Object.freeze({
          status: processReasons.length ? "failed" : "ok",
          reasons: Object.freeze(processReasons),
        }),
        read: Object.freeze({
          status: readReasons.length ? "unavailable" : "ok",
          reasons: Object.freeze(readReasons),
        }),
        write: Object.freeze({
          status: writeStatus,
          reasons: Object.freeze(writeReasons),
        }),
      });
    },
  });
}
