import { LruCache } from "@std/cache";
import type { SourceCandidate } from "../blossom/source_plan.ts";
import type { ValidatedManifest } from "../protocol/hashtree.ts";
import { debugHashtreeCache } from "../operations/debug.ts";

export type CachedManifest = ValidatedManifest;

function fingerprint(sources: readonly SourceCandidate[]): string {
  return JSON.stringify(sources.map((source) => [
    source.baseUrl,
    source.origin,
    source.trust,
    source.role,
  ]));
}

function waiter<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}

export class VerifiedManifestCache {
  readonly #completed: LruCache<string, CachedManifest>;
  readonly #inflight = new Map<string, Promise<CachedManifest>>();
  readonly #abort = new AbortController();
  readonly #maxDecodedBytes: number;
  #decodedBytes = 0;
  #close?: Promise<void>;

  constructor(maxEntries: number, maxDecodedBytes: number) {
    for (
      const [name, value] of Object.entries({ maxEntries, maxDecodedBytes })
    ) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    this.#maxDecodedBytes = maxDecodedBytes;
    this.#completed = new LruCache(maxEntries, {
      onEject: (_hash, value) => {
        this.#decodedBytes -= value.decodedBytes;
        this.#log("evict", _hash);
      },
    });
  }

  load(
    hash: string,
    sources: readonly SourceCandidate[],
    signal: AbortSignal | undefined,
    loader: (signal: AbortSignal) => Promise<CachedManifest>,
  ): Promise<CachedManifest> {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return Promise.reject(
        new TypeError("manifest hash must be normalized SHA-256 hex"),
      );
    }
    if (this.#abort.signal.aborted) {
      return Promise.reject(this.#abort.signal.reason);
    }
    const hit = this.#completed.get(hash);
    if (hit) {
      this.#log("hit", hash);
      return waiter(Promise.resolve(hit), signal);
    }
    const key = JSON.stringify([hash, fingerprint(sources)]);
    let shared = this.#inflight.get(key);
    if (shared) this.#log("inflight-join", hash);
    else {
      this.#log("miss", hash);
      shared = loader(this.#abort.signal).then((value) => {
        if (
          value.decodedBytes <= this.#maxDecodedBytes &&
          !this.#abort.signal.aborted
        ) {
          const prior = this.#completed.get(hash);
          if (prior) this.#completed.delete(hash);
          this.#decodedBytes += value.decodedBytes;
          this.#completed.set(hash, value);
          while (this.#decodedBytes > this.#maxDecodedBytes) {
            this.#completed.delete(this.#completed.keys().next().value!);
          }
          this.#log("admit", hash);
        } else this.#log("skip", hash);
        return value;
      }).catch((error) => {
        this.#log("error", hash);
        throw error;
      })
        .finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, shared);
    }
    return waiter(shared, signal);
  }

  close(): Promise<void> {
    return this.#close ??= (async () => {
      this.#abort.abort(
        new DOMException("manifest cache closed", "AbortError"),
      );
      await Promise.allSettled(this.#inflight.values());
      for (const hash of [...this.#completed.keys()]) {
        this.#completed.delete(hash);
      }
      this.#log("close", "");
    })();
  }

  #log(outcome: string, hash: string): void {
    debugHashtreeCache("manifest", {
      outcome,
      hash: hash.slice(0, 12),
      entries: this.#completed.size,
      decodedBytes: this.#decodedBytes,
      inflight: this.#inflight.size,
    });
  }
}
