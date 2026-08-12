import type {
  BlobFetcher,
  BlobFetchLimits,
  VerifiedBlob,
} from "../blossom/blob_fetcher.ts";
import type { SourceCandidate } from "../blossom/source_plan.ts";
import {
  decodeManifest,
  type Manifest,
  type ManifestLimits,
  type ManifestLink,
} from "../protocol/hashtree.ts";

export interface TraversalLimits {
  readonly maxDepth: number;
  readonly maxLinks: number;
  readonly maxUniqueNodes: number;
  readonly maxDecodedBytes: number;
  readonly maxAttempts: number;
  readonly maxRedirects: number;
  readonly maxConcurrent: number;
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

export class RequestBudget {
  readonly limits: TraversalLimits;
  #links = 0;
  #nodes = new Set<string>();
  #decoded = 0;
  #attempts = 0;
  #redirects = 0;
  #concurrent = 0;
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
        if (method === "HEAD") return Object.freeze(descriptor);
        if (link.type === 0) {
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
          return Object.freeze({
            ...descriptor,
            body: await this.#fileStream(
              descriptor.hash,
              link.size,
              budget,
              manifests,
              signal,
            ),
          });
        }
        throw new Error("GET of a directory is unsupported");
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
  ): Promise<VerifiedBlob> {
    const release = budget.acquire();
    try {
      const limits: BlobFetchLimits = {
        maxAttempts: budget.limits.maxAttempts,
        maxTransferBytes: this.manifestLimits.maxWireBytes,
        ...(declaredSize === undefined
          ? {}
          : { declaredSize, maxTransferBytes: declaredSize }),
        beforeAttempt: () => budget.debitAttempt(),
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
    const blob = await this.#fetch(hash, budget, signal);
    try {
      const wire = await new Response(blob.open()).bytes();
      budget.debitDecoded(wire.length);
      const manifest = decodeManifest(wire, this.manifestLimits);
      cache.set(hash, manifest);
      return manifest;
    } finally {
      await blob.dispose();
    }
  }
  async #rawStream(
    hash: string,
    size: number,
    budget: RequestBudget,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.#fetch(hash, budget, signal, size);
    return cleanupStream(blob, size);
  }
  async #fileStream(
    hash: string,
    expectedSize: number,
    budget: RequestBudget,
    cache: Map<string, Manifest>,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const chunks: Array<{ hash: string; size: number }> = [];
    const stack: Array<{ hash: string; depth: number }> = [{ hash, depth: 1 }];
    let total = 0;
    while (stack.length) {
      const frame = stack.pop()!;
      budget.checkDepth(frame.depth);
      const manifest = await this.#manifest(frame.hash, budget, cache, signal);
      if (manifest.type !== "file") {
        throw new Error("file link did not resolve to a file manifest");
      }
      budget.debitLinks(manifest.links.length);
      for (let i = manifest.links.length - 1; i >= 0; i--) {
        const link = manifest.links[i];
        if (link.type === 1) {
          stack.push({ hash: link.hash.toHex(), depth: frame.depth + 1 });
        } else if (link.type === 0) {
          chunks.unshift({ hash: link.hash.toHex(), size: link.size });
        } else throw new Error("invalid file-manifest child type");
      }
    }
    total = chunks.reduce((n, chunk) => n + chunk.size, 0);
    if (total !== expectedSize) {
      throw new Error(
        "file manifest size differs from authenticated directory link",
      );
    }
    let index = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (true) {
          if (!reader) {
            if (index >= chunks.length) {
              controller.close();
              return;
            }
            reader = (await this.#rawStream(
              chunks[index].hash,
              chunks[index].size,
              budget,
              signal,
            )).getReader();
            index++;
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
      },
      cancel: (reason) => reader?.cancel(reason),
    });
  }
}

function cleanupStream(
  blob: VerifiedBlob,
  expected: number,
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
        controller.enqueue(next.value);
      } catch (error) {
        await finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await finish();
    },
  });
}
