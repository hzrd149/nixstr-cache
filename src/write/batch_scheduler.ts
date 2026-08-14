import type {
  FrozenBatch,
  PendingCandidate,
  WriteRepository,
} from "../persistence/write_repository.ts";
import type { HashtreeBuild, LogicalFileSource } from "../hashtree/writer.ts";
import type { OperationalDiagnosticSink } from "../operations/diagnostics.ts";
import { debugWriteHashtreeState } from "../operations/debug.ts";

export interface BatchWriter {
  build(
    files: LogicalFileSource,
    base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild>;
  close?(): Promise<void>;
}

export interface BatchClock {
  readonly now: number;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
}
export type WritableStateDebug = (
  message: string,
  fields: Readonly<Record<string, string | number>>,
) => void;
const systemClock: BatchClock = {
  get now() {
    return Date.now();
  },
  setTimer(callback, delay) {
    return Number(setTimeout(callback, delay));
  },
  clearTimer(id) {
    clearTimeout(id);
  },
};

export class PublicationBatchScheduler {
  #quiet?: number;
  #maximum?: number;
  #serial: Promise<void> = Promise.resolve();
  #closed = false;
  #lastPendingRoot?: string;
  readonly #abort = new AbortController();
  constructor(
    readonly repository: WriteRepository,
    readonly writer: BatchWriter,
    readonly clock: BatchClock = systemClock,
    readonly diagnostics?: OperationalDiagnosticSink,
    readonly stateDebug: WritableStateDebug = debugWriteHashtreeState,
    readonly quietDelayMs = 5_000,
    readonly resolveBase?: (
      root: string,
      signal: AbortSignal,
    ) => Promise<HashtreeBuild>,
    readonly onBatchStarted?: (batch: FrozenBatch) => void,
  ) {
    const pending = repository.pendingCandidate();
    if (pending) this.#logPending(pending);
    for (const batch of repository.failedBatches()) this.#enqueue(batch);
    const window = repository.activePublicationWindow();
    if (window) this.#arm(window);
  }
  dirty(generation: number, baseRoot?: string): void {
    if (this.#closed) return;
    const window = this.repository.markPublicationDirty(
      generation,
      this.clock.now,
      baseRoot,
    );
    this.#arm(window);
  }
  #arm(window: { token: number; openedAt: number; lastDirtyAt: number }): void {
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    this.#quiet = this.clock.setTimer(
      () => this.#fire(window.token, "quiet"),
      Math.max(0, window.lastDirtyAt + this.quietDelayMs - this.clock.now),
    );
    this.#maximum = this.clock.setTimer(
      () => this.#fire(window.token, "maximum"),
      Math.max(0, window.openedAt + 60_000 - this.clock.now),
    );
  }
  #fire(token: number, trigger: "quiet" | "maximum"): void {
    if (this.#closed) return;
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    this.#quiet = this.#maximum = undefined;
    const batch = this.repository.claimPublicationBatch(token);
    if (batch) {
      try {
        this.diagnostics?.emit({
          type: "publication_window",
          code: "publication_window_elapsed",
          trigger,
          batchId: batch.id,
          generation: batch.generation,
          count: batch.entryCount,
        });
      } catch { /* diagnostics are non-authoritative */ }
      try {
        this.onBatchStarted?.(batch);
      } catch { /* cancellation notification is best-effort */ }
      this.#enqueue(batch);
    }
  }
  #enqueue(batch: FrozenBatch): void {
    this.#serial = this.#serial.catch(() => {}).then(async () => {
      let candidate: HashtreeBuild | undefined;
      let base: HashtreeBuild | undefined;
      try {
        base = batch.baseRoot
          ? await this.resolveBase?.(batch.baseRoot, this.#abort.signal)
          : undefined;
        candidate = await this.writer.build(
          this.repository.publicationBatchFiles(
            batch,
            batch.entryCount,
            this.#abort.signal,
          ),
          base,
          this.#abort.signal,
        );
        this.repository.recordPending(
          batch,
          {
            batchId: batch.id,
            generation: batch.generation,
            rootHex: candidate.rootHex,
            nhash: candidate.rootNhash,
            blobCount: candidate.inventory.length,
            totalBytes: candidate.totalBytes,
          },
          candidate.inventory,
          candidate.runId,
        );
        this.#logPending({
          batchId: batch.id,
          generation: batch.generation,
          rootHex: candidate.rootHex,
          nhash: candidate.rootNhash,
          blobCount: candidate.inventory.length,
          totalBytes: candidate.totalBytes,
        });
      } catch (error) {
        this.repository.markBatchFailed(batch.id);
        try {
          this.diagnostics?.emit({
            type: "batch_build_failure",
            code: "hashtree_build_failed",
            batchId: batch.id,
            count: batch.entryCount,
          });
        } catch { /* diagnostics are non-authoritative */ }
        throw error;
      } finally {
        await candidate?.dispose();
        await base?.dispose();
      }
    });
  }
  #logPending(candidate: PendingCandidate): void {
    if (candidate.nhash === this.#lastPendingRoot) return;
    try {
      this.stateDebug("pending", {
        generation: candidate.generation,
        batchId: candidate.batchId,
        root: candidate.nhash,
        blobCount: candidate.blobCount,
        totalBytes: candidate.totalBytes,
      });
      this.#lastPendingRoot = candidate.nhash;
    } catch { /* debug logging is non-authoritative */ }
  }
  idle(): Promise<void> {
    return this.#serial;
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort("batch scheduler closed");
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    this.#quiet = this.#maximum = undefined;
    try {
      await this.#serial;
    } finally {
      await this.writer.close?.();
    }
  }
}
