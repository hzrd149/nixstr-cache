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

export interface PublicationSelector {
  readonly selected$: Observable<SelectedPublication | undefined>;
  readonly identity?: string;
  current(): SelectedPublication | undefined;
  accept(event: RawPublication): void;
  dispose(): void;
}

type TimerHandle = number | ReturnType<typeof setTimeout>;
interface ModelOptions {
  publishers: ReadonlySet<string>;
  identities: ReadonlySet<string>;
  now: () => number;
  refresh$: Observable<void>;
}

/** Authoritative reactive cache view derived exclusively from admitted store events. */
export function CacheSelectionModel(
  options: ModelOptions,
): Model<SelectedPublication | undefined> {
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
          )
          .sort((a, b) =>
            b.event.created_at - a.event.created_at ||
            a.event.id.localeCompare(b.event.id)
          );
        const publication = publications[0];
        if (!publication) return undefined;
        const serverEvents = serverEventList
          .filter((event) => event.pubkey === publication.event.pubkey)
          .sort((a, b) =>
            b.created_at - a.created_at || a.id.localeCompare(b.id)
          );
        const bud03Servers = serverEvents.length
          ? projectBlossomServers(serverEvents[0], options.publishers)
          : [];
        return Object.freeze({
          ...publication,
          bud03Servers: Object.freeze([...bud03Servers]),
        });
      }),
      distinctUntilChanged((a, b) =>
        a?.event.id === b?.event.id &&
        JSON.stringify(a?.bud03Servers) === JSON.stringify(b?.bud03Servers)
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
  readonly now?: () => number;
  readonly onReject?: (event: RawPublication, reason: string) => void;
  readonly onError?: (error: unknown) => void;
  readonly schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancelSchedule?: (handle: TimerHandle) => void;
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
  const identities = new Set(options.identities);
  const store = options.eventStore ?? new EventStore({
    keepExpired: true,
    keepOldVersions: true,
    // Every admission path verifies first; do not let verifier annotate frozen events.
    verifyEvent: () => true,
  });
  const add = (event: RawPublication) =>
    store.add({ ...event, tags: event.tags.map((tag) => [...tag]) });
  const refresh = new Subject<void>();
  const selected$ = store.model(CacheSelectionModel, {
    publishers,
    identities,
    now,
    refresh$: refresh,
  });
  let current: SelectedPublication | undefined;
  let identity: string | undefined;
  let expirationHandle: TimerHandle | undefined;
  let disposed = false;

  const clearExpiration = () => {
    if (expirationHandle !== undefined) cancelSchedule(expirationHandle);
    expirationHandle = undefined;
  };
  const modelSubscription = selected$.subscribe({
    next(value) {
      current = value;
      identity = value ? cacheIdentity(value) : identity;
      clearExpiration();
      if (value?.expiresAt !== undefined) {
        expirationHandle = schedule(() => {
          expirationHandle = undefined;
          refresh.next();
        }, Math.max(0, value.expiresAt - now()) * 1000);
      }
    },
    error: options.onError,
  });

  const accept = (event: RawPublication) => {
    if (event.kind === 10063) {
      if (!publishers.has(event.pubkey) || !verifyEvent(event)) {
        options.onReject?.(event, "invalid-blossom-server-list");
        return;
      }
      add(event);
      return;
    }
    const result = validatePublication(event, now());
    if (!result.ok) return void options.onReject?.(event, result.error.code);
    if (!publishers.has(result.value.event.pubkey)) {
      return void options.onReject?.(event, "unauthorized-publisher");
    }
    if (!identities.has(cacheIdentity(result.value))) {
      return void options.onReject?.(event, "unauthorized-identity");
    }
    try {
      const acceptance = options.repository.accept(result.value);
      if (!acceptance.accepted) {
        return void options.onReject?.(event, acceptance.reason ?? "rejected");
      }
      add(result.value.event);
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
      identities.has(cacheIdentity(result.value))
    ) add(result.value.event);
  }
  const sourceSubscription: Subscription = options.events.subscribe({
    next: accept,
    error: options.onError,
  });
  return {
    selected$,
    get identity() {
      return identity;
    },
    current: () => current,
    accept,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearExpiration();
      sourceSubscription.unsubscribe();
      modelSubscription.unsubscribe();
      refresh.complete();
      store.dispose();
    },
  };
}
