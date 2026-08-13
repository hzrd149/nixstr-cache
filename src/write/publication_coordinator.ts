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
  readonly blossomServers: readonly string[] | (() => readonly string[]);
  readonly nixSigKeys: readonly string[];
  readonly publicationRelays: readonly string[];
  readonly lifetimeSeconds: number;
  readonly now: () => number;
  readonly replica: ReplicaPublisher;
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
    this.#closed = true;
    this.#abort.abort("publication coordinator closed");
    this.options.repository.restoreClaimedWork(this.options.now());
    this.#subscription?.unsubscribe();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#serial;
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
    o.repository.beginPublicationRefresh(
      o.now(),
      o.refreshLeadSeconds ??
        Math.min(86_400, Math.max(60, Math.floor(o.lifetimeSeconds / 10))),
    );
    const destinations = typeof o.blossomServers === "function"
      ? o.blossomServers()
      : o.blossomServers;
    let saga = o.repository.claimPublication(destinations);
    if (!saga) return;
    o.diagnostics?.emit({
      type: "batch_transition",
      code: "batch_claimed",
      batchId: saga.batchId,
      count: o.repository.publicationInventory(saga.batchId).length,
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
      o.publicationRelays,
      o.now(),
    );
    if (!saga.completeServer) {
      const inventory = o.repository.publicationInventory(saga.batchId);
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
      saga = o.repository.publicationSaga()!;
      if (!saga.completeServer) return;
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
      const event = await this.#bounded((signal) =>
        o.signer.signEvent(template, signal)
      ) as RawPublication;
      this.#abort.signal.throwIfAborted();
      if (!exactTemplate(event, template, o.identity.pubkey)) {
        throw new Error("signer changed publication template");
      }
      const validation = validatePublication(event, o.now());
      if (!validation.ok) {
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
    }
    if (!saga.acknowledgedRelay) {
      const configured = new Set(o.publicationRelays);
      const expectedBatch = saga.batchId;
      const signedEvent = saga.signedEvent!;
      const outcomes = await this.#bounded((signal) =>
        o.publishRelays(signedEvent, o.publicationRelays, signal)
      );
      this.#abort.signal.throwIfAborted();
      if (o.repository.publicationSaga()?.batchId !== expectedBatch) return;
      for (const relay of o.publicationRelays) {
        this.#recordInitial(
          "relay",
          relay,
          outcomes.some((result) => result.relay === relay && result.ok),
        );
      }
      const acknowledged = outcomes.find((result) =>
        result.ok && configured.has(result.relay)
      );
      if (!acknowledged) return;
      o.repository.recordRelayAcknowledgement(saga.batchId, acknowledged.relay);
      saga = o.repository.publicationSaga()!;
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
      const event = saga.signedEvent!;
      if (
        !o.selector.current().some((selected) => selected.event.id === event.id)
      ) {
        o.selector.accept(event);
      }
      if (
        !o.selector.current().some((selected) => selected.event.id === event.id)
      ) {
        throw new Error("committed publication was not admitted by selector");
      }
      o.repository.markPublicationAdmitted(saga.batchId);
    }
    await this.#repair();
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
