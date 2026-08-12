import { sha256 } from "@noble/hashes/sha2.js";
import type {
  PinnedResponse,
  SafeFetcher,
  SourceTrust,
} from "../network/safe_fetcher.ts";
import type { SourceCandidate } from "./source_plan.ts";

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
  #disposed = false;
  constructor(
    readonly hash: string,
    readonly size: number,
    readonly path: string,
  ) {}
  open(): ReadableStream<Uint8Array> {
    if (this.#disposed) throw new Error("verified blob has been disposed");
    const path = this.path;
    let file: Deno.FsFile | undefined;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        file = await Deno.open(path, { read: true });
        controller.enqueue(new Uint8Array());
      },
      async pull(controller) {
        const buffer = new Uint8Array(64 * 1024);
        const count = await file!.read(buffer);
        if (count === null) {
          file!.close();
          file = undefined;
          controller.close();
        } else controller.enqueue(buffer.subarray(0, count));
      },
      cancel() {
        try {
          file?.close();
        } catch { /* already closed */ }
        file = undefined;
      },
    });
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await removeIfPresent(this.path);
  }
}

export class BlobFetcher {
  readonly #fetcher: FetchBoundary;
  readonly #quarantine: QuarantineRepository;
  readonly #spoolDirectory: string;
  constructor(
    options: {
      readonly fetcher: SafeFetcher | FetchBoundary;
      readonly quarantine: QuarantineRepository;
      readonly spoolDirectory: string;
    },
  ) {
    this.#fetcher = options.fetcher;
    this.#quarantine = options.quarantine;
    this.#spoolDirectory = options.spoolDirectory;
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
    const failures: unknown[] = [];
    let attempts = 0;
    for (const source of sources) {
      if (attempts >= limits.maxAttempts) break;
      if (this.#quarantine.isQuarantined(source.origin)) continue;
      limits.beforeAttempt?.();
      attempts++;
      try {
        return await this.#attempt(expectedHash, source, limits, signal);
      } catch (error) {
        failures.push(error);
        if (error instanceof HashMismatch) {
          this.#quarantine.quarantine(source.origin, error.message, Date.now());
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
    let path: string | undefined;
    let file: Deno.FsFile | undefined;
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
      path = await Deno.makeTempFile({
        dir: this.#spoolDirectory,
        prefix: ".nixstr-spool-",
      });
      await Deno.chmod(path, 0o600);
      file = await Deno.open(path, { write: true, truncate: true });
      const hash = sha256.create();
      const reader = response.body.getReader();
      let size = 0;
      const abort = () => reader.cancel(signal?.reason).catch(() => {});
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          if (signal?.aborted) {
            throw signal.reason ?? new DOMException("aborted", "AbortError");
          }
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (
            size > limits.maxTransferBytes ||
            (limits.declaredSize !== undefined && size > limits.declaredSize)
          ) throw new BlobSizeError("blob transfer limit exceeded", source);
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) {
            offset += await file.write(value.subarray(offset));
          }
        }
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
      file.close();
      file = undefined;
      const actual = hash.digest().toHex();
      if (actual !== expectedHash) {
        throw new HashMismatch(expectedHash, actual, source);
      }
      const result = new VerifiedBlob(expectedHash, size, path);
      path = undefined;
      return result;
    } finally {
      try {
        file?.close();
      } catch { /* already closed */ }
      if (path) await removeIfPresent(path);
    }
  }
}
