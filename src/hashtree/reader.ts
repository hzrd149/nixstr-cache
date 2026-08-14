import type {
  BlobFetcher,
  BlobFetchLimits,
  VerifiedBlob,
} from "../blossom/blob_fetcher.ts";
import { blobFailureSources } from "../blossom/blob_fetcher.ts";
import type { SourceCandidate } from "../blossom/source_plan.ts";
import {
  decodeValidatedManifest,
  type Manifest,
  type ManifestLimits,
  type ManifestLink,
} from "../protocol/hashtree.ts";
import {
  type CachedManifest,
  VerifiedManifestCache,
} from "./manifest_cache.ts";

export interface TraversalLimits {
  readonly maxDepth: number;
  readonly maxLinks: number;
  readonly maxUniqueNodes: number;
  readonly maxDecodedBytes: number;
  readonly maxAttempts: number;
  readonly maxRedirects: number;
  readonly maxConcurrent: number;
  readonly maxBlobTransferBytes: number;
  readonly maxTransferredBytes: number;
  readonly maxOutputBytes: number;
  readonly deadline: number;
}
export class BudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceeded";
  }
}
export class VerifiedAbsent extends Error {
  constructor(path: string) {
    super(`verified path is absent: ${path}`);
    this.name = "VerifiedAbsent";
  }
}
export class NarResolutionFailed extends Error {
  constructor(
    readonly path: string,
    readonly sources: readonly string[],
    options?: ErrorOptions,
  ) {
    super(`tree path failed to resolve: ${path}`, options);
    this.name = "NarResolutionFailed";
  }
}

export class RequestBudget {
  readonly limits: TraversalLimits;
  #links = 0;
  #nodes = new Set<string>();
  #decoded = 0;
  #attempts = 0;
  #redirects = 0;
  #concurrent = 0;
  #transferred = 0;
  #output = 0;
  constructor(limits: TraversalLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
      }
    }
    this.limits = Object.freeze({ ...limits });
  }
  checkDepth(depth: number): void {
    this.#live();
    if (depth > this.limits.maxDepth) {
      throw new BudgetExceeded("traversal depth exceeded");
    }
  }
  debitLinks(count: number): void {
    this.#live();
    if (this.#links + count > this.limits.maxLinks) {
      throw new BudgetExceeded("link budget exceeded");
    }
    this.#links += count;
  }
  visit(hash: string): boolean {
    this.#live();
    if (this.#nodes.has(hash)) return false;
    if (this.#nodes.size >= this.limits.maxUniqueNodes) {
      throw new BudgetExceeded("unique-node budget exceeded");
    }
    this.#nodes.add(hash);
    return true;
  }
  debitDecoded(count: number): void {
    this.#live();
    if (this.#decoded + count > this.limits.maxDecodedBytes) {
      throw new BudgetExceeded("decoded-byte budget exceeded");
    }
    this.#decoded += count;
  }
  debitAttempt(): void {
    this.#live();
    if (this.#attempts >= this.limits.maxAttempts) {
      throw new BudgetExceeded("source-attempt budget exceeded");
    }
    this.#attempts++;
  }
  debitRedirect(): void {
    this.#live();
    if (this.#redirects >= this.limits.maxRedirects) {
      throw new BudgetExceeded("redirect budget exceeded");
    }
    this.#redirects++;
  }
  get remainingTransferBytes(): number {
    return this.limits.maxTransferredBytes - this.#transferred;
  }
  get remainingOutputBytes(): number {
    return this.limits.maxOutputBytes - this.#output;
  }
  debitTransfer(count: number): void {
    this.#live();
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(
        "transfer debit must be a non-negative safe integer",
      );
    }
    if (count > this.remainingTransferBytes) {
      throw new BudgetExceeded("request transfer budget exceeded");
    }
    this.#transferred += count;
  }
  ensureOutputAvailable(count: number): void {
    this.#live();
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("output size must be a non-negative safe integer");
    }
    if (count > this.remainingOutputBytes) {
      throw new BudgetExceeded("request output budget exceeded");
    }
  }
  debitOutput(count: number): void {
    this.ensureOutputAvailable(count);
    this.#output += count;
  }
  acquire(): () => void {
    this.#live();
    if (this.#concurrent >= this.limits.maxConcurrent) {
      throw new BudgetExceeded("concurrency budget exceeded");
    }
    this.#concurrent++;
    let held = true;
    return () => {
      if (held) {
        held = false;
        this.#concurrent--;
      }
    };
  }
  #live(): void {
    if (Date.now() >= this.limits.deadline) {
      throw new BudgetExceeded("request deadline exceeded");
    }
  }
}

export interface ResolvedPath {
  readonly hash: string;
  readonly size: number;
  readonly type: ManifestLink["type"];
  readonly body?: ReadableStream<Uint8Array>;
}

