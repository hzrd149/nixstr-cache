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

export interface ReplicaPublisher {
  prove(server: string, entry: PendingInventoryEntry): Promise<boolean>;
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
  readonly blossomServers: readonly string[];
  readonly nixSigKeys: readonly string[];
  readonly publicationRelays: readonly string[];
  readonly lifetimeSeconds: number;
  readonly now: () => number;
  readonly replica: ReplicaPublisher;
  readonly publishRelays: (
    event: RawPublication,
    relays: readonly string[],
  ) => Promise<readonly RelayOutcome[]>;
  readonly retry?: {
    readonly baseSeconds: number;
    readonly maxSeconds: number;
    readonly maxAttempts: number;
    readonly concurrency: number;
    readonly jitter: (kind: "replica" | "relay", target: string) => number;
  };
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
  constructor(readonly options: PublicationCoordinatorOptions) {}

  tick(): Promise<void> {
    const work = this.#serial.then(() => this.#run());
    this.#serial = work.catch(() => {});
    return work;
  }

  async #run(): Promise<void> {
    const o = this.options;
    let saga = o.repository.claimPublication(o.blossomServers);
    if (!saga) return;
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
          if (await o.replica.prove(server, entry)) {
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
        created_at: o.now(),
        tags,
        content: "",
      };
      const event = await o.signer.signEvent(template) as RawPublication;
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
      const outcomes = await o.publishRelays(
        saga.signedEvent!,
        o.publicationRelays,
      );
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
    }
    if (!saga.admitted) {
      o.selector.accept(saga.signedEvent!);
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
    if (claimed) this.#outcome(claimed, ok, ok ? "ok" : "unavailable");
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
  async #repair(): Promise<void> {
    const o = this.options;
    const saga = o.repository.publicationSaga();
    if (!saga?.committed || !saga.signedEvent) return;
    const retry = this.#retryOptions();
    const due = o.repository.claimDueWork(o.now(), retry.concurrency);
    await Promise.all(due.map(async (work) => {
      if (work.kind === "replica") {
        let ok = true;
        for (const entry of o.repository.publicationInventory(work.batchId)) {
          if (await o.replica.prove(work.target, entry)) {
            o.repository.recordBlobProof(work.batchId, work.target, entry.hash);
          } else ok = false;
        }
        this.#outcome(
          work,
          ok && o.repository.serverComplete(work.batchId, work.target),
          "unavailable",
        );
      } else {
        const outcomes = await o.publishRelays(saga.signedEvent!, [
          work.target,
        ]);
        this.#outcome(
          work,
          outcomes.some((x) => x.relay === work.target && x.ok),
          "rejected",
        );
      }
    }));
  }
}
