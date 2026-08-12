import { sha256 } from "@noble/hashes/sha2.js";
import { DatabaseSync } from "node:sqlite";
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
  readonly inventory: CandidateInventory;
  readonly totalBytes: number;
  readonly createdBlobs: number;
  readonly maxBufferedLinks: number;
  transferOwnership(owner: string): void;
  dispose(): Promise<void>;
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
  readonly #owners: DatabaseSync;
  constructor(readonly root: string, readonly limits: WriterLimits) {
    if (limits.maxLinks < 2) {
      throw new RangeError("maxLinks must be at least two");
    }
    Deno.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.#owners = new DatabaseSync(`${root}/.blob-owners.sqlite`);
    this.#owners.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS content_blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,path TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blob_owners(owner TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,hash),FOREIGN KEY(hash) REFERENCES content_blobs(hash));
      CREATE TABLE IF NOT EXISTS writer_runs(owner TEXT PRIMARY KEY,index_path TEXT NOT NULL,session TEXT NOT NULL);`);
    const abandoned = this.#owners.prepare(
      "SELECT owner,index_path FROM writer_runs WHERE session<>?",
    ).all(writerSession) as unknown as { owner: string; index_path: string }[];
    for (const run of abandoned) {
      this.#owners.prepare("DELETE FROM blob_owners WHERE owner=?").run(
        run.owner,
      );
      this.#owners.prepare("DELETE FROM writer_runs WHERE owner=?").run(
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
    void this.#sweepUnowned();
  }
  async build(
    files: LogicalFileSource,
    _base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild> {
    const owners = this.#owners;
    const sweepUnowned = () => this.#sweepUnowned();
    const runOwner = `run:${crypto.randomUUID()}`;
    const indexPath = `${this.root}/inventory-${crypto.randomUUID()}.sqlite`;
    const index = new DatabaseSync(indexPath);
    owners.prepare(
      "INSERT INTO writer_runs(owner,index_path,session) VALUES(?,?,?)",
    ).run(runOwner, indexPath, writerSession);
    index.exec(`
      CREATE TABLE inventory(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,path TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE nodes(path TEXT PRIMARY KEY,parent TEXT NOT NULL,name TEXT NOT NULL,depth INTEGER NOT NULL,hash TEXT,size INTEGER,type INTEGER,source_path TEXT,source_size INTEGER);
      CREATE TABLE work(scope TEXT NOT NULL,level INTEGER NOT NULL,seq INTEGER PRIMARY KEY AUTOINCREMENT,link TEXT NOT NULL);
      CREATE INDEX work_level ON work(scope,level,seq);
    `);
    let created = 0, total = 0, maxBufferedLinks = 0;
    const persist = async (bytes: Uint8Array): Promise<CandidateBlob> => {
      signal?.throwIfAborted();
      const hash = sha256(bytes).toHex();
      const path = `${this.root}/${hash}`;
      const existing = index.prepare(
        "SELECT hash,size,path FROM inventory WHERE hash=?",
      ).get(hash) as unknown as CandidateBlob | undefined;
      if (!existing) {
        total += bytes.length;
        if (
          Number(
                  (index.prepare("SELECT COUNT(*) n FROM inventory").get() as {
                    n: number;
                  }).n,
                ) + 1 > this.limits.maxInventoryBlobs ||
          total > this.limits.maxInventoryBytes
        ) {
          throw new RangeError("candidate inventory ceiling exceeded");
        }
        let createdNow = 0;
        try {
          await Deno.writeFile(path, bytes, { createNew: true, mode: 0o600 });
          created++;
          createdNow = 1;
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
        index.prepare(
          "INSERT INTO inventory(hash,size,path,created) VALUES(?,?,?,?)",
        )
          .run(hash, bytes.length, path, createdNow);
        owners.exec("BEGIN IMMEDIATE");
        try {
          owners.prepare(
            "INSERT OR IGNORE INTO content_blobs(hash,size,path) VALUES(?,?,?)",
          ).run(hash, bytes.length, path);
          owners.prepare(
            "INSERT OR IGNORE INTO blob_owners(owner,hash) VALUES(?,?)",
          ).run(runOwner, hash);
          owners.exec("COMMIT");
        } catch (error) {
          owners.exec("ROLLBACK");
          throw error;
        }
      }
      return Object.freeze({ hash, size: bytes.length, path });
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
          "INSERT INTO nodes(path,parent,name,depth,source_path,source_size) VALUES(?,?,?,?,?,?)",
        )
          .run(
            file.route,
            parent,
            parts.at(-1)!,
            parts.length,
            file.path,
            file.size,
          );
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
      const buildFile = async (file: LogicalFile): Promise<Built> => {
        const handle = await Deno.open(file.path, { read: true });
        const scope = `file:${file.route}`;
        let sequence = 0;
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
            index.prepare("INSERT INTO work(scope,level,link) VALUES(?,0,?)")
              .run(
                scope,
                JSON.stringify({ hash: blob.hash, size: used, type: 0 }),
              );
            sequence++;
          }
        } finally {
          handle.close();
        }
        if (observed !== file.size) throw new Error("frozen file size changed");
        const built = await collapse(scope, "file", sequence);
        return {
          ...built,
          bytes: await Deno.readFile(built.path),
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
            const link: ManifestLink = kind === "file"
              ? { hash: hexBytes(blob.hash), size: blob.size, type: 1 }
              : {
                hash: hexBytes(blob.hash),
                size: blob.size,
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
          "SELECT path route,source_path path,source_size size FROM nodes WHERE source_path IS NOT NULL ORDER BY CAST(path AS BLOB)",
        ).iterate() as unknown as Iterable<LogicalFile>
      ) {
        const built = await buildFile(file);
        index.prepare("UPDATE nodes SET hash=?,size=?,type=? WHERE path=?").run(
          built.hash,
          built.size,
          built.type,
          file.route,
        );
      }
      for (
        const directory of index.prepare(
          "SELECT path,depth FROM nodes WHERE hash IS NULL ORDER BY depth DESC,path",
        ).iterate() as unknown as Iterable<{ path: string; depth: number }>
      ) {
        const scope = `dir:${directory.path}`;
        let count = 0;
        for (
          const child of index.prepare(
            "SELECT name,hash,size,type FROM nodes WHERE parent=? AND path<>? ORDER BY CAST(name AS BLOB)",
          ).iterate(directory.path, directory.path) as unknown as Iterable<
            { name: string; hash: string; size: number; type: 1 | 2 | 3 }
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
          built.size,
          built.type,
          directory.path,
        );
      }
      const rootRow = index.prepare(
        "SELECT hash,size,type FROM nodes WHERE path='' ",
      ).get() as unknown as { hash: string; size: number; type: 2 | 3 };
      const root: Built = {
        ...rootRow,
        path: `${this.root}/${rootRow.hash}`,
        bytes: await Deno.readFile(`${this.root}/${rootRow.hash}`),
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
      return Object.freeze({
        rootHex: root.hash,
        rootNhash: encodePlaintextNhash(hexBytes(root.hash)),
        rootPath: root.path,
        inventory,
        totalBytes: total,
        createdBlobs: created,
        maxBufferedLinks,
        transferOwnership(owner: string) {
          if (disposed) throw new Error("build handle is disposed");
          if (!owner || owner.startsWith("run:")) {
            throw new Error("invalid durable owner");
          }
          owners.exec("BEGIN IMMEDIATE");
          try {
            owners.prepare(
              "INSERT OR IGNORE INTO blob_owners(owner,hash) SELECT ?,hash FROM blob_owners WHERE owner=?",
            ).run(owner, runOwner);
            owners.exec("COMMIT");
            durableOwner = owner;
          } catch (error) {
            owners.exec("ROLLBACK");
            throw error;
          }
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          owners.prepare("DELETE FROM blob_owners WHERE owner=?").run(runOwner);
          owners.prepare("DELETE FROM writer_runs WHERE owner=?").run(runOwner);
          if (!durableOwner) await sweepUnowned();
          for (const suffix of ["", "-wal", "-shm"]) {
            try {
              await Deno.remove(indexPath + suffix);
            } catch (error) {
              if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
          }
        },
      });
    } catch (error) {
      index.close();
      this.#owners.prepare("DELETE FROM blob_owners WHERE owner=?").run(
        runOwner,
      );
      this.#owners.prepare("DELETE FROM writer_runs WHERE owner=?").run(
        runOwner,
      );
      await this.#sweepUnowned();
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

  async #sweepUnowned(): Promise<void> {
    const rows = this.#owners.prepare(
      "SELECT hash,path FROM content_blobs b WHERE NOT EXISTS(SELECT 1 FROM blob_owners o WHERE o.hash=b.hash)",
    ).all() as unknown as { hash: string; path: string }[];
    for (const row of rows) {
      try {
        await Deno.remove(row.path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) continue;
      }
      this.#owners.prepare(
        "DELETE FROM content_blobs WHERE hash=? AND NOT EXISTS(SELECT 1 FROM blob_owners WHERE hash=?)",
      ).run(row.hash, row.hash);
    }
  }
}
