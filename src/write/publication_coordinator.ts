import type { EventTemplate } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import type { CacheIdentity } from "../config/config.ts";
import type {
  PendingInventoryEntry,
  WriteRepository,
} from "../persistence/write_repository.ts";
import type { RawPublication } from "../protocol/publication.ts";
import { validatePublication } from "../protocol/publication.ts";
import type { SignerCapability } from "../signer/capability.ts";
import type { PublicationSelector } from "../nostr/selection.ts";
import type { OperationalDiagnosticSink } from "../operations/diagnostics.ts";

export interface ReplicaPublisher {
  prove(
    server: string,
    entry: PendingInventoryEntry,
    signal?: AbortSignal,
  ): Promise<boolean>;
}
export interface RelayOutcome {
  readonly relay: string;
  readonly ok: boolean;
}
export interface PublicationCoordinatorOptions {
  readonly repository: WriteRepository;
  readonly signer: SignerCapability;
  readonly selector: PublicationSelector;
  readonly identity: CacheIdentity;
  readonly authorize?: () => Promise<void>;
  readonly blossomServers: readonly string[] | (() => readonly string[]);
  readonly nixSigKeys: readonly string[];
  readonly publicationRelays:
    | readonly string[]
    | (() => readonly string[]);
  readonly lifetimeSeconds: number;
  readonly now: () => number;
  readonly replica: ReplicaPublisher;
  readonly prepareReplicaAuthorization?: (
    servers: readonly string[],
    entries: readonly PendingInventoryEntry[],
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly publishRelays: (
    event: RawPublication,
    relays: readonly string[],
    signal?: AbortSignal,
  ) => Promise<readonly RelayOutcome[]>;
  readonly retry?: {
    readonly baseSeconds: number;
    readonly maxSeconds: number;
    readonly maxAttempts: number;
    readonly concurrency: number;
    readonly jitter: (kind: "replica" | "relay", target: string) => number;
  };
  readonly refreshLeadSeconds?: number;
  readonly operationTimeoutMs?: number;
  readonly diagnostics?: OperationalDiagnosticSink;
}

function exactTemplate(
  event: RawPublication,
  template: EventTemplate,
  pubkey: string,
): boolean {
  return event.pubkey === pubkey && event.kind === template.kind &&
    event.created_at === template.created_at &&
    event.content === template.content &&
    JSON.stringify(event.tags) === JSON.stringify(template.tags) &&
    verifyEvent(event);
}

export class PublicationCoordinator {
  #serial: Promise<void> = Promise.resolve();
  #timer?: ReturnType<typeof setTimeout>;
  #subscription?: { unsubscribe(): void };
  #closed = false;
  readonly #abort = new AbortController();
  constructor(readonly options: PublicationCoordinatorOptions) {}

  async #bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(
      this.options.operationTimeoutMs ?? 30_000,
    );
    const signal = AbortSignal.any([this.#abort.signal, timeout]);
    signal.throwIfAborted();
    return await Promise.race([
      operation(signal),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      ),
    ]);
  }

  tick(): Promise<void> {
    const work = this.#serial.then(() => this.#run());
    this.#serial = work.catch(() => {});
    return work;
  }

