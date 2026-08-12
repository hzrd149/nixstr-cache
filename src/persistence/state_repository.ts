import { DatabaseSync } from "node:sqlite";
import {
  cacheIdentity,
  RawPublication,
  ValidatedPublication,
} from "../protocol/publication.ts";

export interface StoredSelection {
  readonly identity: string;
  readonly event: Readonly<RawPublication>;
  readonly createdAt: number;
  readonly eventId: string;
  readonly signed: boolean;
}

export interface IdentityPolicy {
  readonly signedHistory: boolean;
  readonly unsignedConsent: boolean;
}

export interface AcceptanceResult {
  readonly accepted: boolean;
  readonly reason?: "stale" | "downgrade-consent-required";
  readonly selection?: StoredSelection;
}

export interface CorruptSelection {
  readonly identity: string;
  readonly error: unknown;
}

interface RepositoryOptions {
  readonly beforeCommit?: () => void;
}

interface IdentityRow {
  identity: string;
  event_json: string | null;
  created_at: number | null;
  event_id: string | null;
  signed_history: number;
  unsigned_consent: number;
}

export class StateRepository {
  readonly #db: DatabaseSync;
  readonly #beforeCommit?: () => void;

  constructor(path: string, options: RepositoryOptions = {}) {
    this.#db = new DatabaseSync(path);
    this.#beforeCommit = options.beforeCommit;
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS identity_state (
        identity TEXT PRIMARY KEY,
        event_json TEXT,
        created_at INTEGER,
        event_id TEXT,
        signed_history INTEGER NOT NULL DEFAULT 0 CHECK (signed_history IN (0, 1)),
        unsigned_consent INTEGER NOT NULL DEFAULT 0 CHECK (unsigned_consent IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS source_quarantine (
        origin TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      );
    `);
  }

  accept(publication: ValidatedPublication): AcceptanceResult {
    const identity = cacheIdentity(publication);
    const current = this.#row(identity);
    const signed = publication.nixSigKeys.length > 0;
    if (
      current?.signed_history === 1 && !signed && current.unsigned_consent !== 1
    ) {
      return Object.freeze({
        accepted: false,
        reason: "downgrade-consent-required",
      });
    }
    if (
      current?.created_at !== null && current?.created_at !== undefined &&
      current.event_id
    ) {
      const newer = publication.event.created_at > current.created_at ||
        (publication.event.created_at === current.created_at &&
          publication.event.id < current.event_id);
      if (!newer) return Object.freeze({ accepted: false, reason: "stale" });
    }

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`
        INSERT INTO identity_state
          (identity, event_json, created_at, event_id, signed_history, unsigned_consent)
        VALUES (:identity, :event_json, :created_at, :event_id, :signed_history, :unsigned_consent)
        ON CONFLICT(identity) DO UPDATE SET
          event_json = excluded.event_json,
          created_at = excluded.created_at,
          event_id = excluded.event_id,
          signed_history = MAX(identity_state.signed_history, excluded.signed_history),
          unsigned_consent = identity_state.unsigned_consent
      `).run({
        identity,
        event_json: JSON.stringify(publication.event),
        created_at: publication.event.created_at,
        event_id: publication.event.id,
        signed_history: signed ? 1 : 0,
        unsigned_consent: current?.unsigned_consent ?? 0,
      });
      this.#beforeCommit?.();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return Object.freeze({
      accepted: true,
      selection: this.loadSelection(identity)!,
    });
  }

  loadSelection(identity: string): StoredSelection | undefined {
    const row = this.#row(identity);
    if (!row?.event_json || row.created_at === null || row.event_id === null) {
      return;
    }
    const parsed: unknown = JSON.parse(row.event_json);
    if (!isRawPublication(parsed)) {
      throw new TypeError("stored publication has an invalid minimal shape");
    }
    const event = Object.freeze(parsed);
    return Object.freeze({
      identity,
      event,
      createdAt: row.created_at,
      eventId: row.event_id,
      signed: event.tags.some((tag) => tag[0] === "nixSigKey"),
    });
  }

  loadSelections(
    onCorrupt?: (corrupt: CorruptSelection) => void,
  ): readonly StoredSelection[] {
    const rows = this.#db.prepare(
      "SELECT identity FROM identity_state WHERE event_json IS NOT NULL",
    ).all() as unknown as Array<{ identity: string }>;
    const selections: StoredSelection[] = [];
    for (const row of rows) {
      try {
        const selection = this.loadSelection(row.identity);
        if (selection) selections.push(selection);
      } catch (error) {
        this.clearCorruptSelection(row.identity);
        onCorrupt?.(Object.freeze({ identity: row.identity, error }));
      }
    }
    return Object.freeze(selections);
  }

  clearCorruptSelection(identity: string): void {
    this.#db.prepare(`
      UPDATE identity_state
      SET event_json = NULL, created_at = NULL, event_id = NULL
      WHERE identity = ?
    `).run(identity);
  }

  loadPolicy(identity: string): IdentityPolicy {
    const row = this.#row(identity);
    return Object.freeze({
      signedHistory: row?.signed_history === 1,
      unsignedConsent: row?.unsigned_consent === 1,
    });
  }

  setUnsignedConsent(identity: string, allowed: boolean): void {
    this.#db.prepare(`
      INSERT INTO identity_state (identity, unsigned_consent)
      VALUES (:identity, :allowed)
      ON CONFLICT(identity) DO UPDATE SET unsigned_consent = excluded.unsigned_consent
    `).run({ identity, allowed: allowed ? 1 : 0 });
  }

  quarantine(origin: string, reason: string, at: number): void {
    this.#db.prepare(`
      INSERT INTO source_quarantine (origin, reason, quarantined_at)
      VALUES (:origin, :reason, :at)
      ON CONFLICT(origin) DO UPDATE SET reason = excluded.reason, quarantined_at = excluded.quarantined_at
    `).run({ origin, reason, at });
  }

  releaseQuarantine(origin: string): void {
    this.#db.prepare("DELETE FROM source_quarantine WHERE origin = ?").run(
      origin,
    );
  }

  isQuarantined(origin: string): boolean {
    return this.#db.prepare("SELECT 1 FROM source_quarantine WHERE origin = ?")
      .get(origin) !== undefined;
  }

  close(): void {
    this.#db.close();
  }

  #row(identity: string): IdentityRow | undefined {
    return this.#db.prepare("SELECT * FROM identity_state WHERE identity = ?")
      .get(identity) as unknown as IdentityRow | undefined;
  }
}

function isRawPublication(value: unknown): value is RawPublication {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && typeof event.pubkey === "string" &&
    typeof event.sig === "string" && typeof event.content === "string" &&
    Number.isSafeInteger(event.created_at) &&
    Number.isSafeInteger(event.kind) &&
    Array.isArray(event.tags) &&
    event.tags.every((tag) =>
      Array.isArray(tag) && tag.every((item) => typeof item === "string")
    );
}
