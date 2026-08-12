import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2.js";
import type { NarInfo } from "../protocol/narinfo.ts";

export class WriteConflict extends Error {
  constructor() {
    super("immutable route conflict");
    this.name = "WriteConflict";
  }
}
export interface StagedBlob {
  readonly route: string;
  readonly digest: string;
  readonly size: number;
  readonly path: string;
  readonly idempotent: boolean;
}
export interface WriteLimits {
  readonly perBodyBytes: number;
  readonly aggregateBytes: number;
}
export interface StagedNarInfo {
  readonly storePathHash: string;
  readonly route: string;
  readonly narRoute: string;
  readonly references: readonly string[];
  readonly metadataBytes: number;
}
export interface OverlayEntry extends StagedBlob {
  readonly generation: number;
}

export class WriteRepository {
  readonly #db: DatabaseSync;
  readonly #root: string;
  readonly #limits: WriteLimits;
  #healthy = true;

  constructor(databasePath: string, root: string, limits: WriteLimits) {
    this.#root = root;
    this.#limits = limits;
    Deno.mkdirSync(root, { recursive: true, mode: 0o700 });
    Deno.chmodSync(root, 0o700);
    Deno.mkdirSync(`${root}/tmp`, { recursive: true, mode: 0o700 });
    Deno.mkdirSync(`${root}/blobs`, { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(databasePath);
    Deno.chmodSync(databasePath, 0o600);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS staged_blobs(route TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS write_reservations(token TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS staged_narinfos(store_path_hash TEXT PRIMARY KEY, route TEXT NOT NULL UNIQUE, nar_route TEXT NOT NULL, metadata_bytes INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS staged_references(store_path_hash TEXT NOT NULL, reference_hash TEXT NOT NULL, PRIMARY KEY(store_path_hash,reference_hash));
       CREATE INDEX IF NOT EXISTS staged_references_reverse ON staged_references(reference_hash,store_path_hash);
       CREATE TABLE IF NOT EXISTS overlay_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), current_generation INTEGER NOT NULL);
       INSERT OR IGNORE INTO overlay_state(singleton,current_generation) VALUES(1,0);
       CREATE TABLE IF NOT EXISTS overlay_entries(generation INTEGER NOT NULL, route TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(generation,route));
       CREATE TABLE IF NOT EXISTS overlay_store_paths(generation INTEGER NOT NULL, store_path_hash TEXT NOT NULL, PRIMARY KEY(generation,store_path_hash));`,
    );
    this.#db.exec("DELETE FROM write_reservations");
    for (const entry of Deno.readDirSync(`${root}/tmp`)) {
      if (entry.isFile) Deno.removeSync(`${root}/tmp/${entry.name}`);
    }
  }

  health(): boolean {
    return this.#healthy;
  }
  lookup(route: string): StagedBlob | undefined {
    const row = this.#db.prepare(
      "SELECT route,digest,size,path FROM staged_blobs WHERE route=?",
    ).get(route) as unknown as Omit<StagedBlob, "idempotent"> | undefined;
    return row && Object.freeze({ ...row, idempotent: true });
  }

  recordNarInfo(route: string, narinfo: NarInfo): void {
    const storePathHash = narinfo.storePath.slice(11, 43);
    const references = [
      ...new Set(narinfo.references.map((value) => value.slice(0, 32))),
    ].sort();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(
        "INSERT OR REPLACE INTO staged_narinfos(store_path_hash,route,nar_route,metadata_bytes) VALUES(?,?,?,?)",
      )
        .run(
          storePathHash,
          route,
          narinfo.url,
          new TextEncoder().encode(narinfo.rawText).length,
        );
      this.#db.prepare("DELETE FROM staged_references WHERE store_path_hash=?")
        .run(storePathHash);
      const insert = this.#db.prepare(
        "INSERT INTO staged_references(store_path_hash,reference_hash) VALUES(?,?)",
      );
      for (const reference of references) insert.run(storePathHash, reference);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  affectedCandidates(
    changed: string,
    maxVisited: number,
  ): readonly StagedNarInfo[] {
    const seed = changed.startsWith("nar/")
      ? (this.#db.prepare(
        "SELECT store_path_hash FROM staged_narinfos WHERE nar_route=?",
      ).get(changed) as { store_path_hash?: string } | undefined)
        ?.store_path_hash
      : changed.slice(0, 32);
    if (!seed) return Object.freeze([]);
    const rows = this.#db.prepare(
      `WITH RECURSIVE affected(hash) AS (
         VALUES(?) UNION SELECT r.store_path_hash FROM staged_references r JOIN affected a ON r.reference_hash=a.hash
       ) SELECT n.store_path_hash,n.route,n.nar_route,n.metadata_bytes FROM staged_narinfos n JOIN affected a ON a.hash=n.store_path_hash ORDER BY n.store_path_hash LIMIT ?`,
    ).all(seed, maxVisited + 1) as unknown as Array<
      {
        store_path_hash: string;
        route: string;
        nar_route: string;
        metadata_bytes: number;
      }
    >;
    if (rows.length > maxVisited) {
      throw new RangeError("eligibility visited-node ceiling exceeded");
    }
    const refQuery = this.#db.prepare(
      "SELECT reference_hash FROM staged_references WHERE store_path_hash=? ORDER BY reference_hash",
    );
    return Object.freeze(rows.map((row) =>
      Object.freeze({
        storePathHash: row.store_path_hash,
        route: row.route,
        narRoute: row.nar_route,
        metadataBytes: row.metadata_bytes,
        references: Object.freeze(
          (refQuery.all(row.store_path_hash) as unknown as {
            reference_hash: string;
          }[]).map((item) => item.reference_hash),
        ),
      })
    ));
  }

  currentOverlayEntries(): readonly OverlayEntry[] {
    const generation = this.currentGeneration();
    const rows = this.#db.prepare(
      "SELECT generation,route,digest,size,path FROM overlay_entries WHERE generation=? ORDER BY route",
    ).all(generation) as unknown as OverlayEntry[];
    return Object.freeze(
      rows.map((row) => Object.freeze({ ...row, idempotent: true })),
    );
  }
  currentOverlayStorePaths(): ReadonlySet<string> {
    const generation = this.currentGeneration();
    return new Set(
      (this.#db.prepare(
        "SELECT store_path_hash FROM overlay_store_paths WHERE generation=?",
      ).all(generation) as unknown as { store_path_hash: string }[]).map((
        row,
      ) => row.store_path_hash),
    );
  }
  currentGeneration(): number {
    return (this.#db.prepare(
      "SELECT current_generation generation FROM overlay_state WHERE singleton=1",
    ).get() as unknown as { generation: number }).generation;
  }
  commitOverlay(storePathHashes: readonly string[]): number {
    if (!storePathHashes.length) return this.currentGeneration();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.currentGeneration();
      const generation = previous + 1;
      this.#db.prepare(
        "INSERT INTO overlay_entries SELECT ?,route,digest,size,path FROM overlay_entries WHERE generation=?",
      ).run(generation, previous);
      this.#db.prepare(
        "INSERT INTO overlay_store_paths SELECT ?,store_path_hash FROM overlay_store_paths WHERE generation=?",
      ).run(generation, previous);
      const info = this.#db.prepare(
        "SELECT route,nar_route FROM staged_narinfos WHERE store_path_hash=?",
      );
      const blob = this.#db.prepare(
        "SELECT route,digest,size,path FROM staged_blobs WHERE route=?",
      );
      const insertEntry = this.#db.prepare(
        "INSERT OR REPLACE INTO overlay_entries(generation,route,digest,size,path) VALUES(?,?,?,?,?)",
      );
      const insertStore = this.#db.prepare(
        "INSERT OR IGNORE INTO overlay_store_paths(generation,store_path_hash) VALUES(?,?)",
      );
      for (const hash of [...new Set(storePathHashes)].sort()) {
        const row = info.get(hash) as unknown as {
          route: string;
          nar_route: string;
        } | undefined;
        if (!row) throw new Error("eligible narinfo disappeared");
        for (const route of [row.route, row.nar_route]) {
          const value = blob.get(route) as unknown as
            | Omit<StagedBlob, "idempotent">
            | undefined;
          if (!value) throw new Error("eligible blob disappeared");
          insertEntry.run(
            generation,
            value.route,
            value.digest,
            value.size,
            value.path,
          );
        }
        insertStore.run(generation, hash);
      }
      this.#db.prepare(
        "UPDATE overlay_state SET current_generation=? WHERE singleton=1",
      ).run(generation);
      this.#db.exec("COMMIT");
      return generation;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  async stage(
    route: string,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    bodyCeiling = this.#limits.perBodyBytes,
  ): Promise<StagedBlob> {
    const token = crypto.randomUUID();
    const temp = `${this.#root}/tmp/${token}`;
    this.#reserve(token);
    let file: Deno.FsFile | undefined;
    try {
      file = await Deno.open(temp, {
        createNew: true,
        write: true,
        mode: 0o600,
      });
      const digest = sha256.create();
      let size = 0;
      const reader = body.getReader();
      try {
        while (true) {
          if (signal?.aborted) throw signal.reason;
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > Math.min(bodyCeiling, this.#limits.perBodyBytes)) {
            throw new RangeError("body ceiling exceeded");
          }
          digest.update(value);
          await file.write(value);
        }
      } finally {
        reader.releaseLock();
      }
      await file.sync();
      file.close();
      file = undefined;
      const hex = digest.digest().toHex();
      const destination = `${this.#root}/blobs/${hex}`;
      const existing = this.lookup(route);
      if (existing) {
        await Deno.remove(temp);
        this.#release(token);
        if (existing.digest === hex && existing.size === size) {
          return Object.freeze({ ...existing, idempotent: true });
        }
        throw new WriteConflict();
      }
      try {
        await Deno.link(temp, destination);
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      }
      await Deno.remove(temp);
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const used = (this.#db.prepare(
          "SELECT COALESCE(SUM(size),0) used FROM staged_blobs",
        ).get() as unknown as { used: number }).used;
        if (used + size > this.#limits.aggregateBytes) {
          throw new RangeError("aggregate staging ceiling exceeded");
        }
        this.#db.prepare(
          "INSERT INTO staged_blobs(route,digest,size,path) VALUES(?,?,?,?)",
        ).run(route, hex, size, destination);
        this.#db.prepare("DELETE FROM write_reservations WHERE token=?").run(
          token,
        );
        this.#db.exec("COMMIT");
      } catch (error) {
        this.#db.exec("ROLLBACK");
        throw error;
      }
      return Object.freeze({
        route,
        digest: hex,
        size,
        path: destination,
        idempotent: false,
      });
    } catch (error) {
      this.#healthy = !(error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.PermissionDenied);
      try {
        file?.close();
      } catch { /* cleanup */ }
      try {
        await Deno.remove(temp);
      } catch (cleanup) {
        if (!(cleanup instanceof Deno.errors.NotFound)) this.#healthy = false;
      }
      this.#release(token);
      throw error;
    }
  }

