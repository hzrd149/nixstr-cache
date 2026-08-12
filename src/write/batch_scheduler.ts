import type {
  FrozenBatch,
  WriteRepository,
} from "../persistence/write_repository.ts";
import type { HashtreeBuild, LogicalFile } from "../hashtree/writer.ts";

export interface BatchWriter {
  build(
    files: readonly LogicalFile[],
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
  constructor(
    readonly repository: WriteRepository,
    readonly writer: BatchWriter,
    readonly clock: BatchClock = systemClock,
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
          batch.entries.map((entry) => ({
            route: entry.route,
            path: entry.path,
            size: entry.size,
          })),
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
        throw error;
      }
    });
  }
  idle(): Promise<void> {
    return this.#serial;
  }
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#quiet !== undefined) this.clock.clearTimer(this.#quiet);
    if (this.#maximum !== undefined) this.clock.clearTimer(this.#maximum);
    await this.#serial;
  }
}
