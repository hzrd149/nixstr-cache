import { sha256 } from "@noble/hashes/sha2.js";
import { encodeManifest, type ManifestLink } from "../protocol/hashtree.ts";
import { encodePlaintextNhash } from "../protocol/nhash.ts";

export const FILE_CHUNK_BYTES = 2_097_152;

export interface LogicalFile {
  readonly route: string;
  readonly path: string;
  readonly size: number;
}
export interface CandidateBlob {
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}
export interface HashtreeBuild {
  readonly rootHex: string;
  readonly rootNhash: string;
  readonly rootPath: string;
  readonly inventory: readonly CandidateBlob[];
  readonly totalBytes: number;
  readonly createdBlobs: number;
}
export interface WriterLimits {
  readonly maxLinks: number;
  readonly maxInventoryBlobs: number;
  readonly maxInventoryBytes: number;
  readonly maxEntries?: number;
  readonly maxRouteBytes?: number;
  readonly maxRouteDepth?: number;
}
export type LogicalFileSource =
  | Iterable<LogicalFile>
  | AsyncIterable<LogicalFile>;
type Node = { files: Map<string, LogicalFile>; directories: Map<string, Node> };
type Built = CandidateBlob & {
  bytes: Uint8Array;
  type: 0 | 1 | 2 | 3;
  count: number;
  first?: string;
  last?: string;
};

const encoder = new TextEncoder();
const compareUtf8 = (a: string, b: string) => {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
};
const hexBytes = (hex: string) => Uint8Array.fromHex(hex);

