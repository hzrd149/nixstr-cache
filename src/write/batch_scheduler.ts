import type {
  FrozenBatch,
  WriteRepository,
} from "../persistence/write_repository.ts";
import type { HashtreeBuild, LogicalFileSource } from "../hashtree/writer.ts";
import type { OperationalDiagnosticSink } from "../operations/diagnostics.ts";

export interface BatchWriter {
  build(
    files: LogicalFileSource,
    base?: HashtreeBuild,
    signal?: AbortSignal,
  ): Promise<HashtreeBuild>;
}

export interface BatchClock {
  readonly now: number;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
}
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
  readonly #abort = new AbortController();
  constructor(
    readonly repository: WriteRepository,
    readonly writer: BatchWriter,
    readonly clock: BatchClock = systemClock,
    readonly diagnostics?: OperationalDiagnosticSink,
  ) {
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
      () => this.#fire(window.token),
      Math.max(0, window.lastDirtyAt + 5_000 - this.clock.now),
    );
    this.#maximum = this.clock.setTimer(
      () => this.#fire(window.token),
      Math.max(0, window.openedAt + 60_000 - this.clock.now),
    );
  }
  #fire(token: number): void {
    if (this.#closed) return;
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    this.#quiet = this.#maximum = undefined;
    const batch = this.repository.claimPublicationBatch(token);
    if (batch) this.#enqueue(batch);
  }
  #enqueue(batch: FrozenBatch): void {
    this.#serial = this.#serial.catch(() => {}).then(async () => {
      try {
        const candidate = await this.writer.build(
          this.repository.publicationBatchFiles(
            batch,
            batch.entryCount,
            this.#abort.signal,
          ),
          undefined,
          this.#abort.signal,
        );
        this.repository.recordPending(batch, {
          batchId: batch.id,
          generation: batch.generation,
          rootHex: candidate.rootHex,
          nhash: candidate.rootNhash,
          blobCount: candidate.inventory.length,
          totalBytes: candidate.totalBytes,
        }, candidate.inventory);
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
      }
    });
  }
  idle(): Promise<void> {
    return this.#serial;
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#abort.abort("batch scheduler closed");
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    await this.#serial;
  }
}
