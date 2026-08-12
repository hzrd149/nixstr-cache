import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@noble/hashes/sha2.js";
import type { NarInfo } from "../protocol/narinfo.ts";
import { Subject } from "rxjs";
import { verifyEvent } from "nostr-tools";
import { validatePublication } from "../protocol/publication.ts";

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
export interface FrozenBatch {
  readonly id: number;
  readonly token: number;
  readonly generation: number;
  readonly baseRoot?: string;
  readonly entries: readonly OverlayEntry[];
}
export interface PendingCandidate {
  readonly batchId: number;
  readonly generation: number;
  readonly rootHex: string;
  readonly nhash: string;
  readonly blobCount: number;
  readonly totalBytes: number;
}
export interface PendingInventoryEntry {
  readonly hash: string;
  readonly size: number;
  readonly path: string;
}
export interface PublicationSaga {
  readonly batchId: number;
  readonly candidate: PendingCandidate;
  readonly destinations: readonly string[];
  readonly completeServer?: string;
  readonly template?: Record<string, unknown>;
  readonly signedEvent?: import("../protocol/publication.ts").RawPublication;
  readonly acknowledgedRelay?: string;
  readonly committed: boolean;
  readonly admitted: boolean;
}
export type EndpointWorkKind = "replica" | "relay";
export type EndpointWorkStatus =
  | "pending"
  | "claimed"
  | "retry"
  | "complete"
  | "exhausted";
export type EndpointWorkCode =
  | "ok"
  | "unavailable"
  | "timeout"
  | "rejected"
  | "attempt_limit";
export interface EndpointWork {
  readonly batchId: number;
  readonly kind: EndpointWorkKind;
  readonly target: string;
  readonly status: EndpointWorkStatus;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly code: EndpointWorkCode;
}