  discard(route: string): void {
    const existing = this.lookup(route);
    if (!existing) return;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM staged_blobs WHERE route=?").run(route);
      const referenced = this.#db.prepare(
        "SELECT 1 FROM staged_blobs WHERE digest=? LIMIT 1",
      ).get(existing.digest);
      this.#db.exec("COMMIT");
      if (!referenced) {
        try {
          Deno.removeSync(existing.path);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch { /* transaction completed */ }
      throw error;
    }
  }

  #reserve(token: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db.prepare(
        "SELECT (SELECT COALESCE(SUM(size),0) FROM staged_blobs)+(SELECT COALESCE(SUM(bytes),0) FROM write_reservations) used",
      ).get() as unknown as { used: number };
      if (row.used + this.#limits.perBodyBytes > this.#limits.aggregateBytes) {
        throw new RangeError("aggregate staging reservation unavailable");
      }
      this.#db.prepare(
        "INSERT INTO write_reservations(token,bytes) VALUES(?,?)",
      ).run(token, this.#limits.perBodyBytes);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #release(token: string): void {
    try {
      this.#db.prepare("DELETE FROM write_reservations WHERE token=?").run(
        token,
      );
    } catch {
      this.#healthy = false;
    }
  }
  close(): void {
    this.#db.close();
  }
}