export class HashtreeWriter {
  constructor(readonly root: string, readonly limits: WriterLimits) {
    if (limits.maxLinks < 2) {
      throw new RangeError("maxLinks must be at least two");
    }
    Deno.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  async build(
    files: LogicalFileSource,
    _base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild> {
    const inventory = new Map<string, CandidateBlob>();
    let created = 0, total = 0;
    const persist = async (bytes: Uint8Array): Promise<CandidateBlob> => {
      signal?.throwIfAborted();
      const hash = sha256(bytes).toHex();
      const path = `${this.root}/${hash}`;
      if (!inventory.has(hash)) {
        total += bytes.length;
        if (
          inventory.size + 1 > this.limits.maxInventoryBlobs ||
          total > this.limits.maxInventoryBytes
        ) {
          throw new RangeError("candidate inventory ceiling exceeded");
        }
        try {
          await Deno.writeFile(path, bytes, { createNew: true, mode: 0o600 });
          created++;
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
        inventory.set(hash, Object.freeze({ hash, size: bytes.length, path }));
      }
      return inventory.get(hash)!;
    };
    const tree: Node = { files: new Map(), directories: new Map() };
    const orderedFiles: LogicalFileSource = Array.isArray(files)
      ? [...files].sort((a, b) => compareUtf8(a.route, b.route))
      : files;
    let previousRoute: string | undefined;
    let entries = 0;
    for await (const file of orderedFiles) {
      signal?.throwIfAborted();
      if (
        ++entries > (this.limits.maxEntries ?? this.limits.maxInventoryBlobs)
      ) {
        throw new RangeError("logical entry ceiling exceeded");
      }
      const parts = file.route.split("/").filter(Boolean);
      if (
        !parts.length ||
        parts.some((x) => x === "." || x === ".." || x.includes("\0"))
      ) throw new Error("unsafe logical route");
      if (
        encoder.encode(file.route).length > (this.limits.maxRouteBytes ?? 4096)
      ) {
        throw new RangeError("logical route byte ceiling exceeded");
      }
      if (parts.length > (this.limits.maxRouteDepth ?? 32)) {
        throw new RangeError("logical route depth ceiling exceeded");
      }
      if (
        previousRoute !== undefined &&
        compareUtf8(previousRoute, file.route) >= 0
      ) {
        throw new Error("logical routes must be strictly UTF-8 ordered");
      }
      previousRoute = file.route;
      let node = tree;
      for (const part of parts.slice(0, -1)) {
        let child = node.directories.get(part);
        if (!child) {
          child = { files: new Map(), directories: new Map() };
          node.directories.set(part, child);
        }
        node = child;
      }
      node.files.set(parts.at(-1)!, file);
    }
    const buildFile = async (file: LogicalFile): Promise<Built> => {
      const handle = await Deno.open(file.path, { read: true });
      const links: ManifestLink[] = [];
      let observed = 0;
      try {
        for (;;) {
          signal?.throwIfAborted();
          const chunk = new Uint8Array(FILE_CHUNK_BYTES);
          let used = 0;
          while (used < chunk.length) {
            signal?.throwIfAborted();
            const n = await handle.read(chunk.subarray(used));
            if (n === null) break;
            used += n;
          }
          if (!used) break;
          observed += used;
          const blob = await persist(chunk.slice(0, used));
          links.push(
            Object.freeze({ hash: hexBytes(blob.hash), size: used, type: 0 }),
          );
        }
      } finally {
        handle.close();
      }
      if (observed !== file.size) throw new Error("frozen file size changed");
      const built = await this.buildLinkTree("file", links, persist);
      return {
        ...built,
        bytes: await Deno.readFile(built.path),
        type: built.type,
        count: 1,
      };
    };
    const buildDir = async (node: Node): Promise<Built> => {
      const named: { name: string; built: Built }[] = [];
      for (const [name, child] of node.directories) {
        named.push({ name, built: await buildDir(child) });
      }
      for (const [name, file] of node.files) {
        named.push({ name, built: await buildFile(file) });
      }
      named.sort((a, b) => compareUtf8(a.name, b.name));
      const links: ManifestLink[] = named.map(({ name, built }) =>
        Object.freeze({
          hash: hexBytes(built.hash),
          name,
          size: built.size,
          type: built.type,
        })
      );
      return this.buildDirectoryTree(links, persist);
    };
    const root = await buildDir(tree);
    return Object.freeze({
      rootHex: root.hash,
      rootNhash: encodePlaintextNhash(hexBytes(root.hash)),
      rootPath: root.path,
      inventory: Object.freeze(
        [...inventory.values()].sort((a, b) => a.hash.localeCompare(b.hash)),
      ),
      totalBytes: total,
      createdBlobs: created,
    });
  }
  private async buildLinkTree(
    kind: "file",
    links: ManifestLink[],
    persist: (bytes: Uint8Array) => Promise<CandidateBlob>,
  ): Promise<Built> {
    if (links.length <= this.limits.maxLinks) {
      const bytes = encodeManifest({ type: kind, links });
      const blob = await persist(bytes);
      return { ...blob, bytes, type: 1, count: 1 };
    }
    const parents: ManifestLink[] = [];
    for (let i = 0; i < links.length; i += this.limits.maxLinks) {
      const child = await this.buildLinkTree(
        kind,
        links.slice(i, i + this.limits.maxLinks),
        persist,
      );
      parents.push({ hash: hexBytes(child.hash), size: child.size, type: 1 });
    }
    return this.buildLinkTree(kind, parents, persist);
  }
  private async buildDirectoryTree(
    links: ManifestLink[],
    persist: (bytes: Uint8Array) => Promise<CandidateBlob>,
  ): Promise<Built> {
    if (links.length <= this.limits.maxLinks) {
      const bytes = encodeManifest({ type: "directory", links });
      const blob = await persist(bytes);
      return {
        ...blob,
        bytes,
        type: 2,
        count: links.length,
        first: links[0]?.name,
        last: links.at(-1)?.name,
      };
    }
    const fanout: ManifestLink[] = [];
    for (let i = 0; i < links.length; i += this.limits.maxLinks) {
      const child = await this.buildDirectoryTree(
        links.slice(i, i + this.limits.maxLinks),
        persist,
      );
      fanout.push({
        hash: hexBytes(child.hash),
        size: child.size,
        type: child.type,
        metadata: {
          count: child.count,
          first: child.first!,
          last: child.last!,
        },
      });
    }
    if (fanout.length > this.limits.maxLinks) {
      const regrouped: ManifestLink[] = [];
      for (let i = 0; i < fanout.length; i += this.limits.maxLinks) {
        const group = fanout.slice(i, i + this.limits.maxLinks);
        const bytes = encodeManifest({ type: "fanout", links: group });
        const blob = await persist(bytes);
        regrouped.push({
          hash: hexBytes(blob.hash),
          size: blob.size,
          type: 3,
          metadata: {
            count: group.reduce((n, x) => n + Number(x.metadata!.count), 0),
            first: group[0].metadata!.first,
            last: group.at(-1)!.metadata!.last,
          },
        });
      }
      return this.buildFanout(regrouped, persist);
    }
    return this.buildFanout(fanout, persist);
  }
  private async buildFanout(
    links: ManifestLink[],
    persist: (bytes: Uint8Array) => Promise<CandidateBlob>,
  ): Promise<Built> {
    const bytes = encodeManifest({ type: "fanout", links });
    const blob = await persist(bytes);
    return {
      ...blob,
      bytes,
      type: 3,
      count: links.reduce((n, x) => n + Number(x.metadata!.count), 0),
      first: links[0]?.metadata?.first as string,
      last: links.at(-1)?.metadata?.last as string,
    };
  }
}
