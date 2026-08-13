import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2.js";

export const DEFAULT_BLOB_STORE_BYTES = 16 * 1024 * 1024 * 1024;
export type BlobOrigin = "write" | "remote" | "mixed";

export interface BlobStoreOptions {
  readonly capacityBytes?: number;
  readonly now?: () => number;
  readonly removeFile?: (path: string) => void;
}
export interface BlobAdmissionOptions {
  readonly origin: Exclude<BlobOrigin, "mixed">;
  readonly owner?: string;
  readonly reserveBytes: number;
  readonly expectedHash?: string;
}
export interface BlobUsage {
  readonly readyBytes: number;
  readonly reservedBytes: number;
  readonly capacityBytes: number;
}
export interface BlobInventoryEntry {
  readonly hash: string;
  readonly size: number;
  readonly origin: BlobOrigin;
  readonly lastAccessed: number;
  readonly owners: number;
}

const HASH = /^[0-9a-f]{64}$/;
const CHUNK = 64 * 1024;

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function validateHash(hash: string): void {
  if (!HASH.test(hash)) throw new TypeError("invalid lowercase SHA-256 hash");
}

export class BlobReservation {
  #store?: BlobStore;
  readonly token: string;
  readonly bytes: number;
  constructor(store: BlobStore, token: string, bytes: number) {
    this.#store = store;
    this.token = token;
    this.bytes = bytes;
  }
  release(): void {
    this.#store?.releaseReservation(this.token);
    this.#store = undefined;
  }
}

export class BlobLease {
  #store?: BlobStore;
  readonly hash: string;
  readonly size: number;
  readonly path: string;
  constructor(store: BlobStore, hash: string, size: number, path: string) {
    this.#store = store;
    this.hash = hash;
    this.size = size;
    this.path = path;
  }
  open(): ReadableStream<Uint8Array> {
    if (!this.#store) throw new Error("blob lease released");
    return Deno.openSync(this.path, { read: true }).readable;
  }
  release(): void {
    this.#store?.releaseLease(this.hash);
    this.#store = undefined;
  }
}

export class BlobStore {
  readonly #db: DatabaseSync;
  readonly #ownsDatabase: boolean;
  readonly #root: string;
  readonly #capacity: number;
  readonly #now: () => number;
  readonly #remove: (path: string) => void;
  readonly #leases = new Map<string, number>();
  #closed = false;

