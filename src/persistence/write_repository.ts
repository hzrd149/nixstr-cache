import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2.js";

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
      `CREATE TABLE IF NOT EXISTS staged_blobs(route TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL); CREATE TABLE IF NOT EXISTS write_reservations(token TEXT PRIMARY KEY, bytes INTEGER NOT NULL);`,
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
