import { sha256 } from "@noble/hashes/sha2.js";
import type {
  PinnedResponse,
  SafeFetcher,
  SourceTrust,
} from "../network/safe_fetcher.ts";
import type { SourceCandidate } from "./source_plan.ts";
import { BlobLease, BlobStore } from "../persistence/blob_store.ts";

export class BlobAttemptError extends Error {
  constructor(
    message: string,
    readonly source?: SourceCandidate,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BlobAttemptError";
  }
}
export class HttpBlobError extends BlobAttemptError {}
export class BlobSizeError extends BlobAttemptError {}
export class HashMismatch extends BlobAttemptError {
  constructor(
    readonly expected: string,
    readonly actual: string,
    source: SourceCandidate,
  ) {
    super(`blob hash mismatch from ${source.origin}`, source);
    this.name = "HashMismatch";
  }
}
export class BlobUnavailable extends BlobAttemptError {
  constructor(readonly failures: readonly unknown[]) {
    super("all blob sources failed");
    this.name = "BlobUnavailable";
  }
}

export interface QuarantineRepository {
  isQuarantined(origin: string): boolean;
  quarantine(origin: string, reason: string, at: number): void;
  releaseQuarantine(origin: string): void;
}
export interface BlobFetchLimits {
  readonly maxAttempts: number;
  readonly maxTransferBytes: number;
  readonly declaredSize?: number;
  readonly beforeAttempt?: () => void;
  readonly onTransfer?: (bytes: number) => void;
}
export interface LocalCacheDiagnostic {
  readonly code: "local_hash_mismatch";
  readonly origin: string;
  readonly hash: string;
  readonly retryable: true;
}
type FetchBoundary = {
  fetch(
    input: string | URL,
    trust: SourceTrust,
    signal?: AbortSignal,
  ): Promise<PinnedResponse>;
};

