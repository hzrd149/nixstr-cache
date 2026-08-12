import {
  BudgetExceeded,
  type PathResolver,
  type RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import { cacheIdentity } from "../protocol/publication.ts";
import {
  appendNarInfoSignatures,
  differingNarInfoFields,
  type NarInfo,
  type NarInfoField,
  parseNarInfo,
} from "../protocol/narinfo.ts";
import type {
  MergedSelectionSnapshot,
  SelectedPublication,
} from "../nostr/selection.ts";
import type { SignerOverlaySnapshot } from "../write/overlay.ts";

export interface NarInfoConflictDiagnostic {
  readonly code: "narinfo-semantic-conflict";
  readonly storePathHash: string;
  readonly winnerIdentity: string;
  readonly winnerEventId: string;
  readonly loserIdentity: string;
  readonly loserEventId: string;
  readonly differingFields: readonly NarInfoField[];
}
export type MergedCacheDiagnostic = NarInfoConflictDiagnostic;
export interface DiagnosticSink {
  emit(diagnostic: MergedCacheDiagnostic): void;
}

export interface MergedNarInfoResult {
  readonly winner: SelectedPublication;
  readonly record: NarInfo;
  readonly text: string;
}

async function boundedText(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      if (next.value.byteLength > limit - total) {
        throw new BudgetExceeded("decoded metadata byte budget exceeded");
      }
      total += next.value.byteLength;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (!done) {
      try {
        await reader.cancel(error);
      } catch { /* retain original error */ }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function resolveMergedNarInfo(options: {
  snapshot: MergedSelectionSnapshot;
  path: string;
  storePathHash: string;
  budget: RequestBudget;
  signal?: AbortSignal;
  decodedMetadataBytes: number;
  resolverFor(publication: SelectedPublication): Pick<PathResolver, "resolve">;
  diagnostics?: DiagnosticSink;
}): Promise<MergedNarInfoResult> {
  const found: { publication: SelectedPublication; record: NarInfo }[] = [];
  for (const publication of options.snapshot) {
    try {
      const resolved = await options.resolverFor(publication).resolve(
        publication.root.hex,
        options.path,
        "GET",
        options.budget,
        options.signal,
      );
      if (resolved.size > options.decodedMetadataBytes) {
        await resolved.body?.cancel(
          "decoded metadata descriptor exceeds limit",
        );
        throw new BudgetExceeded("decoded metadata byte budget exceeded");
      }
      if (!resolved.body) throw new Error("GET resolution omitted body");
      found.push({
        publication,
        record: parseNarInfo(
          await boundedText(resolved.body, options.decodedMetadataBytes),
        ),
      });
    } catch (error) {
      if (error instanceof VerifiedAbsent) continue;
      throw error;
    }
  }
  const first = found[0];
  if (!first) throw new VerifiedAbsent(options.path);
  const conflicts: { item: typeof first; fields: NarInfoField[] }[] = [];
  for (const item of found.slice(1)) {
    const fields = differingNarInfoFields(first.record, item.record);
    if (fields.length) conflicts.push({ item, fields });
  }
  if (conflicts.length) {
    for (const { item, fields } of conflicts) {
      options.diagnostics?.emit(Object.freeze({
        code: "narinfo-semantic-conflict",
        storePathHash: options.storePathHash,
        winnerIdentity: cacheIdentity(first.publication),
        winnerEventId: first.publication.event.id,
        loserIdentity: cacheIdentity(item.publication),
        loserEventId: item.publication.event.id,
        differingFields: Object.freeze([...fields].sort()),
      }));
    }
    return Object.freeze({
      winner: first.publication,
      record: first.record,
      text: first.record.rawText,
    });
  }
  const appended = found.slice(1).flatMap(({ record }) =>
    record.signatures.map((value) => value.rawLine)
  );
  return Object.freeze({
    winner: first.publication,
    record: first.record,
    text: appendNarInfoSignatures(first.record, appended),
  });
}

function normalizedNarPath(path: string): string | undefined {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return /^nar\/[A-Za-z0-9._+\/-]+$/.test(normalized) &&
      !normalized.split("/").includes("..")
    ? normalized
    : undefined;
}

export class WinnerRouteRegistry {
  readonly #entries = new Map<
    string,
    { publication: SelectedPublication; expiresAt: number }
  >();
  constructor(
    readonly maxEntries: number,
    readonly ttlMs: number,
    readonly now = Date.now,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive integer");
    }
  }
  set(path: string, publication: SelectedPublication): void {
    const key = normalizedNarPath(path);
    if (!key) throw new TypeError("invalid NAR route");
    this.#purge();
    this.#entries.delete(key);
    while (this.#entries.size >= this.maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value!);
    }
    this.#entries.set(key, { publication, expiresAt: this.now() + this.ttlMs });
  }
  get(path: string): SelectedPublication | undefined {
    const key = normalizedNarPath(path);
    if (!key) return undefined;
    const entry = this.#entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.publication;
  }
  #purge() {
    const now = this.now();
    for (const [key, value] of this.#entries) {
      if (value.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

export class SignerRouteRegistry {
  readonly #entries = new Map<
    string,
    { snapshot: SignerOverlaySnapshot; expiresAt: number }
  >();
  constructor(
    readonly maxEntries: number,
    readonly ttlMs: number,
    readonly now = Date.now,
  ) {}
  set(path: string, snapshot: SignerOverlaySnapshot): void {
    const key = normalizedNarPath(path);
    if (!key) throw new TypeError("invalid NAR route");
    this.#purge();
    this.#entries.delete(key);
    while (this.#entries.size >= this.maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value!);
    }
    this.#entries.set(key, { snapshot, expiresAt: this.now() + this.ttlMs });
  }
  get(path: string): SignerOverlaySnapshot | undefined {
    const key = normalizedNarPath(path);
    if (!key) return undefined;
    const entry = this.#entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.snapshot;
  }
  #purge(): void {
    const now = this.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}
