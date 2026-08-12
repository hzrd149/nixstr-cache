import { BehaviorSubject, Observable, Subscription } from "rxjs";
import { StateRepository } from "../persistence/state_repository.ts";
import {
  cacheIdentity,
  RawPublication,
  ValidatedPublication,
  validatePublication,
} from "../protocol/publication.ts";

export interface SelectedPublication extends ValidatedPublication {}

export interface PublicationSelector {
  readonly selected$: Observable<SelectedPublication | undefined>;
  readonly identity?: string;
  current(): SelectedPublication | undefined;
  accept(event: RawPublication): void;
  dispose(): void;
}

type TimerHandle = number | ReturnType<typeof setTimeout>;

interface SelectionOptions {
  readonly events: Observable<RawPublication>;
  readonly repository: StateRepository;
  readonly identities?: readonly string[];
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
  // Private admission state: only verified, durably accepted ids enter it.
  const admittedEventIds = new Set<string>();
  const selected = new BehaviorSubject<SelectedPublication | undefined>(
    undefined,
  );
  let identity: string | undefined;
  let expirationHandle: TimerHandle | undefined;

  const clearExpiration = () => {
    if (expirationHandle !== undefined) cancelSchedule(expirationHandle);
    expirationHandle = undefined;
  };
  const expose = (publication: ValidatedPublication) => {
    clearExpiration();
    identity = cacheIdentity(publication);
    selected.next(publication);
    if (publication.expiresAt !== undefined) {
      expirationHandle = schedule(() => {
        expirationHandle = undefined;
        if (
          selected.value?.event.id === publication.event.id &&
          publication.expiresAt! <= now()
        ) selected.next(undefined);
      }, Math.max(0, publication.expiresAt - now()) * 1000);
    }
  };

  const accept = (event: RawPublication) => {
    const result = validatePublication(event, now());
    if (!result.ok) {
      options.onReject?.(event, result.error.code);
      return;
    }
    try {
      const acceptance = options.repository.accept(result.value);
      if (!acceptance.accepted) {
        options.onReject?.(event, acceptance.reason ?? "rejected");
        return;
      }
      // Admission is deliberately after validation and durable commit.
      admittedEventIds.add(result.value.event.id);
      expose(result.value);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const restored = options.identities
    ? options.identities.map((candidate) =>
      options.repository.loadSelection(candidate)
    ).filter((value) => value !== undefined)
    : options.repository.loadSelections();
  for (const stored of restored) {
    const result = validatePublication(stored.event as RawPublication, now());
    if (
      result.ok &&
      (!selected.value ||
        result.value.event.created_at > selected.value.event.created_at ||
        (result.value.event.created_at === selected.value.event.created_at &&
          result.value.event.id < selected.value.event.id))
    ) {
      admittedEventIds.add(stored.event.id);
      expose(result.value);
    }
  }

  const subscription: Subscription = options.events.subscribe({
    next: accept,
    error: options.onError,
  });
  return {
    selected$: selected.asObservable(),
    get identity() {
      return identity;
    },
    current: () => selected.value,
    accept,
    dispose: () => {
      clearExpiration();
      subscription.unsubscribe();
      selected.complete();
      admittedEventIds.clear();
    },
  };
}
