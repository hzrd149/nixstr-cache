import { type Observable, Subject, type Subscription } from "rxjs";
import type { Filter } from "nostr-tools";
import type { ValidatedConfig } from "../config/config.ts";
import type { RawPublication } from "../protocol/publication.ts";
import { createNostrService, type NostrService } from "./runtime.ts";

export interface PublicationEventStream {
  readonly events: Observable<RawPublication>;
  followBlossomPublisher?(pubkey: string): void;
  followWritableCache?(
    pubkey: string,
    kind: 17091 | 37091,
    identifier: string,
  ): void;
  close(): void;
}

export function createPublicationEventStream(
  config: ValidatedConfig,
  service?: NostrService,
): PublicationEventStream {
  const nostr = service ?? createNostrService(config);
  const ownsService = service === undefined;
  const events = new Subject<RawPublication>();
  const subscriptions: Subscription[] = [];
  const followed = new Set(config.publisherPubkeys);
  const followedCaches = new Set(config.identities);
  let closed = false;

  const forward = (observable: Observable<RawPublication>) => {
    subscriptions.push(observable.subscribe({
      next: (event) => events.next(event),
      error: (error) => events.error(error),
    }));
  };

  if (config.publisherPubkeys.length > 0) {
    nostr.followUserMetadata(config.publisherPubkeys);
    forward(nostr.pool.subscription(
      nostr.relaySetFor(config.publisherPubkeys),
      [
        { kinds: [17091, 37091], authors: [...config.publisherPubkeys] },
        { kinds: [10063], authors: [...config.publisherPubkeys] },
      ],
    ) as Observable<RawPublication>);
  }

  const stream: PublicationEventStream = {
    events,
    followBlossomPublisher(pubkey: string) {
      if (closed || followed.has(pubkey)) return;
      followed.add(pubkey);
      forward(nostr.pool.subscription(nostr.relaySetFor([pubkey]), [{
        kinds: [10063],
        authors: [pubkey],
      }]) as Observable<RawPublication>);
    },
    followWritableCache(pubkey, kind, identifier) {
      const identity = `${kind}:${pubkey}:${identifier}`;
      if (closed || followedCaches.has(identity)) return;
      followedCaches.add(identity);
      const filter: Filter = {
        kinds: [kind],
        authors: [pubkey],
      };
      if (kind === 37091) filter["#d"] = [identifier];
      forward(nostr.pool.subscription(
        nostr.relaySetFor([pubkey]),
        [filter],
      ) as Observable<RawPublication>);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      events.complete();
      if (ownsService) nostr.close();
    },
  };
  return Object.freeze(stream);
}
