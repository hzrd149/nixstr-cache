import type { PinnedResponse, SourceTrust } from "../network/safe_fetcher.ts";
import type { VerifiedBlob } from "./blob_fetcher.ts";

export interface LocalCacheDiagnostic {
  readonly code:
    | "local_population_rejected"
    | "local_population_failed"
    | "local_population_descriptor_invalid";
  readonly origin: string;
  readonly hash: string;
  readonly retryable: true;
}

export interface UploadRequestInit {
  readonly method: "PUT";
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array>;
  readonly signal?: AbortSignal;
}

export interface UploadBoundary {
  request(
    input: string | URL,
    trust: SourceTrust,
    init: UploadRequestInit,
  ): Promise<PinnedResponse>;
}

export type CachePopulationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: LocalCacheDiagnostic };

export class BlobCacheSink {
  readonly #requester: UploadBoundary;
  readonly #origin: string;
  readonly #maxDescriptorBytes: number;

  constructor(options: {
    readonly request: UploadBoundary["request"];
    readonly localOrigin: string | URL;
    readonly maxDescriptorBytes: number;
  }) {
    this.#requester = { request: options.request };
    const url = new URL(options.localOrigin);
    this.#origin = url.origin;
    this.#maxDescriptorBytes = options.maxDescriptorBytes;
  }

  async populate(
    blob: VerifiedBlob,
    signal?: AbortSignal,
  ): Promise<CachePopulationResult> {
    const failure = (
      code: LocalCacheDiagnostic["code"],
    ): CachePopulationResult =>
      Object.freeze({
        ok: false,
        diagnostic: Object.freeze({
          code,
          origin: this.#origin,
          hash: blob.hash,
          retryable: true,
        }),
      });
    const body = blob.open();
    let response: PinnedResponse | undefined;
    try {
      response = await this.#requester.request(
        new URL("/upload", this.#origin),
        "configured",
        {
          method: "PUT",
          headers: new Headers({
            "content-length": String(blob.size),
            "content-type": "application/octet-stream",
            "x-sha-256": blob.hash,
          }),
          body,
          signal,
        },
      );
      if (response.status !== 200 && response.status !== 201) {
        await response.cancel("local population rejected");
        return failure("local_population_rejected");
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) > this.#maxDescriptorBytes) {
        await response.cancel("local population descriptor oversized");
        return failure("local_population_descriptor_invalid");
      }
      const reader = response.body.getReader();
      let received = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received += next.value.byteLength;
          if (received > this.#maxDescriptorBytes) {
            await reader.cancel("local population descriptor oversized");
            return failure("local_population_descriptor_invalid");
          }
        }
      } finally {
        reader.releaseLock();
      }
      return Object.freeze({ ok: true });
    } catch {
      try {
        await body.cancel("local population failed");
      } catch { /* already consumed or closed */ }
      return failure("local_population_failed");
    }
  }
}