  constructor(
    database: string | DatabaseSync,
    root: string,
    options: BlobStoreOptions = {},
  ) {
    this.#capacity = options.capacityBytes ?? DEFAULT_BLOB_STORE_BYTES;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity <= 0) {
      throw new RangeError(
        "blob store capacity must be a positive safe integer",
      );
    }
    this.#root = root.replace(/\/+$/, "");
    this.#now = options.now ?? Date.now;
    this.#remove = options.removeFile ?? Deno.removeSync;
    Deno.mkdirSync(`${this.#root}/blobs`, { recursive: true, mode: 0o700 });
    Deno.mkdirSync(`${this.#root}/tmp`, { recursive: true, mode: 0o700 });
    Deno.mkdirSync(`${this.#root}/quarantine`, {
      recursive: true,
      mode: 0o700,
    });
    this.#ownsDatabase = typeof database === "string";
    this.#db = typeof database === "string"
      ? new DatabaseSync(database)
      : database;
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS blob_store_catalog(
        hash TEXT PRIMARY KEY,size INTEGER NOT NULL,origin TEXT NOT NULL,
        last_accessed INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('ready','deleting'))
      );
      CREATE TABLE IF NOT EXISTS blob_store_owners(
        owner TEXT NOT NULL,hash TEXT NOT NULL,
        PRIMARY KEY(owner,hash),FOREIGN KEY(hash) REFERENCES blob_store_catalog(hash) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS blob_store_reservations(
        token TEXT PRIMARY KEY,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blob_store_tombstones(
        hash TEXT PRIMARY KEY,retry_at INTEGER NOT NULL,last_error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS blob_store_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO blob_store_meta(key,value) VALUES('schema_version','1');
    `);
    this.reconcile();
  }

  pathFor(hash: string): string {
    validateHash(hash);
    return `${this.#root}/blobs/${hash.slice(0, 2)}/${hash}`;
  }
  usage(): BlobUsage {
    const row = this.#db.prepare(`SELECT
      COALESCE((SELECT SUM(size) FROM blob_store_catalog WHERE state='ready'),0) ready,
      COALESCE((SELECT SUM(bytes) FROM blob_store_reservations),0) reserved`)
      .get() as {
        ready: number;
        reserved: number;
      };
    return Object.freeze({
      readyBytes: Number(row.ready),
      reservedBytes: Number(row.reserved),
      capacityBytes: this.#capacity,
    });
  }
  health(): {
    readonly ok: boolean;
    readonly usage: BlobUsage;
    readonly tombstones: number;
  } {
    const tombstones = Number(
      (this.#db.prepare(
        "SELECT COUNT(*) count FROM blob_store_tombstones",
      ).get() as { count: number }).count,
    );
    return Object.freeze({
      ok: tombstones === 0,
      usage: this.usage(),
      tombstones,
    });
  }
  has(hash: string): boolean {
    validateHash(hash);
    return Boolean(
      this.#db.prepare(
        "SELECT 1 FROM blob_store_catalog WHERE hash=? AND state='ready'",
      ).get(hash),
    );
  }
  reserve(bytes: number): BlobReservation {
    this.#assertOpen();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.#capacity) {
      throw new RangeError("invalid blob reservation");
    }
    const token = crypto.randomUUID();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#makeSpace(bytes);
      const usage = this.usage();
      if (usage.readyBytes + usage.reservedBytes + bytes > this.#capacity) {
        throw new RangeError("blob store capacity unavailable");
      }
      this.#db.prepare(
        "INSERT INTO blob_store_reservations(token,bytes,created_at) VALUES(?,?,?)",
      ).run(token, bytes, this.#now());
      this.#db.exec("COMMIT");
      return new BlobReservation(this, token, bytes);
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  releaseReservation(token: string): void {
    if (this.#closed) return;
    this.#db.prepare("DELETE FROM blob_store_reservations WHERE token=?").run(
      token,
    );
  }
  async admit(
    source: Uint8Array | ReadableStream<Uint8Array>,
    options: BlobAdmissionOptions,
  ): Promise<BlobInventoryEntry> {
    const reservation = this.reserve(options.reserveBytes);
    const temp = `${this.#root}/tmp/admit-${reservation.token}`;
    let file: Deno.FsFile | undefined;
    try {
      file = Deno.openSync(temp, { createNew: true, write: true, mode: 0o600 });
      const digest = sha256.create();
      let size = 0;
      const stream = source instanceof Uint8Array
        ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(source);
            controller.close();
          },
        })
        : source;
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > reservation.bytes) {
            throw new RangeError("blob exceeds reservation");
          }
          digest.update(value);
          let offset = 0;
          while (offset < value.length) {
            offset += file.writeSync(value.subarray(offset));
          }
        }
      } finally {
        reader.releaseLock();
      }
      file.syncSync();
      file.close();
      file = undefined;
      const hash = hex(digest.digest());
      if (options.expectedHash && options.expectedHash !== hash) {
        throw new Error("blob hash mismatch");
      }
      return this.#promote(
        temp,
        hash,
        size,
        options.origin,
        options.owner,
        reservation,
      );
    } finally {
      try {
        file?.close();
      } catch { /* already closed */ }
      try {
        Deno.removeSync(temp);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      reservation.release();
    }
  }
  async admitVerifiedFile(
    path: string,
    expectedHash: string,
    size: number,
    options: Omit<BlobAdmissionOptions, "expectedHash" | "reserveBytes">,
  ): Promise<BlobInventoryEntry> {
    validateHash(expectedHash);
    const reservation = this.reserve(size);
    try {
      const file = await Deno.open(path, { read: true });
      const digest = sha256.create();
      let actual = 0;
      try {
        for await (const chunk of file.readable) {
          actual += chunk.length;
          if (actual > size) throw new RangeError("verified file size changed");
          digest.update(chunk);
        }
      } finally {
        try {
          file.close();
        } catch { /* readable closed it */ }
      }
      if (actual !== size || hex(digest.digest()) !== expectedHash) {
        throw new Error("verified file identity changed");
      }
      const temp = `${this.#root}/tmp/import-${reservation.token}`;
      await Deno.copyFile(path, temp);
      return this.#promote(
        temp,
        expectedHash,
        size,
        options.origin,
        options.owner,
        reservation,
      );
    } finally {
      reservation.release();
    }
  }
  #promote(
    temp: string,
    hash: string,
    size: number,
    origin: BlobOrigin,
    owner: string | undefined,
    reservation: BlobReservation,
  ): BlobInventoryEntry {
    const final = this.pathFor(hash);
    Deno.mkdirSync(final.slice(0, final.lastIndexOf("/")), {
      recursive: true,
      mode: 0o700,
    });
    try {
      Deno.linkSync(temp, final);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db.prepare(
        "SELECT size,origin FROM blob_store_catalog WHERE hash=?",
      ).get(hash) as { size: number; origin: BlobOrigin } | undefined;
      if (existing && Number(existing.size) !== size) {
        throw new Error("blob catalog identity changed");
      }
      const merged: BlobOrigin = existing && existing.origin !== origin
        ? "mixed"
        : origin;
      this.#db.prepare(
        `INSERT INTO blob_store_catalog(hash,size,origin,last_accessed,state)
        VALUES(?,?,?,?,'ready') ON CONFLICT(hash) DO UPDATE SET
        origin=excluded.origin,last_accessed=excluded.last_accessed,state='ready'`,
      )
        .run(hash, size, merged, this.#now());
      if (owner) {
        this.#db.prepare(
          "INSERT OR IGNORE INTO blob_store_owners(owner,hash) VALUES(?,?)",
        ).run(owner, hash);
      }
      this.#db.prepare("DELETE FROM blob_store_reservations WHERE token=?").run(
        reservation.token,
      );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    try {
      Deno.removeSync(temp);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return this.#entry(hash)!;
  }
  lookup(hash: string): BlobLease | undefined {
    validateHash(hash);
    const row = this.#db.prepare(
      "SELECT size FROM blob_store_catalog WHERE hash=? AND state='ready'",
    ).get(hash) as { size: number } | undefined;
    if (!row) return undefined;
    const path = this.pathFor(hash);
    try {
      Deno.statSync(path);
    } catch {
      return undefined;
    }
    this.#leases.set(hash, (this.#leases.get(hash) ?? 0) + 1);
    this.#db.prepare(
      "UPDATE blob_store_catalog SET last_accessed=? WHERE hash=?",
    )
      .run(this.#now(), hash);
    return new BlobLease(this, hash, Number(row.size), path);
  }
  releaseLease(hash: string): void {
    const count = (this.#leases.get(hash) ?? 1) - 1;
    if (count > 0) this.#leases.set(hash, count);
    else this.#leases.delete(hash);
    this.#deleteIfUnownedWrite(hash);
  }
  acquireOwner(owner: string, hash: string): void {
    validateHash(hash);
    const result = this.#db.prepare(
      "INSERT OR IGNORE INTO blob_store_owners(owner,hash) SELECT ?,hash FROM blob_store_catalog WHERE hash=? AND state='ready'",
    ).run(owner, hash);
    if (!result.changes && !this.has(hash)) throw new Error("blob not found");
  }
  transferOwner(from: string, to: string, hashes?: readonly string[]): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (hashes) {
        const add = this.#db.prepare(
          "INSERT OR IGNORE INTO blob_store_owners(owner,hash) SELECT ?,hash FROM blob_store_owners WHERE owner=? AND hash=?",
        );
        const remove = this.#db.prepare(
          "DELETE FROM blob_store_owners WHERE owner=? AND hash=?",
        );
        for (const hash of hashes) {
          validateHash(hash);
          add.run(to, from, hash);
          remove.run(from, hash);
        }
      } else {
        this.#db.prepare(
          "INSERT OR IGNORE INTO blob_store_owners(owner,hash) SELECT ?,hash FROM blob_store_owners WHERE owner=?",
        ).run(to, from);
        this.#db.prepare("DELETE FROM blob_store_owners WHERE owner=?").run(
          from,
        );
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.#sweepWrites();
  }
  releaseOwner(owner: string, hash?: string): void {
    if (hash) {
      validateHash(hash);
      this.#db.prepare("DELETE FROM blob_store_owners WHERE owner=? AND hash=?")
        .run(owner, hash);
      this.#deleteIfUnownedWrite(hash);
    } else {
      const hashes =
        (this.#db.prepare("SELECT hash FROM blob_store_owners WHERE owner=?")
          .all(owner) as unknown as { hash: string }[]).map((x) => x.hash);
      this.#db.prepare("DELETE FROM blob_store_owners WHERE owner=?").run(
        owner,
      );
      for (const item of hashes) this.#deleteIfUnownedWrite(item);
    }
  }
  inventory(limit = 10_000): readonly BlobInventoryEntry[] {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("invalid inventory limit");
    }
    const rows = this.#db.prepare(
      `SELECT b.hash,b.size,b.origin,b.last_accessed lastAccessed,
      COUNT(o.owner) owners FROM blob_store_catalog b LEFT JOIN blob_store_owners o ON o.hash=b.hash
      WHERE b.state='ready' GROUP BY b.hash ORDER BY b.hash LIMIT ?`,
    ).all(limit) as unknown as BlobInventoryEntry[];
    return Object.freeze(rows.map((item) => Object.freeze(item)));
  }
  #entry(hash: string): BlobInventoryEntry | undefined {
    return this.inventory().find((item) => item.hash === hash);
  }
  #makeSpace(required: number): void {
    let usage = this.usage();
    if (usage.readyBytes + usage.reservedBytes + required <= this.#capacity) {
      return;
    }
    const candidates = this.#db.prepare(
      `SELECT b.hash,b.size FROM blob_store_catalog b
      WHERE b.state='ready' AND b.origin IN ('remote','mixed')
      AND NOT EXISTS(SELECT 1 FROM blob_store_owners o WHERE o.hash=b.hash)
      ORDER BY b.last_accessed,b.hash`,
    ).all() as unknown as { hash: string; size: number }[];
    for (const candidate of candidates) {
      if (this.#leases.has(candidate.hash)) continue;
      this.#delete(candidate.hash);
      usage = this.usage();
      if (usage.readyBytes + usage.reservedBytes + required <= this.#capacity) {
        return;
      }
    }
  }
  #deleteIfUnownedWrite(hash: string): void {
    if (this.#leases.has(hash)) return;
    const row = this.#db.prepare(
      `SELECT origin FROM blob_store_catalog b WHERE hash=?
      AND NOT EXISTS(SELECT 1 FROM blob_store_owners o WHERE o.hash=b.hash)`,
    ).get(hash) as { origin: BlobOrigin } | undefined;
    if (row?.origin === "write") this.#delete(hash);
  }
  #sweepWrites(): void {
    for (const item of this.inventory()) this.#deleteIfUnownedWrite(item.hash);
  }
  #delete(hash: string): void {
    this.#db.prepare(
      "UPDATE blob_store_catalog SET state='deleting' WHERE hash=?",
    ).run(hash);
    try {
      this.#remove(this.pathFor(hash));
      this.#db.prepare("DELETE FROM blob_store_catalog WHERE hash=?").run(hash);
      this.#db.prepare("DELETE FROM blob_store_tombstones WHERE hash=?").run(
        hash,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        this.#db.prepare("DELETE FROM blob_store_catalog WHERE hash=?").run(
          hash,
        );
      } else {this.#db.prepare(
          "INSERT OR REPLACE INTO blob_store_tombstones(hash,retry_at,last_error) VALUES(?,?,?)",
        ).run(hash, this.#now(), String(error));}
    }
  }
  reconcile(): void {
    this.#db.prepare("DELETE FROM blob_store_reservations").run();
    for (const entry of Deno.readDirSync(`${this.#root}/tmp`)) {
      if (entry.isFile) Deno.removeSync(`${this.#root}/tmp/${entry.name}`);
    }
    const rows = this.#db.prepare(
      "SELECT hash,size,state FROM blob_store_catalog",
    ).all() as unknown as { hash: string; size: number; state: string }[];
    for (const row of rows) {
      try {
        const stat = Deno.statSync(this.pathFor(row.hash));
        if (stat.size !== Number(row.size)) this.#quarantine(row.hash);
        else if (row.state === "deleting") this.#delete(row.hash);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.#db.prepare("DELETE FROM blob_store_catalog WHERE hash=?").run(
            row.hash,
          );
        } else throw error;
      }
    }
    const tombstones = this.#db.prepare(
      "SELECT hash FROM blob_store_tombstones ORDER BY hash",
    ).all() as unknown as { hash: string }[];
    for (const row of tombstones) this.#delete(row.hash);
  }
  #quarantine(hash: string): void {
    try {
      Deno.renameSync(
        this.pathFor(hash),
        `${this.#root}/quarantine/${hash}-${this.#now()}`,
      );
    } catch { /* preserve catalog cleanup */ }
    this.#db.prepare("DELETE FROM blob_store_catalog WHERE hash=?").run(hash);
  }
  #assertOpen(): void {
    if (this.#closed) throw new Error("blob store closed");
  }
  close(): void {
    if (this.#closed) return;
    if (this.#leases.size) throw new Error("blob leases remain open");
    this.#closed = true;
    if (this.#ownsDatabase) this.#db.close();
  }
}
