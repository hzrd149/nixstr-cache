import { EventStore } from "applesauce-core";
import type { Model } from "applesauce-core/event-store";
import {
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  startWith,
  Subject,
  Subscription,
} from "rxjs";
import { verifyEvent } from "nostr-tools";
import { projectBlossomServers } from "./blossom_servers.ts";
import { StateRepository } from "../persistence/state_repository.ts";
import {
  cacheIdentity,
  RawPublication,
  ValidatedPublication,
  validatePublication,
} from "../protocol/publication.ts";

export interface SelectedPublication extends ValidatedPublication {
  readonly bud03Servers: readonly string[];
}
export type MergedSelectionSnapshot = readonly SelectedPublication[];

export interface PublicationSelector {
  readonly selected$: Observable<MergedSelectionSnapshot>;
  current(): MergedSelectionSnapshot;
  accept(event: RawPublication): void;
  authorizePublicationPublisher(pubkey: string, identity: string): void;
  authorizeBlossomPublisher(pubkey: string): void;
  blossomServersFor(pubkey: string): readonly string[];
  watchBlossomServers(pubkey: string, callback: () => void): () => void;
  dispose(): void;
}

type TimerHandle = number | ReturnType<typeof setTimeout>;
interface ModelOptions {
  publishers: ReadonlySet<string>;
  identities: ReadonlySet<string>;
  identityOrder: readonly string[];
  now: () => number;
  refresh$: Observable<void>;
}

/** Authoritative reactive cache view derived exclusively from admitted store events. */
export function CacheSelectionModel(
  options: ModelOptions,
): Model<MergedSelectionSnapshot> {
  return (store) =>
    combineLatest([
      store.timeline([{ kinds: [17091, 37091] }]),
      store.timeline([{ kinds: [10063] }]),
      options.refresh$.pipe(startWith(undefined)),
    ]).pipe(
      map(([publicationEvents, serverEventList]) => {
        const publications = publicationEvents
          .map((event) =>
            validatePublication(event as RawPublication, options.now())
          )
          .filter((result) => result.ok)
          .map((result) => result.value)
          .filter((publication) =>
            options.publishers.has(publication.event.pubkey) &&
            options.identities.has(cacheIdentity(publication))
          );
        return Object.freeze(options.identityOrder.flatMap((identity) => {
          const publication = publications
            .filter((item) => cacheIdentity(item) === identity)
            .sort((a, b) =>
              b.event.created_at - a.event.created_at ||
              a.event.id.localeCompare(b.event.id)
            )[0];
          if (!publication) return [];
          const serverEvents = serverEventList
            .filter((event) => event.pubkey === publication.event.pubkey)
            .sort((a, b) =>
              b.created_at - a.created_at || a.id.localeCompare(b.id)
            );
          const bud03Servers = serverEvents.length
            ? projectBlossomServers(serverEvents[0], options.publishers)
            : [];
          return [Object.freeze({
            ...publication,
            bud03Servers: Object.freeze([...bud03Servers]),
          })];
        }));
      }),
      distinctUntilChanged((a, b) =>
        a.length === b.length && a.every((item, index) =>
          item.event.id === b[index].event.id &&
          JSON.stringify(item.bud03Servers) ===
            JSON.stringify(b[index].bud03Servers)
        )
      ),
    );
}
CacheSelectionModel.getKey = () => "cache-selection";

export interface SelectionOptions {
  readonly events: Observable<RawPublication>;
  readonly repository: StateRepository;
  readonly publisherPubkeys: readonly string[];
  readonly identities: readonly string[];
  readonly eventStore?: EventStore;
  readonly addAcceptedPublication?: (event: RawPublication) => unknown;
  readonly now?: () => number;
  readonly onReject?: (event: RawPublication, reason: string) => void;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancelSchedule?: (handle: TimerHandle) => void;
  readonly onAdmit?: (event: RawPublication) => void;
}