export class WriteRepository {
  readonly changes$ = new Subject<string>();
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
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS publication_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1), next_token INTEGER NOT NULL, active_token INTEGER, generation INTEGER, opened_at INTEGER, last_dirty_at INTEGER, base_root TEXT);
       INSERT OR IGNORE INTO publication_clock(singleton,next_token) VALUES(1,1);
       CREATE TABLE IF NOT EXISTS publication_batches(id INTEGER PRIMARY KEY AUTOINCREMENT, token INTEGER NOT NULL UNIQUE, generation INTEGER NOT NULL, base_root TEXT, status TEXT NOT NULL CHECK(status IN ('building','failed','pending')));
       CREATE TABLE IF NOT EXISTS publication_batch_entries(batch_id INTEGER NOT NULL, generation INTEGER NOT NULL, route TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(batch_id,route));
       CREATE TABLE IF NOT EXISTS pending_candidate(singleton INTEGER PRIMARY KEY CHECK(singleton=1), batch_id INTEGER NOT NULL, generation INTEGER NOT NULL, root_hex TEXT NOT NULL, nhash TEXT NOT NULL, blob_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS pending_candidate_blobs(batch_id INTEGER NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(batch_id,hash));`,
    );
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS publication_sagas(batch_id INTEGER PRIMARY KEY, candidate_json TEXT NOT NULL, destinations_json TEXT NOT NULL, complete_server TEXT, template_json TEXT, signed_event_json TEXT, acknowledged_relay TEXT, committed INTEGER NOT NULL DEFAULT 0, admitted INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE IF NOT EXISTS publication_saga_blobs(batch_id INTEGER NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(batch_id,hash));
       CREATE TABLE IF NOT EXISTS publication_blob_proofs(batch_id INTEGER NOT NULL, server TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(batch_id,server,hash));`,
    );
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS publication_saga_history(
        batch_id INTEGER PRIMARY KEY,candidate_json TEXT NOT NULL,destinations_json TEXT NOT NULL,
        complete_server TEXT,template_json TEXT,signed_event_json TEXT,acknowledged_relay TEXT,
        committed INTEGER NOT NULL,admitted INTEGER NOT NULL,archived_at INTEGER NOT NULL
      );`,
    );
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS publication_endpoint_work(
        batch_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('replica','relay')),
        target TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','claimed','retry','complete','exhausted')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        code TEXT NOT NULL CHECK(code IN ('ok','unavailable','timeout','rejected','attempt_limit')),
        PRIMARY KEY(batch_id,kind,target)
      );
      CREATE INDEX IF NOT EXISTS publication_endpoint_work_due
        ON publication_endpoint_work(status,next_attempt_at,batch_id,kind,target);
      UPDATE publication_endpoint_work SET status='retry' WHERE status='claimed';`,
    );
    this.#db.prepare(
      "UPDATE publication_batches SET status='failed' WHERE status='building'",
    ).run();
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
      this.changes$.next(storePathHash);
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

  /** Commits already-staged routes as one immutable generation (also useful to non-Narinfo producers). */
  commitOverlayRoutes(routes: readonly string[]): number {
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
      const lookup = this.#db.prepare(
        "SELECT route,digest,size,path FROM staged_blobs WHERE route=?",
      );
      const insert = this.#db.prepare(
        "INSERT OR REPLACE INTO overlay_entries(generation,route,digest,size,path) VALUES(?,?,?,?,?)",
      );
      for (const route of [...new Set(routes)].sort()) {
        const value = lookup.get(route) as unknown as
          | Omit<StagedBlob, "idempotent">
          | undefined;
        if (!value) throw new Error("staged route disappeared");
        insert.run(
          generation,
          value.route,
          value.digest,
          value.size,
          value.path,
        );
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

  markPublicationDirty(
    generation: number,
    now: number,
    baseRoot?: string,
  ): { token: number; openedAt: number; lastDirtyAt: number } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db.prepare(
        "SELECT next_token,active_token,generation,opened_at FROM publication_clock WHERE singleton=1",
      ).get() as unknown as {
        next_token: number;
        active_token: number | null;
        generation: number | null;
        opened_at: number | null;
      };
      const token = row.active_token ?? row.next_token;
      const openedAt = row.opened_at ?? now;
      this.#db.prepare(
        "UPDATE publication_clock SET next_token=?,active_token=?,generation=?,opened_at=?,last_dirty_at=?,base_root=? WHERE singleton=1",
      )
        .run(
          row.active_token === null ? token + 1 : row.next_token,
          token,
          Math.max(generation, row.generation ?? 0),
          openedAt,
          now,
          baseRoot ?? null,
        );
      this.#db.exec("COMMIT");
      return { token, openedAt, lastDirtyAt: now };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  claimPublicationBatch(token: number): FrozenBatch | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const clock = this.#db.prepare(
        "SELECT active_token,generation,base_root FROM publication_clock WHERE singleton=1",
      ).get() as unknown as {
        active_token: number | null;
        generation: number | null;
        base_root: string | null;
      };
      if (clock.active_token !== token || clock.generation === null) {
        this.#db.exec("ROLLBACK");
        return undefined;
      }
      const result = this.#db.prepare(
        "INSERT INTO publication_batches(token,generation,base_root,status) VALUES(?,?,?,'building')",
      ).run(token, clock.generation, clock.base_root);
      const id = Number(result.lastInsertRowid);
      this.#db.prepare(
        "INSERT INTO publication_batch_entries SELECT ?,generation,route,digest,size,path FROM overlay_entries WHERE generation=?",
      ).run(id, clock.generation);
      this.#db.prepare(
        "UPDATE publication_clock SET active_token=NULL,generation=NULL,opened_at=NULL,last_dirty_at=NULL,base_root=NULL WHERE singleton=1",
      ).run();
      const entries = this.#batchEntries(id);
      this.#db.exec("COMMIT");
      return Object.freeze({
        id,
        token,
        generation: clock.generation,
        ...(clock.base_root ? { baseRoot: clock.base_root } : {}),
        entries,
      });
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #batchEntries(id: number): readonly OverlayEntry[] {
    return Object.freeze(
      (this.#db.prepare(
        "SELECT generation,route,digest,size,path FROM publication_batch_entries WHERE batch_id=? ORDER BY route",
      ).all(id) as unknown as OverlayEntry[]).map((x) =>
        Object.freeze({ ...x, idempotent: true })
      ),
    );
  }
  failedBatches(): readonly FrozenBatch[] {
    const rows = this.#db.prepare(
      "SELECT id,token,generation,base_root FROM publication_batches WHERE status='failed' ORDER BY id",
    ).all() as unknown as {
      id: number;
      token: number;
      generation: number;
      base_root: string | null;
    }[];
    return Object.freeze(
      rows.map((x) =>
        Object.freeze({
          id: x.id,
          token: x.token,
          generation: x.generation,
          ...(x.base_root ? { baseRoot: x.base_root } : {}),
          entries: this.#batchEntries(x.id),
        })
      ),
    );
  }
  recordPending(
    batch: FrozenBatch,
    candidate: PendingCandidate,
    inventory: readonly PendingInventoryEntry[],
  ): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM pending_candidate_blobs").run();
      const insert = this.#db.prepare(
        "INSERT INTO pending_candidate_blobs(batch_id,hash,size,path) VALUES(?,?,?,?)",
      );
      for (const blob of inventory) {
        insert.run(batch.id, blob.hash, blob.size, blob.path);
      }
      this.#db.prepare(
        "INSERT OR REPLACE INTO pending_candidate(singleton,batch_id,generation,root_hex,nhash,blob_count,total_bytes) VALUES(1,?,?,?,?,?,?)",
      )
        .run(
          batch.id,
          batch.generation,
          candidate.rootHex,
          candidate.nhash,
          inventory.length,
          candidate.totalBytes,
        );
      this.#db.prepare(
        "UPDATE publication_batches SET status='pending' WHERE id=? AND status IN ('building','failed')",
      ).run(batch.id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  markBatchFailed(id: number): void {
    this.#db.prepare(
      "UPDATE publication_batches SET status='failed' WHERE id=?",
    ).run(id);
  }
  pendingCandidate(): PendingCandidate | undefined {
    const row = this.#db.prepare(
      "SELECT batch_id batchId,generation,root_hex rootHex,nhash,blob_count blobCount,total_bytes totalBytes FROM pending_candidate WHERE singleton=1",
    ).get() as unknown as PendingCandidate | undefined;
    return row && Object.freeze(row);
  }
  pendingInventory(): readonly PendingInventoryEntry[] {
    return Object.freeze(
      (this.#db.prepare(
        "SELECT hash,size,path FROM pending_candidate_blobs ORDER BY hash",
      ).all() as unknown as PendingInventoryEntry[]).map((row) =>
        Object.freeze(row)
      ),
    );
  }
  claimPublication(
    destinations: readonly string[],
  ): PublicationSaga | undefined {
    const current = this.publicationSaga();
    if (current) return current;
    const candidate = this.pendingCandidate();
    if (!candidate || destinations.length === 0) return undefined;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.publicationSaga();
      if (!existing) {
        this.#db.prepare(
          "INSERT INTO publication_sagas(batch_id,candidate_json,destinations_json) VALUES(?,?,?)",
        )
          .run(
            candidate.batchId,
            JSON.stringify(candidate),
            JSON.stringify([...destinations]),
          );
        this.#db.prepare(
          "INSERT INTO publication_saga_blobs SELECT batch_id,hash,size,path FROM pending_candidate_blobs WHERE batch_id=?",
        )
          .run(candidate.batchId);
      }
      this.#db.exec("COMMIT");
      return this.publicationSaga();
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  ensureEndpointWork(
    batchId: number,
    kind: EndpointWorkKind,
    targets: readonly string[],
    now: number,
  ): void {
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO publication_endpoint_work(batch_id,kind,target,status,next_attempt_at,code) VALUES(?,?,?,'pending',?,'unavailable')",
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      let changed = false;
      for (const target of targets) {
        if (insert.run(batchId, kind, target, now).changes === 1) {
          changed = true;
        }
      }
      this.#db.exec("COMMIT");
      if (changed) this.changes$.next("publication-work");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  endpointWork(): readonly EndpointWork[] {
    const rows = this.#db.prepare(
      `SELECT batch_id batchId,kind,target,status,attempts,
       next_attempt_at nextAttemptAt,code FROM publication_endpoint_work
       ORDER BY next_attempt_at,batch_id,kind,target`,
    ).all() as unknown as EndpointWork[];
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }
  nextDueWork(): EndpointWork | undefined {
    return this.endpointWork().find((row) =>
      row.status === "pending" || row.status === "retry"
    );
  }
  claimDueWork(now: number, limit: number): readonly EndpointWork[] {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#db.prepare(
        `SELECT batch_id batchId,kind,target,status,attempts,
         next_attempt_at nextAttemptAt,code FROM publication_endpoint_work
         WHERE status IN ('pending','retry') AND next_attempt_at<=?
         ORDER BY next_attempt_at,batch_id,kind,target LIMIT ?`,
      ).all(now, limit) as unknown as EndpointWork[];
      const claim = this.#db.prepare(
        "UPDATE publication_endpoint_work SET status='claimed' WHERE batch_id=? AND kind=? AND target=? AND status IN ('pending','retry')",
      );
      for (const row of rows) claim.run(row.batchId, row.kind, row.target);
      this.#db.exec("COMMIT");
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({ ...row, status: "claimed" as const })
        ),
      );
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  recordEndpointOutcome(
    work: EndpointWork,
    outcome: {
      readonly ok: boolean;
      readonly nextAttemptAt: number;
      readonly code: EndpointWorkCode;
      readonly exhausted?: boolean;
    },
  ): void {
    const result = this.#db.prepare(
      `UPDATE publication_endpoint_work SET status=?,attempts=attempts+1,
       next_attempt_at=?,code=? WHERE batch_id=? AND kind=? AND target=? AND status='claimed'`,
    ).run(
      outcome.ok ? "complete" : outcome.exhausted ? "exhausted" : "retry",
      outcome.nextAttemptAt,
      outcome.code,
      work.batchId,
      work.kind,
      work.target,
    );
    if (result.changes !== 1) throw new Error("endpoint work claim lost");
    this.changes$.next("publication-work");
  }
  publicationSaga(): PublicationSaga | undefined {
    const row = this.#db.prepare(
      "SELECT batch_id,candidate_json,destinations_json,complete_server,template_json,signed_event_json,acknowledged_relay,committed,admitted FROM publication_sagas ORDER BY batch_id LIMIT 1",
    ).get() as unknown as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return Object.freeze({
      batchId: row.batch_id as number,
      candidate: Object.freeze(JSON.parse(row.candidate_json as string)),
      destinations: Object.freeze(JSON.parse(row.destinations_json as string)),
      ...(row.complete_server
        ? { completeServer: row.complete_server as string }
        : {}),
      ...(row.template_json
        ? { template: Object.freeze(JSON.parse(row.template_json as string)) }
        : {}),
      ...(row.signed_event_json
        ? {
          signedEvent: Object.freeze(
            JSON.parse(row.signed_event_json as string),
          ),
        }
        : {}),
      ...(row.acknowledged_relay
        ? { acknowledgedRelay: row.acknowledged_relay as string }
        : {}),
      committed: row.committed === 1,
      admitted: row.admitted === 1,
    });
  }
  publicationHistory(): readonly PublicationSaga[] {
    const rows = this.#db.prepare(
      "SELECT batch_id,candidate_json,destinations_json,complete_server,template_json,signed_event_json,acknowledged_relay,committed,admitted FROM publication_saga_history ORDER BY batch_id",
    ).all() as unknown as Record<string, unknown>[];
    return Object.freeze(rows.map((row) =>
      Object.freeze({
        batchId: row.batch_id as number,
        candidate: Object.freeze(JSON.parse(row.candidate_json as string)),
        destinations: Object.freeze(
          JSON.parse(row.destinations_json as string),
        ),
        ...(row.complete_server
          ? { completeServer: row.complete_server as string }
          : {}),
        ...(row.template_json
          ? { template: Object.freeze(JSON.parse(row.template_json as string)) }
          : {}),
        ...(row.signed_event_json
          ? {
            signedEvent: Object.freeze(
              JSON.parse(row.signed_event_json as string),
            ),
          }
          : {}),
        ...(row.acknowledged_relay
          ? { acknowledgedRelay: row.acknowledged_relay as string }
          : {}),
        committed: row.committed === 1,
        admitted: row.admitted === 1,
      })
    ));
  }
  beginPublicationRefresh(now: number, refreshLeadSeconds: number): boolean {
    const saga = this.publicationSaga();
    const expiration = saga?.signedEvent?.tags.find((tag) =>
      tag[0] === "expiration"
    )?.[1];
    if (
      !saga?.committed || !saga.admitted || !expiration ||
      Number(expiration) > now + refreshLeadSeconds
    ) return false;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const nextBatchId = (this.#db.prepare(
        "SELECT MAX(batch_id) value FROM (SELECT batch_id FROM publication_sagas UNION ALL SELECT batch_id FROM publication_saga_history)",
      ).get() as unknown as { value: number | null }).value! + 1;
      this.#db.prepare(
        `INSERT OR IGNORE INTO publication_saga_history
         SELECT batch_id,candidate_json,destinations_json,complete_server,template_json,signed_event_json,acknowledged_relay,committed,admitted,?
         FROM publication_sagas WHERE batch_id=?`,
      ).run(now, saga.batchId);
      this.#db.prepare(
        "INSERT INTO publication_saga_blobs SELECT ?,hash,size,path FROM publication_saga_blobs WHERE batch_id=?",
      ).run(nextBatchId, saga.batchId);
      this.#db.prepare("DELETE FROM publication_endpoint_work WHERE batch_id=?")
        .run(saga.batchId);
      this.#db.prepare("DELETE FROM publication_blob_proofs WHERE batch_id=?")
        .run(saga.batchId);
      this.#db.prepare("DELETE FROM publication_saga_blobs WHERE batch_id=?")
        .run(saga.batchId);
      this.#db.prepare("DELETE FROM publication_sagas WHERE batch_id=?").run(
        saga.batchId,
      );
      const candidate = { ...saga.candidate, batchId: nextBatchId };
      this.#db.prepare(
        "INSERT INTO publication_sagas(batch_id,candidate_json,destinations_json) VALUES(?,?,?)",
      ).run(
        nextBatchId,
        JSON.stringify(candidate),
        JSON.stringify(saga.destinations),
      );
      this.#db.exec("COMMIT");
      this.changes$.next("publication-refresh");
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  publicationInventory(batchId: number): readonly PendingInventoryEntry[] {
    return Object.freeze(
      (this.#db.prepare(
        "SELECT hash,size,path FROM publication_saga_blobs WHERE batch_id=? ORDER BY hash",
      ).all(batchId) as unknown as PendingInventoryEntry[]).map((entry) =>
        Object.freeze(entry)
      ),
    );
  }
  recordBlobProof(batchId: number, server: string, hash: string): void {
    const saga = this.publicationSaga();
    if (
      !saga || saga.batchId !== batchId || !saga.destinations.includes(server)
    ) {
      throw new Error("proof server is not part of the claimed saga");
    }
    const blob = this.#db.prepare(
      "SELECT 1 present FROM publication_saga_blobs WHERE batch_id=? AND hash=?",
    ).get(batchId, hash);
    if (!blob) {
      throw new Error("proof hash is not part of the claimed inventory");
    }
    this.#db.prepare(
      "INSERT OR IGNORE INTO publication_blob_proofs(batch_id,server,hash) VALUES(?,?,?)",
    ).run(batchId, server, hash);
  }
  serverComplete(batchId: number, server: string): boolean {
    const row = this.#db.prepare(
      "SELECT COUNT(*) total,(SELECT COUNT(*) FROM publication_blob_proofs p WHERE p.batch_id=? AND p.server=?) proven FROM publication_saga_blobs b WHERE b.batch_id=?",
    ).get(batchId, server, batchId) as unknown as {
      total: number;
      proven: number;
    };
    return row.total > 0 && row.total === row.proven;
  }
  recordCompleteServer(batchId: number, server: string): void {
    if (!this.serverComplete(batchId, server)) {
      throw new Error("server is not complete");
    }
    this.#db.prepare(
      "UPDATE publication_sagas SET complete_server=COALESCE(complete_server,?) WHERE batch_id=?",
    ).run(server, batchId);
  }
  recordSigned(
    batchId: number,
    template: Record<string, unknown>,
    event: import("../protocol/publication.ts").RawPublication,
  ): void {
    const saga = this.publicationSaga();
    if (!saga?.completeServer) {
      throw new Error("complete replica proof required before signing");
    }
    const expected = template as {
      kind?: unknown;
      created_at?: unknown;
      tags?: unknown;
      content?: unknown;
    };
    if (
      event.kind !== expected.kind ||
      event.created_at !== expected.created_at ||
      event.content !== expected.content ||
      JSON.stringify(event.tags) !== JSON.stringify(expected.tags) ||
      !verifyEvent(event) || !validatePublication(event, event.created_at).ok
    ) {
      throw new Error("signed event differs from template");
    }
    if (
      saga.signedEvent &&
      JSON.stringify(saga.signedEvent) !== JSON.stringify(event)
    ) throw new Error("signed event is immutable");
    this.#db.prepare(
      "UPDATE publication_sagas SET template_json=COALESCE(template_json,?),signed_event_json=COALESCE(signed_event_json,?) WHERE batch_id=?",
    )
      .run(JSON.stringify(template), JSON.stringify(event), batchId);
  }
  recordRelayAcknowledgement(batchId: number, relay: string): void {
    const saga = this.publicationSaga();
    if (!saga?.signedEvent) {
      throw new Error("signed event required before acknowledgement");
    }
    this.#db.prepare(
      "UPDATE publication_sagas SET acknowledged_relay=COALESCE(acknowledged_relay,?) WHERE batch_id=?",
    ).run(relay, batchId);
  }
  commitPublication(batchId: number): void {
    const saga = this.publicationSaga();
    if (!saga?.acknowledgedRelay) {
      throw new Error("relay acknowledgement required before commit");
    }
    this.#db.prepare(
      "UPDATE publication_sagas SET committed=1 WHERE batch_id=?",
    ).run(batchId);
  }
  markPublicationAdmitted(batchId: number): void {
    const saga = this.publicationSaga();
    if (!saga?.committed) {
      throw new Error("publication commit required before admission");
    }
    this.#db.prepare("UPDATE publication_sagas SET admitted=1 WHERE batch_id=?")
      .run(batchId);
  }
  batches(): readonly {
    id: number;
    token: number;
    generation: number;
    status: string;
  }[] {
    return Object.freeze(
      (this.#db.prepare(
        "SELECT id,token,generation,status FROM publication_batches ORDER BY id",
      ).all() as unknown as {
        id: number;
        token: number;
        generation: number;
        status: string;
      }[]).map((row) => Object.freeze(row)),
    );
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
      this.changes$.next(route);
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
    this.changes$.complete();
    this.#db.close();
  }
}