  start(): void {
    if (this.#closed || this.#subscription) return;
    this.#subscription = this.options.repository.changes$.subscribe(() =>
      this.#schedule(0)
    );
    this.#schedule(0);
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort("publication coordinator closed");
    const errors: unknown[] = [];
    try {
      this.#subscription?.unsubscribe();
    } catch (error) {
      errors.push(error);
    }
    this.#subscription = undefined;
    try {
      if (this.#timer !== undefined) clearTimeout(this.#timer);
    } catch (error) {
      errors.push(error);
    }
    this.#timer = undefined;
    try {
      this.options.repository.restoreClaimedWork(this.options.now());
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#serial;
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        "publication coordinator shutdown failed",
      );
    }
  }
  #schedule(delayMs?: number): void {
    if (this.#closed) return;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    const next = this.options.repository.nextDueWork();
    const computed = delayMs ??
      (next
        ? Math.max(0, next.nextAttemptAt - this.options.now()) * 1000
        : 1000);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.tick().catch(() => {}).finally(() => this.#schedule());
    }, computed);
  }

  async #run(): Promise<void> {
    this.#abort.signal.throwIfAborted();
    const o = this.options;
    await o.authorize?.();
    this.#abort.signal.throwIfAborted();
    o.repository.beginPublicationRefresh(
      o.now(),
      o.refreshLeadSeconds ??
        Math.min(86_400, Math.max(60, Math.floor(o.lifetimeSeconds / 10))),
    );
    const destinations = typeof o.blossomServers === "function"
      ? o.blossomServers()
      : o.blossomServers;
    const activeBeforeClaim = o.repository.publicationSaga();
    let saga = o.repository.claimPublication(destinations);
    if (!saga) return;
    const inventory = [...o.repository.publicationInventory(saga.batchId)];
    const publicationRelays = typeof o.publicationRelays === "function"
      ? o.publicationRelays()
      : o.publicationRelays;
    o.diagnostics?.emit({
      type: "batch_transition",
      code: activeBeforeClaim?.batchId === saga.batchId
        ? "batch_resumed"
        : "batch_claimed",
      batchId: saga.batchId,
      count: inventory.length,
      rootHash: saga.candidate.rootHex,
    });
    o.repository.ensureEndpointWork(
      saga.batchId,
      "replica",
      saga.destinations,
      o.now(),
    );
    o.repository.ensureEndpointWork(
      saga.batchId,
      "relay",
      publicationRelays,
      o.now(),
    );
    this.#emitProgress(saga.batchId);
    if (!saga.completeServer) {
      if (o.prepareReplicaAuthorization) {
        this.#emitStage(saga, "authorization", "started", inventory.length);
        try {
          await this.#bounded((signal) =>
            o.prepareReplicaAuthorization!(
              saga!.destinations,
              inventory,
              signal,
            )
          );
          this.#emitStage(
            saga,
            "authorization",
            "complete",
            inventory.length,
          );
        } catch (error) {
          this.#emitStage(
            saga,
            "authorization",
            "failed",
            inventory.length,
          );
          for (const server of saga.destinations) {
            this.#recordInitial("replica", server, false);
          }
          throw error;
        }
      }
      this.#emitStage(saga, "replication", "started", inventory.length);
      try {
        for (const server of saga.destinations) {
          let complete = true;
          for (const entry of inventory) {
            if (await o.replica.prove(server, entry, this.#abort.signal)) {
              o.repository.recordBlobProof(saga.batchId, server, entry.hash);
            } else complete = false;
          }
          if (o.repository.serverComplete(saga.batchId, server)) {
            o.repository.recordCompleteServer(saga.batchId, server);
          }
          this.#recordInitial(
            "replica",
            server,
            complete && o.repository.serverComplete(saga.batchId, server),
          );
        }
      } catch (error) {
        this.#emitStage(saga, "replication", "failed", inventory.length);
        for (const server of saga.destinations) {
          this.#recordInitial("replica", server, false);
        }
        throw error;
      }
      saga = o.repository.publicationSaga()!;
      if (!saga.completeServer) {
        this.#emitStage(saga, "replication", "waiting", inventory.length);
        return;
      }
      this.#emitStage(saga, "replication", "complete", inventory.length);
    }
    if (!saga.signedEvent) {
      const tags: string[][] = [];
      if (o.identity.kind === 37091) tags.push(["d", o.identity.identifier]);
      tags.push(["htree", `htree://${saga.candidate.nhash}`]);
      for (const server of saga.destinations) tags.push(["blossom", server]);
      for (const key of o.nixSigKeys) tags.push(["nixSigKey", key]);
      tags.push(["expiration", String(o.now() + o.lifetimeSeconds)]);
      const template: EventTemplate = {
        kind: o.identity.kind,
        created_at: Math.max(
          o.now(),
          ...o.repository.publicationHistory().map((item) =>
            (item.signedEvent?.created_at ?? -1) + 1
          ),
        ),
        tags,
        content: "",
      };
      this.#emitStage(saga, "root_signing", "started");
      let event: RawPublication;
      try {
        event = await this.#bounded((signal) =>
          o.signer.signEvent(template, signal)
        ) as RawPublication;
      } catch (error) {
        this.#emitStage(saga, "root_signing", "failed");
        throw error;
      }
      this.#abort.signal.throwIfAborted();
      if (!exactTemplate(event, template, o.identity.pubkey)) {
        this.#emitStage(saga, "root_signing", "failed");
        throw new Error("signer changed publication template");
      }
      const validation = validatePublication(event, o.now());
      if (!validation.ok) {
        this.#emitStage(saga, "root_signing", "failed");
        throw new Error(
          `signed publication rejected: ${validation.error.code}`,
        );
      }
      o.repository.recordSigned(
        saga.batchId,
        template as unknown as Record<string, unknown>,
        event,
      );
      saga = o.repository.publicationSaga()!;
      this.#emitStage(saga, "root_signing", "complete");
    }
    if (!saga.acknowledgedRelay) {
      const configured = new Set(publicationRelays);
      const expectedBatch = saga.batchId;
      const signedEvent = saga.signedEvent!;
      this.#emitStage(saga, "relay_publication", "started");
      let outcomes: readonly RelayOutcome[];
      try {
        outcomes = await this.#bounded((signal) =>
          o.publishRelays(signedEvent, publicationRelays, signal)
        );
      } catch (error) {
        this.#emitStage(saga, "relay_publication", "failed");
        throw error;
      }
      this.#abort.signal.throwIfAborted();
      if (o.repository.publicationSaga()?.batchId !== expectedBatch) return;
      for (const relay of publicationRelays) {
        this.#recordInitial(
          "relay",
          relay,
          outcomes.some((result) => result.relay === relay && result.ok),
        );
      }
      const acknowledged = outcomes.find((result) =>
        result.ok && configured.has(result.relay)
      );
      if (!acknowledged) {
        this.#emitStage(saga, "relay_publication", "waiting");
        return;
      }
      o.repository.recordRelayAcknowledgement(saga.batchId, acknowledged.relay);
      saga = o.repository.publicationSaga()!;
      this.#emitStage(saga, "relay_publication", "complete");
    }
    if (!saga.committed) {
      o.repository.commitPublication(saga.batchId);
      saga = o.repository.publicationSaga()!;
      o.diagnostics?.emit({
        type: "promotion",
        code: "publication_promoted",
        batchId: saga.batchId,
        eventId: saga.signedEvent!.id,
        rootHash: saga.candidate.rootHex,
      });
    }
    if (!saga.admitted) {
      this.#emitStage(saga, "selection_admission", "started");
      const event = saga.signedEvent!;
      if (
        !o.selector.current().some((selected) => selected.event.id === event.id)
      ) {
        o.selector.accept(event);
      }
      if (
        !o.selector.current().some((selected) => selected.event.id === event.id)
      ) {
        this.#emitStage(saga, "selection_admission", "failed");
        throw new Error("committed publication was not admitted by selector");
      }
      o.repository.markPublicationAdmitted(saga.batchId);
      this.#emitStage(saga, "selection_admission", "complete");
    }
    await this.#repair();
  }

  #emitStage(
    saga: import("../persistence/write_repository.ts").PublicationSaga,
    stage:
      | "authorization"
      | "replication"
      | "root_signing"
      | "relay_publication"
      | "selection_admission",
    status: "started" | "complete" | "waiting" | "failed",
    count?: number,
  ): void {
    this.options.diagnostics?.emit({
      type: "publication_stage",
      code: `${stage}_${status}`,
      stage,
      status,
      batchId: saga.batchId,
      rootHash: saga.candidate.rootHex,
      count,
    });
  }

  #retryOptions() {
    return this.options.retry ?? {
      baseSeconds: 30,
      maxSeconds: 3600,
      maxAttempts: 8,
      concurrency: 2,
      jitter: (_kind: "replica" | "relay", target: string) => {
        let hash = 2166136261;
        for (const byte of new TextEncoder().encode(target)) {
          hash = Math.imul(hash ^ byte, 16777619);
        }
        return (hash >>> 0) % 11;
      },
    };
  }
  #recordInitial(kind: "replica" | "relay", target: string, ok: boolean): void {
    const work = this.options.repository.endpointWork().find((row) =>
      row.kind === kind && row.target === target &&
      (row.status === "pending" || row.status === "claimed")
    );
    if (!work) return;
    const claimed = work.status === "claimed"
      ? work
      : this.options.repository.claimDueWork(
        this.options.now(),
        Number.MAX_SAFE_INTEGER,
      )
        .find((row) => row.kind === kind && row.target === target);
    if (claimed) {
      this.#outcome(claimed, ok, ok ? "ok" : "unavailable");
      this.#emitEndpoint(
        claimed,
        ok,
        ok ? "ok" : kind === "relay" ? "rejected" : "unavailable",
        0,
      );
    }
  }
  #outcome(
    work: import("../persistence/write_repository.ts").EndpointWork,
    ok: boolean,
    code: import("../persistence/write_repository.ts").EndpointWorkCode,
  ): void {
    const retry = this.#retryOptions();
    const attempt = work.attempts + 1;
    const exhausted = !ok && attempt >= retry.maxAttempts;
    const delay = Math.min(
      retry.maxSeconds,
      retry.baseSeconds * 2 ** Math.max(0, attempt - 1),
    );
    this.options.repository.recordEndpointOutcome(work, {
      ok,
      exhausted,
      code: exhausted ? "attempt_limit" : code,
      nextAttemptAt: this.options.now() + delay +
        retry.jitter(work.kind, work.target),
    });
    this.#emitProgress(work.batchId);
  }
  #emitProgress(batchId: number): void {
    const rows = this.options.repository.endpointWork().filter((row) =>
      row.batchId === batchId
    );
    const summarize = (kind: "replica" | "relay") => {
      const selected = rows.filter((row) => row.kind === kind);
      return {
        total: selected.length,
        succeeded: selected.filter((row) => row.status === "complete").length,
        failed:
          selected.filter((row) =>
            row.attempts > 0 && row.status !== "complete"
          ).length,
        retries: selected.reduce(
          (sum, row) => sum + Math.max(0, row.attempts - 1),
          0,
        ),
        exhausted: selected.filter((row) => row.status === "exhausted").length,
      };
    };
    const replicas = summarize("replica");
    const relays = summarize("relay");
    this.options.diagnostics?.emit({
      type: "publication_progress",
      code: "publication_progress",
      batchId,
      replicaTotal: replicas.total,
      replicaSucceeded: replicas.succeeded,
      replicaFailed: replicas.failed,
      replicaRetries: replicas.retries,
      replicaExhausted: replicas.exhausted,
      relayTotal: relays.total,
      relaySucceeded: relays.succeeded,
      relayFailed: relays.failed,
      relayRetries: relays.retries,
      relayExhausted: relays.exhausted,
      fullyPublished: replicas.total > 0 && relays.total > 0 &&
        replicas.succeeded === replicas.total &&
        relays.succeeded === relays.total,
    });
  }
  #emitEndpoint(
    work: import("../persistence/write_repository.ts").EndpointWork,
    ok: boolean,
    code: import("../persistence/write_repository.ts").EndpointWorkCode,
    durationMs: number,
  ): void {
    const saga = this.options.repository.publicationSagaByBatch(work.batchId);
    if (work.kind === "replica") {
      this.options.diagnostics?.emit({
        type: "replica_attempt",
        code: ok ? "replica_complete" : `replica_${code}`,
        rootHash: saga?.candidate.rootHex,
        endpoint: work.target,
        attempt: work.attempts + 1,
        count: saga
          ? this.options.repository.publicationInventory(saga.batchId).length
          : undefined,
        durationMs,
        ok,
      });
    } else {
      this.options.diagnostics?.emit({
        type: "relay_acknowledgement",
        code: ok ? "relay_acknowledged" : `relay_${code}`,
        eventId: saga?.signedEvent?.id,
        endpoint: work.target,
        attempt: work.attempts + 1,
        durationMs,
        ok,
      });
    }
  }
  async #repair(): Promise<void> {
    const o = this.options;
    await o.authorize?.();
    this.#abort.signal.throwIfAborted();
    const retry = this.#retryOptions();
    const due = o.repository.claimDueWork(o.now(), retry.concurrency);
    await Promise.all(due.map(async (work) => {
      const started = Date.now();
      const saga = o.repository.publicationSagaByBatch(work.batchId);
      if (!saga?.committed || !saga.signedEvent) {
        this.#outcome(work, false, "unavailable");
        return;
      }
      if (work.kind === "replica") {
        let ok = true;
        for (const entry of o.repository.publicationInventory(work.batchId)) {
          if (await o.replica.prove(work.target, entry, this.#abort.signal)) {
            o.repository.recordBlobProof(work.batchId, work.target, entry.hash);
          } else ok = false;
        }
        this.#outcome(
          work,
          ok && o.repository.serverComplete(work.batchId, work.target),
          "unavailable",
        );
        this.#emitEndpoint(
          work,
          ok && o.repository.serverComplete(work.batchId, work.target),
          "unavailable",
          Date.now() - started,
        );
      } else {
        const outcomes = await this.#bounded((signal) =>
          o.publishRelays(saga.signedEvent!, [work.target], signal)
        );
        this.#abort.signal.throwIfAborted();
        this.#outcome(
          work,
          outcomes.some((x) => x.relay === work.target && x.ok),
          "rejected",
        );
        this.#emitEndpoint(
          work,
          outcomes.some((x) => x.relay === work.target && x.ok),
          "rejected",
          Date.now() - started,
        );
      }
    }));
  }
}
