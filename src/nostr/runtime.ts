import { EventStore } from "applesauce-core";
import { castUser, type User } from "applesauce-common/casts";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { verifyEvent } from "nostr-tools";
import {
  combineLatest,
  distinctUntilChanged,
  map,
  type Observable,
  startWith,
  type Subscription,
  tap,
} from "rxjs";
import type { ValidatedConfig } from "../config/config.ts";

/** App-scoped Applesauce control plane. Feature services borrow these objects. */
export class NostrRuntime {
  readonly pool = new RelayPool();
  readonly store = new EventStore({ verifyEvent });
  #disposed = false;
  readonly #subscriptions: Subscription[] = [];
  readonly #extraRelays: readonly string[];
  readonly #bootstrapRelays: readonly string[];
  readonly #relaySets = new Map<string, readonly string[]>();

  constructor(config: ValidatedConfig) {
    this.#extraRelays = config.extraRelays.map(String);
    this.#bootstrapRelays = config.bootstrapRelays.map(String);
    createEventLoaderForStore(this.store, this.pool, {
      lookupRelays: config.bootstrapRelays.map(String),
      extraRelays: config.extraRelays.map(String),
      followRelayHints: true,
    });
  }

  user(pubkey: string): User {
    return castUser(pubkey, this.store);
  }

  relaySetFor(pubkeys: readonly string[]): Observable<string[]> {
    const key = [...pubkeys].sort().join(",");
    const users = pubkeys.map((pubkey) => this.user(pubkey));
    return combineLatest(
      users.map((user) => user.outboxes$.pipe(startWith(undefined))),
    ).pipe(
      map((outboxes) => {
        const relays = new Set(this.#extraRelays);
        for (const list of outboxes) {
          for (const relay of list ?? []) relays.add(relay);
        }
        return [...relays].sort();
      }),
      distinctUntilChanged((a, b) =>
        a.length === b.length && a.every((relay, index) => relay === b[index])
      ),
      tap((relays) => this.#relaySets.set(key, relays)),
    );
  }

  currentRelaySet(pubkeys: readonly string[]): readonly string[] {
    const key = [...pubkeys].sort().join(",");
    return this.#relaySets.get(key) ?? this.#extraRelays;
  }

  followUserMetadata(pubkeys: readonly string[]): void {
    if (pubkeys.length === 0) return;
    const relays = [
      ...new Set([
        ...this.#bootstrapRelays,
        ...this.#extraRelays,
      ]),
    ];
    this.#subscriptions.push(
      this.pool.subscription(relays, {
        kinds: [10002],
        authors: [...pubkeys],
      }).subscribe({ next: (event) => void this.store.add(event) }),
    );
  }

  followUser(pubkey: string): void {
    this.followUserMetadata([pubkey]);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }
    this.store.dispose();
    this.pool.close();
  }
}
