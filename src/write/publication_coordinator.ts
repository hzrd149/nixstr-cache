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
  ) => Promise<readonly RelayOutcome[]>;
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
    if (!saga.completeServer) {
      const inventory = o.repository.publicationInventory(saga.batchId);
      for (const server of saga.destinations) {
        for (const entry of inventory) {
          if (await o.replica.prove(server, entry)) {
            o.repository.recordBlobProof(saga.batchId, server, entry.hash);
          }
        }
        if (o.repository.serverComplete(saga.batchId, server)) {
          o.repository.recordCompleteServer(saga.batchId, server);
          break;
        }
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
      const outcomes = await o.publishRelays(saga.signedEvent!);
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
  }
}