export function startPublicationSelection(
  options: SelectionOptions,
): PublicationSelector {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const schedule = options.schedule ??
    ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const publishers = new Set(options.publisherPubkeys);
  const blossomPublishers = new Set(options.publisherPubkeys);
  const identitySet = new Set(options.identities);
  const identityOrder = [...options.identities];
  const blossomEvents = new Map<string, RawPublication>();
  const ownsStore = options.eventStore === undefined;
  const store = options.eventStore ?? new EventStore({
    keepExpired: true,
    keepOldVersions: true,
    // Every admission path verifies first; do not let verifier annotate frozen events.
    verifyEvent: () => true,
  });
  const add = (event: RawPublication) =>
    store.add({ ...event, tags: event.tags.map((tag) => [...tag]) });
  const addPublication = options.addAcceptedPublication ?? add;
  const refresh = new Subject<void>();
  const selected$ = store.model(CacheSelectionModel, {
    publishers,
    identities: identitySet,
    identityOrder,
    now,
    refresh$: refresh,
  });
  let current: MergedSelectionSnapshot = Object.freeze([]);
  let expirationHandle: TimerHandle | undefined;
  let disposed = false;
  const blossomWatchers = new Map<string, Set<() => void>>();

  const clearExpiration = () => {
    if (expirationHandle !== undefined) cancelSchedule(expirationHandle);
    expirationHandle = undefined;
  };
  const modelSubscription = selected$.subscribe({
    next(value) {
      current = value;
      clearExpiration();
      const nearestExpiry = value.reduce<number | undefined>(
        (nearest, publication) =>
          publication.expiresAt === undefined
            ? nearest
            : nearest === undefined
            ? publication.expiresAt
            : Math.min(nearest, publication.expiresAt),
        undefined,
      );
      if (nearestExpiry !== undefined) {
        // JavaScript timers use a signed 32-bit millisecond delay. Long-lived
        // cache events (the production default is 30 days) must wake once at
        // the timer ceiling and recompute, rather than overflowing to 1ms.
        const delay = Math.min(
          2_147_483_647,
          Math.max(0, nearestExpiry - now()) * 1000,
        );
        expirationHandle = schedule(() => {
          expirationHandle = undefined;
          refresh.next();
        }, delay);
      }
    },
    error: options.onError,
  });

  const accept = (event: RawPublication) => {
    if (event.kind === 10063) {
      if (!blossomPublishers.has(event.pubkey) || !verifyEvent(event)) {
        options.onReject?.(event, "invalid-blossom-server-list");
        return;
      }
      const previous = blossomEvents.get(event.pubkey);
      if (
        previous &&
        (previous.created_at > event.created_at ||
          (previous.created_at === event.created_at && previous.id <= event.id))
      ) return;
      blossomEvents.set(event.pubkey, event);
      add(event);
      for (const callback of blossomWatchers.get(event.pubkey) ?? []) {
        callback();
      }
      return;
    }
    const result = validatePublication(event, now());
    if (!result.ok) return void options.onReject?.(event, result.error.code);
    if (!publishers.has(result.value.event.pubkey)) {
      return void options.onReject?.(event, "unauthorized-publisher");
    }
    if (!identitySet.has(cacheIdentity(result.value))) {
      return void options.onReject?.(event, "unauthorized-identity");
    }
    try {
      const acceptance = options.repository.accept(result.value);
      if (!acceptance.accepted) {
        return void options.onReject?.(event, acceptance.reason ?? "rejected");
      }
      addPublication(result.value.event);
      options.onAdmit?.(result.value.event);
    } catch (error) {
      options.onError?.(error);
    }
  };

  for (
    const stored of options.repository.loadSelections(({ identity, error }) =>
      options.onError?.(
        new Error(`corrupt stored selection ${identity}`, { cause: error }),
      )
    )
  ) {
    const result = validatePublication(stored.event as RawPublication, now());
    if (
      result.ok && publishers.has(result.value.event.pubkey) &&
      identitySet.has(cacheIdentity(result.value))
    ) addPublication(result.value.event);
  }
  const sourceSubscription: Subscription = options.events.subscribe({
    next: accept,
    error: options.onError,
  });
  return {
    selected$,
    current: () => current,
    accept,
    authorizePublicationPublisher(pubkey, identity) {
      publishers.add(pubkey);
      identitySet.add(identity);
      const previousIndex = identityOrder.indexOf(identity);
      if (previousIndex >= 0) identityOrder.splice(previousIndex, 1);
      identityOrder.unshift(identity);
      refresh.next();
    },
    authorizeBlossomPublisher(pubkey) {
      blossomPublishers.add(pubkey);
    },
    blossomServersFor(pubkey) {
      if (!blossomPublishers.has(pubkey)) return Object.freeze([]);
      const event = blossomEvents.get(pubkey);
      return event
        ? projectBlossomServers(event, blossomPublishers)
        : Object.freeze([]);
    },
    watchBlossomServers(pubkey, callback) {
      const callbacks = blossomWatchers.get(pubkey) ?? new Set<() => void>();
      callbacks.add(callback);
      blossomWatchers.set(pubkey, callbacks);
      return () => {
        callbacks.delete(callback);
        if (callbacks.size === 0) blossomWatchers.delete(pubkey);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearExpiration();
      sourceSubscription.unsubscribe();
      modelSubscription.unsubscribe();
      refresh.complete();
      blossomWatchers.clear();
      if (ownsStore) store.dispose();
    },
  };
}