const verifiedBrand: unique symbol = Symbol("VerifiedBlob");
async function removeIfPresent(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
export class VerifiedBlob {
  readonly [verifiedBrand] = true;
  #ownerReleased = false;
  #references = 1;
  #removal?: Promise<void>;
  readonly #lease?: BlobLease;
  constructor(
    readonly hash: string,
    readonly size: number,
    readonly path: string,
    readonly sourceRole: SourceCandidate["role"] = "publisher",
    lease?: BlobLease,
  ) {
    this.#lease = lease;
  }
  open(): ReadableStream<Uint8Array> {
    if (this.#ownerReleased) throw new Error("verified blob has been disposed");
    this.#references++;
    const path = this.path;
    const release = this.#release.bind(this);
    let file: Deno.FsFile | undefined;
    let released = false;
    const finish = async () => {
      if (released) return;
      released = true;
      try {
        file?.close();
      } catch { /* already closed */ }
      file = undefined;
      await release();
    };
    return new ReadableStream<Uint8Array>({
      async start() {
        try {
          file = await Deno.open(path, { read: true });
        } catch (error) {
          await finish();
          throw error;
        }
      },
      async pull(controller) {
        try {
          const buffer = new Uint8Array(64 * 1024);
          const count = await file!.read(buffer);
          if (count === null) {
            await finish();
            controller.close();
          } else controller.enqueue(buffer.subarray(0, count));
        } catch (error) {
          await finish();
          controller.error(error);
        }
      },
      async cancel() {
        await finish();
      },
    });
  }
  async dispose(): Promise<void> {
    if (this.#ownerReleased) return await (this.#removal ?? Promise.resolve());
    this.#ownerReleased = true;
    await this.#release();
  }
  async #release(): Promise<void> {
    this.#references--;
    if (this.#references === 0) {
      this.#removal ??= this.#lease
        ? Promise.resolve(this.#lease.release())
        : removeIfPresent(this.path);
      await this.#removal;
    }
  }
}

export class BlobFetcher {
  readonly #fetcher: FetchBoundary;
  readonly #quarantine: QuarantineRepository;
  readonly #store: BlobStore;
  readonly #inflight = new Map<
    string,
    Promise<SourceCandidate["role"]>
  >();
  readonly #onLocalDiagnostic?: (diagnostic: LocalCacheDiagnostic) => void;
  readonly #onVerifiedRemote?: (blob: VerifiedBlob) => void;
  constructor(
    options: {
      readonly fetcher: SafeFetcher | FetchBoundary;
      readonly quarantine: QuarantineRepository;
      readonly store: BlobStore;
      readonly onLocalDiagnostic?: (diagnostic: LocalCacheDiagnostic) => void;
      readonly onVerifiedRemote?: (blob: VerifiedBlob) => void;
    },
  ) {
    this.#fetcher = options.fetcher;
    this.#quarantine = options.quarantine;
    this.#store = options.store;
    this.#onLocalDiagnostic = options.onLocalDiagnostic;
    this.#onVerifiedRemote = options.onVerifiedRemote;
  }
  release(origin: string): void {
    this.#quarantine.releaseQuarantine(new URL(origin).origin);
  }

  async fetch(
    expectedHash: string,
    sources: readonly SourceCandidate[],
    limits: BlobFetchLimits,
    signal?: AbortSignal,
  ): Promise<VerifiedBlob> {
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
      throw new TypeError("expected hash must be lowercase SHA-256 hex");
    }
    const cached = this.#store.lookup(expectedHash);
    if (cached) {
      return new VerifiedBlob(
        cached.hash,
        cached.size,
        cached.path,
        "publisher",
        cached,
      );
    }
    let pending = this.#inflight.get(expectedHash);
    if (!pending) {
      pending = this.#populate(expectedHash, sources, limits, signal);
      this.#inflight.set(expectedHash, pending);
      pending.finally(() => this.#inflight.delete(expectedHash)).catch(
        () => {},
      );
    }
    const sourceRole = await pending;
    const lease = this.#store.lookup(expectedHash);
    if (!lease) throw new Error("verified blob disappeared after admission");
    return new VerifiedBlob(
      lease.hash,
      lease.size,
      lease.path,
      sourceRole,
      lease,
    );
  }

  async #populate(
    expectedHash: string,
    sources: readonly SourceCandidate[],
    limits: BlobFetchLimits,
    signal?: AbortSignal,
  ): Promise<SourceCandidate["role"]> {
    const failures: unknown[] = [];
    let attempts = 0;
    for (const source of sources) {
      if (attempts >= limits.maxAttempts) break;
      if (this.#quarantine.isQuarantined(source.origin)) continue;
      limits.beforeAttempt?.();
      attempts++;
      try {
        const blob = await this.#attempt(expectedHash, source, limits, signal);
        try {
          if (source.role === "publisher") this.#onVerifiedRemote?.(blob);
          return blob.sourceRole;
        } finally {
          await blob.dispose();
        }
      } catch (error) {
        failures.push(
          error instanceof BlobAttemptError
            ? error
            : new BlobAttemptError("blob source failed", source, {
              cause: error,
            }),
        );
        if (error instanceof HashMismatch) {
          if (source.role === "local-cache") {
            this.#onLocalDiagnostic?.(Object.freeze({
              code: "local_hash_mismatch",
              origin: source.origin,
              hash: expectedHash,
              retryable: true,
            }));
          } else {
            this.#quarantine.quarantine(
              source.origin,
              error.message,
              Date.now(),
            );
          }
        }
      }
    }
    if (failures.length === 1 && failures[0] instanceof HashMismatch) {
      throw failures[0];
    }
    throw new BlobUnavailable(Object.freeze(failures));
  }

  async #attempt(
    expectedHash: string,
    source: SourceCandidate,
    limits: BlobFetchLimits,
    signal?: AbortSignal,
  ): Promise<VerifiedBlob> {
    const url = `${source.baseUrl}/${expectedHash}`;
    let response: PinnedResponse | undefined;
    try {
      response = await this.#fetcher.fetch(url, source.trust, signal);
      if (response.status !== 200) {
        await response.cancel("non-success status");
        throw new HttpBlobError(
          `Blossom returned HTTP ${response.status}`,
          source,
        );
      }
      const lengthText = response.headers.get("content-length");
      if (lengthText !== null) {
        const length = Number(lengthText);
        if (
          !Number.isSafeInteger(length) || length < 0 ||
          length > limits.maxTransferBytes ||
          (limits.declaredSize !== undefined && length !== limits.declaredSize)
        ) {
          await response.cancel("invalid or oversized content length");
          throw new BlobSizeError(
            "invalid or oversized Content-Length",
            source,
          );
        }
      }
      const hash = sha256.create();
      const reader = response.body.getReader();
      let size = 0;
      let completed = false;
      const abort = () => reader.cancel(signal?.reason).catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (signal?.aborted) {
              throw signal.reason ?? new DOMException("aborted", "AbortError");
            }
            const { value, done } = await reader.read();
            if (done) {
              completed = true;
              controller.close();
              return;
            }
            limits.onTransfer?.(value.byteLength);
            size += value.byteLength;
            if (
              size > limits.maxTransferBytes ||
              (limits.declaredSize !== undefined && size > limits.declaredSize)
            ) throw new BlobSizeError("blob transfer limit exceeded", source);
            hash.update(value);
            controller.enqueue(value);
          } catch (error) {
            try {
              await reader.cancel(error);
            } catch { /* preserve original error */ }
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      });
      let admitted;
      try {
        admitted = await this.#store.admit(stream, {
          origin: "remote",
          reserveBytes: limits.declaredSize ?? limits.maxTransferBytes,
          expectedHash,
        });
      } catch (error) {
        const actual = hash.digest().toHex();
        if (completed && actual !== expectedHash) {
          throw new HashMismatch(expectedHash, actual, source);
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        reader.releaseLock();
      }
      if (limits.declaredSize !== undefined && size !== limits.declaredSize) {
        throw new BlobSizeError(
          "blob size differs from manifest declaration",
          source,
        );
      }
      const lease = this.#store.lookup(admitted.hash);
      if (!lease) throw new Error("admitted blob is unavailable");
      const result = new VerifiedBlob(
        admitted.hash,
        admitted.size,
        lease.path,
        source.role,
        lease,
      );
      return result;
    } finally {
      // PinnedResponse owns transport cleanup through body terminal state.
    }
  }
}

export function blobFailureSources(error: unknown): readonly string[] {
  const failures = error instanceof BlobUnavailable ? error.failures : [error];
  return Object.freeze([
    ...new Set(
      failures.flatMap((failure) =>
        failure instanceof BlobAttemptError && failure.source
          ? [failure.source.origin]
          : []
      ),
    ),
  ]);
}