export class PathResolver {
  constructor(
    readonly blobs: BlobFetcher,
    readonly sources: readonly SourceCandidate[],
    readonly manifestLimits: ManifestLimits,
    readonly manifestCache?: VerifiedManifestCache,
  ) {}

  async resolve(
    rootHash: string,
    path: string,
    method: "GET" | "HEAD",
    budget: RequestBudget,
    signal?: AbortSignal,
  ): Promise<ResolvedPath> {
    const manifests = new Map<string, Manifest>();
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) throw new VerifiedAbsent(path);
    let hash = rootHash;
    let expected: 2 | 3 = 2;
    let segmentIndex = 0;
    let depth = 0;
    while (true) {
      budget.checkDepth(++depth);
      const manifest = await this.#manifest(hash, budget, manifests, signal);
      if (
        (expected === 2 && manifest.type !== "directory") ||
        (expected === 3 && manifest.type !== "fanout")
      ) {
        throw new Error(
          "linked manifest type does not match authenticated link",
        );
      }
      budget.debitLinks(manifest.links.length);
      const segment = segments[segmentIndex];
      let link: ManifestLink | undefined;
      if (manifest.type === "directory") {
        link = manifest.links.find((item) => item.name === segment);
      } else {link = manifest.links.find((item) => {
          const m = item.metadata!;
          return typeof m.first === "string" && typeof m.last === "string" &&
            segment >= m.first && segment <= m.last;
        });}
      if (!link) throw new VerifiedAbsent(path);
      if (manifest.type === "fanout") {
        hash = link.hash.toHex();
        expected = link.type as 2 | 3;
        continue;
      }
      const final = segmentIndex === segments.length - 1;
      if (final) {
        const descriptor = {
          hash: link.hash.toHex(),
          size: link.size,
          type: link.type,
        };
        try {
          if (link.type === 0) {
            if (method === "HEAD") return Object.freeze(descriptor);
            return Object.freeze({
              ...descriptor,
              body: await this.#rawStream(
                descriptor.hash,
                link.size,
                budget,
                signal,
              ),
            });
          }
          if (link.type === 1) {
            const plan = await this.#filePlan(
              descriptor.hash,
              link.size,
              budget,
              manifests,
              signal,
            );
            const resolved = { ...descriptor, size: plan.size };
            if (method === "HEAD") return Object.freeze(resolved);
            return Object.freeze({
              ...resolved,
              body: await this.#fileStream(
                plan.chunks,
                budget,
                signal,
              ),
            });
          }
          throw new Error("GET of a directory is unsupported");
        } catch (error) {
          const sources = blobFailureSources(error);
          if (sources.length === 0) throw error;
          throw new NarResolutionFailed(path, sources, { cause: error });
        }
      }
      if (link.type !== 2 && link.type !== 3) throw new VerifiedAbsent(path);
      segmentIndex++;
      hash = link.hash.toHex();
      expected = link.type;
    }
  }

  async #fetch(
    hash: string,
    budget: RequestBudget,
    signal?: AbortSignal,
    declaredSize?: number,
    transferCeiling = budget.limits.maxBlobTransferBytes,
  ): Promise<VerifiedBlob> {
    if (
      declaredSize !== undefined &&
      declaredSize > budget.limits.maxBlobTransferBytes
    ) {
      throw new BudgetExceeded("per-blob transfer budget exceeded");
    }
    const release = budget.acquire();
    try {
      const maxTransferBytes = Math.min(
        budget.limits.maxBlobTransferBytes,
        budget.remainingTransferBytes,
        transferCeiling,
        declaredSize ?? Number.MAX_SAFE_INTEGER,
      );
      if (maxTransferBytes <= 0) {
        throw new BudgetExceeded("request transfer budget exceeded");
      }
      const limits: BlobFetchLimits = {
        maxAttempts: budget.limits.maxAttempts,
        maxTransferBytes,
        ...(declaredSize === undefined ? {} : { declaredSize }),
        beforeAttempt: () => budget.debitAttempt(),
        onTransfer: (bytes) => budget.debitTransfer(bytes),
      };
      return await this.blobs.fetch(hash, this.sources, limits, signal);
    } finally {
      release();
    }
  }
  async #manifest(
    hash: string,
    budget: RequestBudget,
    cache: Map<string, Manifest>,
    signal?: AbortSignal,
  ): Promise<Manifest> {
    const cached = cache.get(hash);
    if (cached) return cached;
    budget.visit(hash);
    const load = async (
      loaderSignal?: AbortSignal,
    ): Promise<CachedManifest> => {
      const blob = await this.#fetch(
        hash,
        budget,
        loaderSignal,
        undefined,
        this.manifestLimits.maxWireBytes,
      );
      try {
        const wire = await new Response(blob.open()).bytes();
        return decodeValidatedManifest(wire, this.manifestLimits);
      } finally {
        await blob.dispose();
      }
    };
    const decoded = this.manifestCache
      ? await this.manifestCache.load(hash, this.sources, signal, load)
      : await load(signal);
    budget.debitDecoded(decoded.decodedBytes);
    cache.set(hash, decoded.manifest);
    return decoded.manifest;
  }
  async #rawStream(
    hash: string,
    size: number,
    budget: RequestBudget,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.#fetch(hash, budget, signal, size);
    return cleanupStream(blob, size, budget);
  }
  async #filePlan(
    hash: string,
    expectedSize: number,
    budget: RequestBudget,
    cache: Map<string, Manifest>,
    signal?: AbortSignal,
  ): Promise<{
    readonly size: number;
    readonly chunks: readonly {
      readonly hash: string;
      readonly size: number;
    }[];
  }> {
    const visit = async (
      manifestHash: string,
      depth: number,
    ): Promise<{
      readonly size: number;
      readonly chunks: readonly {
        readonly hash: string;
        readonly size: number;
      }[];
    }> => {
      signal?.throwIfAborted();
      budget.checkDepth(depth);
      const manifest = await this.#manifest(
        manifestHash,
        budget,
        cache,
        signal,
      );
      if (manifest.type !== "file") {
        throw new Error("file link did not resolve to a file manifest");
      }
      budget.debitLinks(manifest.links.length);
      let total = 0;
      const chunks: { hash: string; size: number }[] = [];
      for (const link of manifest.links) {
        let representedSize: number;
        if (link.type === 0) {
          representedSize = link.size;
          chunks.push({ hash: link.hash.toHex(), size: link.size });
        } else if (link.type === 1) {
          const child = await visit(link.hash.toHex(), depth + 1);
          if (link.size !== child.size) {
            throw new Error(
              "nested file manifest size differs from authenticated link",
            );
          }
          representedSize = child.size;
          for (const chunk of child.chunks) chunks.push(chunk);
        } else throw new Error("invalid file-manifest child type");
        if (!Number.isSafeInteger(total + representedSize)) {
          throw new BudgetExceeded("file output size is not a safe integer");
        }
        total += representedSize;
        budget.ensureOutputAvailable(total);
      }
      return Object.freeze({
        size: total,
        chunks: Object.freeze(chunks),
      });
    };
    const plan = await visit(hash, 1);
    if (expectedSize !== plan.size) {
      throw new Error(
        "file manifest size differs from authenticated directory link",
      );
    }
    return Object.freeze({ size: plan.size, chunks: plan.chunks });
  }
  #fileStream(
    chunks: readonly { readonly hash: string; readonly size: number }[],
    budget: RequestBudget,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    let index = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancelled = false;
    const abort = new AbortController();
    const streamSignal = signal
      ? AbortSignal.any([signal, abort.signal])
      : abort.signal;
    const cancelReader = async (reason?: unknown) => {
      const current = reader;
      reader = undefined;
      if (!current) return;
      try {
        await current.cancel(reason);
      } finally {
        current.releaseLock();
      }
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          while (true) {
            if (!reader) {
              const chunk = chunks[index++];
              if (!chunk) {
                controller.close();
                return;
              }
              const stream = await this.#rawStream(
                chunk.hash,
                chunk.size,
                budget,
                streamSignal,
              );
              if (cancelled) {
                await stream.cancel();
                return;
              }
              reader = stream.getReader();
            }
            const next = await reader.read();
            if (next.done) {
              reader.releaseLock();
              reader = undefined;
              continue;
            }
            controller.enqueue(next.value);
            return;
          }
        } catch (error) {
          await cancelReader(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        abort.abort(reason);
        await cancelReader(reason);
      },
    });
  }
}

function cleanupStream(
  blob: VerifiedBlob,
  expected: number,
  budget: RequestBudget,
): ReadableStream<Uint8Array> {
  const reader = blob.open().getReader();
  let emitted = 0;
  let finished = false;
  const finish = async () => {
    if (!finished) {
      finished = true;
      await blob.dispose();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (emitted !== expected) {
            throw new Error("verified stream size changed");
          }
          await finish();
          controller.close();
          return;
        }
        emitted += next.value.byteLength;
        if (emitted > expected) {
          throw new Error("verified stream exceeds authenticated size");
        }
        budget.debitOutput(next.value.byteLength);
        controller.enqueue(next.value);
      } catch (error) {
        try {
          await reader.cancel(error);
        } finally {
          reader.releaseLock();
          await finish();
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
        await finish();
      }
    },
  });
}
