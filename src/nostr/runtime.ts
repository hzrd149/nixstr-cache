import { EventStore } from "applesauce-core";
import { castUser, type User } from "applesauce-common/casts";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "nostr-tools";
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

export interface NostrService {
  readonly pool: RelayPool;
  readonly store: EventStore;
  user(pubkey: string): User;
  relaySetFor(pubkeys: readonly string[]): Observable<string[]>;
  currentRelaySet(pubkeys: readonly string[]): readonly string[];
  followUserMetadata(pubkeys: readonly string[]): void;
  addAcceptedPublication(event: NostrEvent): NostrEvent;
  close(): void;
}

function serviceKey(config: ValidatedConfig): string {
  return JSON.stringify({
    extraRelays: config.extraRelays.map(String),
    bootstrapRelays: config.bootstrapRelays.map(String),
  });
}

function createGuardedStore(): {
  readonly store: EventStore;
  admit(event: NostrEvent): NostrEvent;
} {
  const admitted = new Set<string>();
  const store = new EventStore({
    keepExpired: true,
    keepOldVersions: true,
    verifyEvent: (event) =>
      verifyEvent(event) &&
      (![17091, 37091].includes(event.kind) || admitted.delete(event.id)),
  });
  return {
    store,
    admit(event) {
      admitted.add(event.id);
      try {
        const added = store.add({
          ...event,
          tags: event.tags.map((tag) => [...tag]),
        });
        if (!added || added.id !== event.id) {
          throw new Error(
            "accepted publication was not admitted to EventStore",
          );
        }
        return added;
      } finally {
        admitted.delete(event.id);
      }
    },
  };
}

function createService(
  config: ValidatedConfig,
  pool: RelayPool,
  store: EventStore,
  admitPublication: (event: NostrEvent) => NostrEvent,
): NostrService {
  const extraRelays = config.extraRelays.map(String);
  const bootstrapRelays = config.bootstrapRelays.map(String);
  const relaySets = new Map<string, readonly string[]>();
  const subscriptions: Subscription[] = [];
  const followedMetadata = new Set<string>();
  let closed = false;

  createEventLoaderForStore(store, pool, {
    lookupRelays: bootstrapRelays,
    extraRelays,
    followRelayHints: true,
  });

  const user = (pubkey: string) => castUser(pubkey, store);
  const relayKey = (pubkeys: readonly string[]) =>
    [...new Set(pubkeys)].sort().join(",");

  const service: NostrService = {
    pool,
    store,
    user,
    relaySetFor(pubkeys: readonly string[]) {
      const key = relayKey(pubkeys);
      const users = [...new Set(pubkeys)].map(user);
      return combineLatest(
        users.map((item) => item.outboxes$.pipe(startWith(undefined))),
      ).pipe(
        map((outboxes) => {
          const relays = new Set(extraRelays);
          for (const list of outboxes) {
            for (const relay of list ?? []) relays.add(relay);
          }
          return [...relays].sort();
        }),
        distinctUntilChanged((a, b) =>
          a.length === b.length &&
          a.every((relay, index) => relay === b[index])
        ),
        tap((relays) => relaySets.set(key, relays)),
      );
    },
    currentRelaySet(pubkeys: readonly string[]) {
      return relaySets.get(relayKey(pubkeys)) ?? extraRelays;
    },
    followUserMetadata(pubkeys: readonly string[]) {
      const pending = [...new Set(pubkeys)].filter((pubkey) => {
        if (followedMetadata.has(pubkey)) return false;
        followedMetadata.add(pubkey);
        return true;
      });
      if (pending.length === 0) return;
      subscriptions.push(
        pool.subscription([...new Set([...bootstrapRelays, ...extraRelays])], {
          kinds: [10002],
          authors: pending,
        }).subscribe({ next: (event) => void store.add(event) }),
      );
    },
    addAcceptedPublication(event: NostrEvent) {
      return admitPublication(event);
    },
    close() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      for (const subscription of subscriptions) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        store.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        pool.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) {
        throw new AggregateError(errors, "Nostr shutdown failed");
      }
    },
  };
  return Object.freeze(service);
}

/** Creates isolated resources for tests. Production uses the exports below. */
export function createNostrService(config: ValidatedConfig): NostrService {
  const guarded = createGuardedStore();
  return createService(
    config,
    new RelayPool(),
    guarded.store,
    guarded.admit,
  );
}

export const relayPool = new RelayPool();
const guardedEventStore = createGuardedStore();
export const eventStore = guardedEventStore.store;

let initializedKey: string | undefined;
let sharedService: NostrService | undefined;
let terminal = false;

export function initializeNostr(config: ValidatedConfig): NostrService {
  if (terminal) throw new Error("Nostr service has already been closed");
  const key = serviceKey(config);
  if (sharedService) {
    if (initializedKey !== key) {
      throw new Error("Nostr service is already initialized with other relays");
    }
    return sharedService;
  }
  initializedKey = key;
  return sharedService = createService(
    config,
    relayPool,
    eventStore,
    guardedEventStore.admit,
  );
}

export function nostrService(): NostrService {
  if (!sharedService) throw new Error("Nostr service is not initialized");
  return sharedService;
}

export function closeNostr(): void {
  if (terminal) return;
  terminal = true;
  sharedService?.close();
}

export const user = (pubkey: string): User => nostrService().user(pubkey);
export const relaySetFor = (pubkeys: readonly string[]) =>
  nostrService().relaySetFor(pubkeys);
export const currentRelaySet = (pubkeys: readonly string[]) =>
  nostrService().currentRelaySet(pubkeys);
export const followUserMetadata = (pubkeys: readonly string[]) =>
  nostrService().followUserMetadata(pubkeys);
export const addAcceptedPublication = (event: NostrEvent) =>
  nostrService().addAcceptedPublication(event);
