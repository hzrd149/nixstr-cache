import { sha256 } from "@noble/hashes/sha2.js";
import { DatabaseSync } from "node:sqlite";
import { encodeManifest, type ManifestLink } from "../protocol/hashtree.ts";
import { encodePlaintextNhash } from "../protocol/nhash.ts";
import type { BlobStore, RouteComponent } from "../persistence/blob_store.ts";

export const FILE_CHUNK_BYTES = 2_097_152;

export interface LogicalFile {
  readonly route: string;
  readonly path?: string;
  readonly size: number;
  readonly components?: readonly RouteComponent[];
}
export interface CandidateBlob {
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}
export interface HashtreeBuild {
  readonly runId: string;
  readonly rootHex: string;
  readonly rootNhash: string;
  readonly rootPath: string;
  readonly inventory: CandidateInventory;
  readonly totalBytes: number;
  readonly createdBlobs: number;
  readonly maxBufferedLinks: number;
  dispose(): Promise<void>;
}
export interface CandidateOwnershipRepository {
  startWriterRun(runId: string, indexPath: string): void;
  recordWriterBlob(runId: string, blob: CandidateBlob): void;
  releaseWriterRun(runId: string): Promise<void>;
}
export interface CandidateInventory extends Iterable<CandidateBlob> {
  readonly length: number;
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

export function releaseContentOwner(owner: string, samplePath: string): void {
  const root = samplePath.slice(0, samplePath.lastIndexOf("/"));
  const ledger = `${root}/.blob-owners.sqlite`;
  try {
    const db = new DatabaseSync(ledger);
    db.prepare("DELETE FROM blob_owners WHERE owner=?").run(owner);
    const rows = db.prepare(
      "SELECT hash,path FROM content_blobs b WHERE NOT EXISTS(SELECT 1 FROM blob_owners o WHERE o.hash=b.hash)",
    ).all() as unknown as { hash: string; path: string }[];
    for (const row of rows) {
      try {
        Deno.removeSync(row.path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) continue;
      }
      db.prepare("DELETE FROM content_blobs WHERE hash=?").run(row.hash);
    }
    db.close();
  } catch (error) {
    if (
      !(error instanceof Deno.errors.NotFound) &&
      !(error instanceof Error && error.message.includes("no such table"))
    ) throw error;
  }
}
type Built = CandidateBlob & {
  bytes: Uint8Array;
  logicalSize: number;
  type: 0 | 1 | 2 | 3;
  count: number;
  first?: string;
  last?: string;
};

const encoder = new TextEncoder();
const writerSession = crypto.randomUUID();
const compareUtf8 = (a: string, b: string) => {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
};
const hexBytes = (hex: string) => Uint8Array.fromHex(hex);

export class HashtreeWriter {
  #owners?: DatabaseSync;
  #state: "open" | "closing" | "closed" = "open";
  #active = new Set<Promise<unknown>>();
  #handles = new Set<HashtreeBuild>();
  #closePromise?: Promise<void>;
  constructor(
    readonly root: string,
    readonly limits: WriterLimits,
    readonly ownershipRepository?: CandidateOwnershipRepository,
    readonly blobStore?: BlobStore,
  ) {
    if (limits.maxLinks < 2) {
      throw new RangeError("maxLinks must be at least two");
    }
    Deno.mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  #ownership(): DatabaseSync {
    if (this.#owners) return this.#owners;
    const owners = this.#owners = new DatabaseSync(
      `${this.root}/.blob-owners.sqlite`,
    );
    owners.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS content_blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,path TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blob_owners(owner TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,hash),FOREIGN KEY(hash) REFERENCES content_blobs(hash));
      CREATE TABLE IF NOT EXISTS writer_runs(owner TEXT PRIMARY KEY,index_path TEXT NOT NULL,session TEXT NOT NULL);`);
    const abandoned = owners.prepare(
      "SELECT owner,index_path FROM writer_runs WHERE session<>?",
    ).all(writerSession) as unknown as { owner: string; index_path: string }[];
    for (const run of abandoned) {
      owners.prepare("DELETE FROM blob_owners WHERE owner=?").run(
        run.owner,
      );
      owners.prepare("DELETE FROM writer_runs WHERE owner=?").run(
        run.owner,
      );
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          Deno.removeSync(run.index_path + suffix);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    }
    return owners;
  }
  build(
    files: LogicalFileSource,
    _base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild> {
    if (this.#state !== "open") {
      return Promise.reject(new Error("hashtree writer is closed"));
    }
    const operation = this.#build(files, _base, signal);
    this.#active.add(operation);
    operation.then(
      () => this.#active.delete(operation),
      () => this.#active.delete(operation),
    );
    return operation;
  }

  async #build(
    files: LogicalFileSource,
    _base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild> {
    const ownershipRepository = this.ownershipRepository;
    const owners = ownershipRepository ? undefined : this.#ownership();
    const sweepUnowned = () => this.#sweepUnowned();
    const runOwner = `run:${crypto.randomUUID()}`;
    const indexPath = `${this.root}/inventory-${crypto.randomUUID()}.sqlite`;
    const index = new DatabaseSync(indexPath);
    if (ownershipRepository) {
      ownershipRepository.startWriterRun(runOwner, indexPath);
    } else {
      owners!.prepare(
        "INSERT INTO writer_runs(owner,index_path,session) VALUES(?,?,?)",
      ).run(runOwner, indexPath, writerSession);
    }
    index.exec(`
      CREATE TABLE inventory(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,path TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE nodes(path TEXT PRIMARY KEY,parent TEXT NOT NULL,name TEXT NOT NULL,depth INTEGER NOT NULL,is_file INTEGER NOT NULL DEFAULT 0,component_source INTEGER NOT NULL DEFAULT 0,hash TEXT,size INTEGER,type INTEGER,source_path TEXT,source_size INTEGER);
      CREATE TABLE file_components(path TEXT NOT NULL,component_index INTEGER NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(path,component_index));
      CREATE TABLE work(scope TEXT NOT NULL,level INTEGER NOT NULL,seq INTEGER PRIMARY KEY AUTOINCREMENT,link TEXT NOT NULL);
      CREATE INDEX work_level ON work(scope,level,seq);
    `);
    let created = 0, total = 0, maxBufferedLinks = 0;
    const inventoryBlob = (hash: string) =>
      index.prepare(
        "SELECT hash,size,path FROM inventory WHERE hash=?",
      ).get(hash) as unknown as CandidateBlob | undefined;
    const checkedExisting = (
      existing: CandidateBlob,
      expected: CandidateBlob,
    ): CandidateBlob => {
      if (
        existing.size !== expected.size || existing.path !== expected.path
      ) throw new Error("candidate blob identity changed");
      return Object.freeze(existing);
    };
    const ensureInventoryRoom = (size: number) => {
      if (
        Number(
                (index.prepare("SELECT COUNT(*) n FROM inventory").get() as {
                  n: number;
                }).n,
              ) + 1 > this.limits.maxInventoryBlobs ||
        total + size > this.limits.maxInventoryBytes
      ) {
        throw new RangeError("candidate inventory ceiling exceeded");
      }
    };
    const recordCandidate = (
      blob: CandidateBlob,
      createdNow: number,
    ): CandidateBlob => {
      total += blob.size;
      index.prepare(
        "INSERT INTO inventory(hash,size,path,created) VALUES(?,?,?,?)",
      ).run(blob.hash, blob.size, blob.path, createdNow);
      if (ownershipRepository) {
        ownershipRepository.recordWriterBlob(runOwner, blob);
      } else {
        owners!.exec("BEGIN IMMEDIATE");
        try {
          owners!.prepare(
            "INSERT OR IGNORE INTO content_blobs(hash,size,path) VALUES(?,?,?)",
          ).run(blob.hash, blob.size, blob.path);
          owners!.prepare(
            "INSERT OR IGNORE INTO blob_owners(owner,hash) VALUES(?,?)",
          ).run(runOwner, blob.hash);
          owners!.exec("COMMIT");
        } catch (error) {
          owners!.exec("ROLLBACK");
          throw error;
        }
      }
      return Object.freeze(blob);
    };
    const registerCandidate = (blob: CandidateBlob): CandidateBlob => {
      const existing = inventoryBlob(blob.hash);
      if (existing) return checkedExisting(existing, blob);
      ensureInventoryRoom(blob.size);
      return recordCandidate(blob, 0);
    };
    const persist = async (bytes: Uint8Array): Promise<CandidateBlob> => {
      signal?.throwIfAborted();
      const hash = sha256(bytes).toHex();
      const path = this.blobStore?.pathFor(hash) ?? `${this.root}/${hash}`;
      const blob = { hash, size: bytes.length, path };
      const existing = inventoryBlob(hash);
      if (existing) return checkedExisting(existing, blob);
      ensureInventoryRoom(bytes.length);
      let createdNow = 0;
      if (this.blobStore) {
        const existed = this.blobStore.has(hash);
        await this.blobStore.admit(bytes, {
          origin: "write",
          owner: runOwner,
          reserveBytes: bytes.length,
          expectedHash: hash,
        });
        if (!existed) created++;
        createdNow = existed ? 0 : 1;
      } else {
        try {
          await Deno.writeFile(path, bytes, { createNew: true, mode: 0o600 });
          created++;
          createdNow = 1;
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
      }
      return recordCandidate(blob, createdNow);
    };
    try {
      let previousRoute: string | undefined;
      let entries = 0;
      for await (const file of files) {
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
          encoder.encode(file.route).length >
            (this.limits.maxRouteBytes ?? 4096)
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
        const parent = parts.slice(0, -1).join("/");
        index.prepare(
          "INSERT INTO nodes(path,parent,name,depth,is_file,component_source,source_path,source_size) VALUES(?,?,?,?,1,?,?,?)",
        )
          .run(
            file.route,
            parent,
            parts.at(-1)!,
            parts.length,
            file.components === undefined ? 0 : 1,
            file.path ?? null,
            file.size,
          );
        if (file.components !== undefined) {
          const insert = index.prepare(
            "INSERT INTO file_components(path,component_index,hash,size) VALUES(?,?,?,?)",
          );
          for (const component of file.components) {
            insert.run(
              file.route,
              component.index,
              component.hash,
              component.size,
            );
          }
        }
        for (let depth = 0; depth < parts.length; depth++) {
          const path = parts.slice(0, depth).join("/");
          const directoryParent = parts.slice(0, Math.max(0, depth - 1)).join(
            "/",
          );
          const name = depth === 0 ? "" : parts[depth - 1];
          index.prepare(
            "INSERT OR IGNORE INTO nodes(path,parent,name,depth) VALUES(?,?,?,?)",
          )
            .run(path, directoryParent, name, depth);
        }
      }
      const buildFile = async (file: {
        route: string;
        path?: string;
        size: number;
        componentSource: number;
      }): Promise<Built> => {
        const scope = `file:${file.route}`;
        let sequence = 0;
        let observed = 0;
        let directBlob: CandidateBlob | undefined;
        if (file.componentSource) {
          let previousSize: number | undefined;
          for (
            const component of index.prepare(
              "SELECT component_index 'index',hash,size FROM file_components WHERE path=? ORDER BY component_index",
            ).iterate(file.route) as unknown as Iterable<RouteComponent>
          ) {
            signal?.throwIfAborted();
            if (component.index !== sequence) {
              throw new Error("route component order changed");
            }
            if (
              component.size <= 0 || component.size > FILE_CHUNK_BYTES ||
              (previousSize !== undefined &&
                previousSize !== FILE_CHUNK_BYTES)
            ) throw new Error("route component chunking changed");
            const lease = this.blobStore?.lookup(component.hash);
            if (!lease || lease.size !== component.size) {
              lease?.release();
              throw new Error("route component unavailable");
            }
            let blob: CandidateBlob;
            try {
              blob = registerCandidate({
                hash: component.hash,
                size: component.size,
                path: lease.path,
              });
            } finally {
              lease.release();
            }
            observed += component.size;
            index.prepare("INSERT INTO work(scope,level,link) VALUES(?,0,?)")
              .run(
                scope,
                JSON.stringify({
                  hash: component.hash,
                  size: component.size,
                  type: 0,
                }),
              );
            directBlob = sequence === 0 ? blob : undefined;
            previousSize = component.size;
            sequence++;
          }
        } else {
          if (!file.path) throw new Error("logical file source unavailable");
          const handle = await Deno.open(file.path, { read: true });
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
              index.prepare("INSERT INTO work(scope,level,link) VALUES(?,0,?)")
                .run(
                  scope,
                  JSON.stringify({ hash: blob.hash, size: used, type: 0 }),
                );
              directBlob = sequence === 0 ? blob : undefined;
              sequence++;
            }
          } finally {
            handle.close();
          }
        }
        if (observed !== file.size) throw new Error("frozen file size changed");
        if (sequence === 0) directBlob = await persist(new Uint8Array());
        if (sequence <= 1) {
          index.prepare("DELETE FROM work WHERE scope=?").run(scope);
          let builtBytes: Uint8Array;
          if (this.blobStore) {
            const lease = this.blobStore.lookup(directBlob!.hash);
            if (!lease) throw new Error("built raw blob unavailable");
            try {
              builtBytes = await new Response(lease.open()).bytes();
            } finally {
              lease.release();
            }
          } else builtBytes = await Deno.readFile(directBlob!.path);
          return {
            ...directBlob!,
            bytes: builtBytes,
            logicalSize: observed,
            type: 0,
            count: 1,
          };
        }
        const built = await collapse(scope, "file", sequence);
        let builtBytes: Uint8Array;
        if (this.blobStore) {
          const lease = this.blobStore.lookup(built.hash);
          if (!lease) throw new Error("built manifest unavailable");
          try {
            builtBytes = await new Response(lease.open()).bytes();
          } finally {
            lease.release();
          }
        } else builtBytes = await Deno.readFile(built.path);
        return {
          ...built,
          bytes: builtBytes,
          type: built.type,
          count: 1,
        };
      };
      const parseLink = (raw: string): ManifestLink => {
        const value = JSON.parse(raw) as {
          hash: string;
          size: number;
          type: 0 | 1 | 2 | 3;
          name?: string;
          metadata?: Record<string, unknown>;
        };
        return { ...value, hash: hexBytes(value.hash) };
      };
      const storedLink = (link: ManifestLink) =>
        JSON.stringify({
          hash: link.hash.toHex(),
          size: link.size,
          type: link.type,
          ...(link.name === undefined ? {} : { name: link.name }),
          ...(link.metadata === undefined ? {} : { metadata: link.metadata }),
        });
      const logicalSize = (links: readonly ManifestLink[]) => {
        let total = 0;
        for (const link of links) {
          if (!Number.isSafeInteger(total + link.size)) {
            throw new RangeError("logical size is not a safe integer");
          }
          total += link.size;
        }
        return total;
      };
      const collapse = async (
        scope: string,
        kind: "file" | "directory",
        initialCount: number,
      ): Promise<Built> => {
        let level = 0, count = initialCount;
        for (;;) {
          signal?.throwIfAborted();
          if (count <= this.limits.maxLinks) {
            const links = [
              ...index.prepare(
                "SELECT link FROM work WHERE scope=? AND level=? ORDER BY seq",
              ).iterate(scope, level) as unknown as Iterable<{ link: string }>,
            ].map((row) => parseLink(row.link));
            maxBufferedLinks = Math.max(maxBufferedLinks, links.length);
            const manifestKind = kind === "file"
              ? "file"
              : level === 0
              ? "directory"
              : "fanout";
            const bytes = encodeManifest({ type: manifestKind, links });
            const blob = await persist(bytes);
            index.prepare("DELETE FROM work WHERE scope=?").run(scope);
            return {
              ...blob,
              bytes,
              logicalSize: logicalSize(links),
              type: manifestKind === "file"
                ? 1
                : manifestKind === "directory"
                ? 2
                : 3,
              count: kind === "file" ? 1 : links.reduce(
                (n, link) => n + Number(link.metadata?.count ?? 1),
                0,
              ),
              first: kind === "directory"
                ? String(links[0]?.metadata?.first ?? links[0]?.name ?? "")
                : undefined,
              last: kind === "directory"
                ? String(
                  links.at(-1)?.metadata?.last ?? links.at(-1)?.name ?? "",
                )
                : undefined,
            };
          }
          let nextCount = 0;
          let group: ManifestLink[] = [];
          const flushGroup = async (links: ManifestLink[]) => {
            const manifestKind = kind === "file"
              ? "file"
              : level === 0
              ? "directory"
              : "fanout";
            const bytes = encodeManifest({ type: manifestKind, links });
            const blob = await persist(bytes);
            const representedBytes = logicalSize(links);
            const link: ManifestLink = kind === "file"
              ? { hash: hexBytes(blob.hash), size: representedBytes, type: 1 }
              : {
                hash: hexBytes(blob.hash),
                size: representedBytes,
                type: manifestKind === "directory" ? 2 : 3,
                metadata: {
                  count: links.reduce(
                    (n, item) => n + Number(item.metadata?.count ?? 1),
                    0,
                  ),
                  first: links[0].metadata?.first ?? links[0].name,
                  last: links.at(-1)!.metadata?.last ?? links.at(-1)!.name,
                },
              };
            index.prepare("INSERT INTO work(scope,level,link) VALUES(?,?,?)")
              .run(
                scope,
                level + 1,
                storedLink(link),
              );
            nextCount++;
          };
          for (
            const row of index.prepare(
              "SELECT link FROM work WHERE scope=? AND level=? ORDER BY seq",
            ).iterate(scope, level) as unknown as Iterable<{ link: string }>
          ) {
            signal?.throwIfAborted();
            group.push(parseLink(row.link));
            maxBufferedLinks = Math.max(maxBufferedLinks, group.length);
            if (group.length < this.limits.maxLinks) continue;
            await flushGroup(group);
            group = [];
          }
          if (group.length) await flushGroup(group);
          index.prepare("DELETE FROM work WHERE scope=? AND level=?").run(
            scope,
            level,
          );
          level++;
          count = nextCount;
        }
      };
      for (
        const file of index.prepare(
          "SELECT path route,source_path path,source_size size,component_source componentSource FROM nodes WHERE is_file=1 ORDER BY CAST(path AS BLOB)",
        ).iterate() as unknown as Iterable<{
          route: string;
          path?: string;
          size: number;
          componentSource: number;
        }>
      ) {
        const built = await buildFile(file);
        index.prepare("UPDATE nodes SET hash=?,size=?,type=? WHERE path=?").run(
          built.hash,
          built.logicalSize,
          built.type,
          file.route,
        );
      }
      for (
        const directory of index.prepare(
          "SELECT path,depth FROM nodes WHERE is_file=0 AND hash IS NULL ORDER BY depth DESC,path",
        ).iterate() as unknown as Iterable<{ path: string; depth: number }>
      ) {
        const scope = `dir:${directory.path}`;
        let count = 0;
        for (
          const child of index.prepare(
            "SELECT name,hash,size,type FROM nodes WHERE parent=? AND path<>? ORDER BY CAST(name AS BLOB)",
          ).iterate(directory.path, directory.path) as unknown as Iterable<
            { name: string; hash: string; size: number; type: 0 | 1 | 2 | 3 }
          >
        ) {
          index.prepare("INSERT INTO work(scope,level,link) VALUES(?,0,?)").run(
            scope,
            storedLink({
              hash: hexBytes(child.hash),
              name: child.name,
              size: child.size,
              type: child.type,
            }),
          );
          count++;
        }
        const built = await collapse(scope, "directory", count);
        index.prepare("UPDATE nodes SET hash=?,size=?,type=? WHERE path=?").run(
          built.hash,
          built.logicalSize,
          built.type,
          directory.path,
        );
      }
      const rootRow = index.prepare(
        "SELECT hash,size,type FROM nodes WHERE path='' ",
      ).get() as unknown as { hash: string; size: number; type: 2 | 3 };
      const rootPath = this.blobStore?.pathFor(rootRow.hash) ??
        `${this.root}/${rootRow.hash}`;
      const rootBytes = await Deno.readFile(rootPath);
      const root: Built = {
        hash: rootRow.hash,
        size: rootBytes.length,
        logicalSize: rootRow.size,
        type: rootRow.type,
        path: rootPath,
        bytes: rootBytes,
        count: entries,
      };
      const inventoryCount = Number(
        (index.prepare("SELECT COUNT(*) n FROM inventory").get() as {
          n: number;
        })
          .n,
      );
      index.close();
      const inventory: CandidateInventory = Object.freeze({
        length: inventoryCount,
        *[Symbol.iterator]() {
          const db = new DatabaseSync(indexPath, { readOnly: true });
          try {
            for (
              const row of db.prepare(
                "SELECT hash,size,path FROM inventory ORDER BY hash",
              ).iterate() as unknown as Iterable<CandidateBlob>
            ) yield Object.freeze(row);
          } finally {
            db.close();
          }
        },
      });
      let disposed = false;
      let durableOwner: string | undefined;
      const result: HashtreeBuild = Object.freeze({
        runId: runOwner,
        rootHex: root.hash,
        rootNhash: encodePlaintextNhash(hexBytes(root.hash)),
        rootPath: root.path,
        inventory,
        totalBytes: total,
        createdBlobs: created,
        maxBufferedLinks,
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          this.#handles.delete(result);
          if (ownershipRepository) {
            await ownershipRepository.releaseWriterRun(runOwner);
          } else {
            owners!.prepare("DELETE FROM blob_owners WHERE owner=?").run(
              runOwner,
            );
            owners!.prepare("DELETE FROM writer_runs WHERE owner=?").run(
              runOwner,
            );
            if (!durableOwner) await sweepUnowned();
          }
          for (const suffix of ["", "-wal", "-shm"]) {
            try {
              await Deno.remove(indexPath + suffix);
            } catch (error) {
              if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
          }
        },
      });
      this.#handles.add(result);
      return result;
    } catch (error) {
      index.close();
      if (ownershipRepository) {
        await ownershipRepository.releaseWriterRun(runOwner);
      } else {
        owners!.prepare("DELETE FROM blob_owners WHERE owner=?").run(runOwner);
        owners!.prepare("DELETE FROM writer_runs WHERE owner=?").run(runOwner);
        await this.#sweepUnowned();
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          await Deno.remove(indexPath + suffix);
        } catch (cleanup) {
          if (
            !(cleanup instanceof Deno.errors.NotFound)
          ) { /* retained for restart sweep */ }
        }
      }
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = "closing";
    return this.#closePromise = (async () => {
      await Promise.allSettled([...this.#active]);
      await Promise.allSettled(
        [...this.#handles].map((handle) => handle.dispose()),
      );
      if (this.#owners) {
        await this.#sweepUnowned();
        this.#owners.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        this.#owners.close();
        this.#owners = undefined;
      }
      this.#state = "closed";
    })();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async #sweepUnowned(): Promise<void> {
    const owners = this.#ownership();
    const rows = owners.prepare(
      "SELECT hash,path FROM content_blobs b WHERE NOT EXISTS(SELECT 1 FROM blob_owners o WHERE o.hash=b.hash)",
    ).all() as unknown as { hash: string; path: string }[];
    for (const row of rows) {
      try {
        await Deno.remove(row.path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) continue;
      }
      owners.prepare(
        "DELETE FROM content_blobs WHERE hash=? AND NOT EXISTS(SELECT 1 FROM blob_owners WHERE hash=?)",
      ).run(row.hash, row.hash);
    }
  }
}
