import { assertEquals, assertExists } from "@std/assert";
import { WriteRepository } from "../../src/persistence/write_repository.ts";
import {
  type BatchClock,
  PublicationBatchScheduler,
} from "../../src/write/batch_scheduler.ts";
import { HashtreeWriter } from "../../src/hashtree/writer.ts";

class FakeClock implements BatchClock {
  now = 0;
  #next = 0;
  #timers = new Map<number, { at: number; callback: () => void }>();
  setTimer(callback: () => void, delay: number): number {
    const id = ++this.#next;
    this.#timers.set(id, { at: this.now + delay, callback });
    return id;
  }
  clearTimer(id: number): void {
    this.#timers.delete(id);
  }
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, x]) =>
        x.at <= this.now
      )
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) break;
      const [id, timer] = due[0];
      this.#timers.delete(id);
      timer.callback();
      await Promise.resolve();
    }
  }
}

Deno.test("quiet window builds one unpublished pending candidate", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      {
        perBodyBytes: 4096,
        aggregateBytes: 65536,
      },
    );
    await repository.stage("a.narinfo", new Blob(["metadata"]).stream());
    repository.commitOverlay([]);
    const generation = repository.commitOverlayRoutes(["a.narinfo"]);
    const before = repository.currentGeneration();
    const clock = new FakeClock();
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 174,
      maxInventoryBlobs: 100,
      maxInventoryBytes: 65536,
    });
    const scheduler = new PublicationBatchScheduler(repository, writer, clock);
    scheduler.dirty(generation);
    await clock.advance(4_999);
    assertEquals(repository.pendingCandidate(), undefined);
    await clock.advance(1);
    await scheduler.idle();
    const pending = repository.pendingCandidate();
    assertExists(pending);
    assertEquals(pending.generation, generation);
    assertEquals(repository.currentGeneration(), before);
    assertEquals(repository.pendingInventory().length > 0, true);
    await scheduler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sustained windows race safely and builds serialize across restart", async () => {
  const root = await Deno.makeTempDir();
  const db = `${root}/write.db`, spool = `${root}/spool`;
  try {
    let repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    await repository.stage("one", new Blob(["1"]).stream());
    const one = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    const scheduler = new PublicationBatchScheduler(
      repository,
      new HashtreeWriter(`${root}/trees`, {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 65536,
      }),
      clock,
    );
    for (let elapsed = 0; elapsed < 60_000; elapsed += 4_000) {
      scheduler.dirty(one);
      await clock.advance(4_000);
    }
    await scheduler.idle();
    assertEquals(repository.batches().length, 1);
    scheduler.dirty(one);
    await clock.advance(5_000);
    await scheduler.idle();
    assertEquals(repository.batches().length, 2);
    await scheduler.close();
    repository.close();
    repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    assertExists(repository.pendingCandidate());
    assertEquals(repository.currentGeneration(), one);
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("workers serialize and an interrupted frozen batch rebuilds after restart", async () => {
  const root = await Deno.makeTempDir();
  const db = `${root}/write.db`, spool = `${root}/spool`;
  try {
    let repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    await repository.stage("one", new Blob(["1"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    const first = repository.markPublicationDirty(generation, 0);
    assertExists(repository.claimPublicationBatch(first.token));
    repository.close();
    repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    let active = 0, maximum = 0;
    const real = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 174,
      maxInventoryBlobs: 100,
      maxInventoryBytes: 65536,
    });
    const writer = {
      async build(...args: Parameters<HashtreeWriter["build"]>) {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        try {
          return await real.build(...args);
        } finally {
          active--;
        }
      },
    };
    const clock = new FakeClock();
    const scheduler = new PublicationBatchScheduler(repository, writer, clock);
    scheduler.dirty(generation);
    await clock.advance(5_000);
    await scheduler.idle();
    assertEquals(maximum, 1);
    assertEquals(repository.batches().map((x) => x.status), [
      "pending",
      "pending",
    ]);
    await scheduler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("restart restores the durable quiet deadline without another dirty", async () => {
  const root = await Deno.makeTempDir();
  const db = `${root}/write.db`, spool = `${root}/spool`;
  try {
    let repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    await repository.stage("one", new Blob(["1"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    repository.markPublicationDirty(generation, 1_000, "base");
    repository.close();
    repository = new WriteRepository(db, spool, {
      perBodyBytes: 4096,
      aggregateBytes: 65536,
    });
    const clock = new FakeClock();
    clock.now = 4_000;
    const scheduler = new PublicationBatchScheduler(
      repository,
      new HashtreeWriter(`${root}/trees`, {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 65536,
      }),
      clock,
    );
    assertEquals(repository.activePublicationWindow()?.baseRoot, "base");
    await clock.advance(1_999);
    assertEquals(repository.pendingCandidate(), undefined);
    await clock.advance(1);
    await scheduler.idle();
    assertExists(repository.pendingCandidate());
    assertEquals(repository.batches().length, 1);
    await scheduler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("batch build failure diagnostic is typed and preserves durable retry", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      {
        perBodyBytes: 4096,
        aggregateBytes: 65536,
      },
    );
    await repository.stage("one", new Blob(["secret-content"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    const seen: unknown[] = [];
    const scheduler = new PublicationBatchScheduler(
      repository,
      { build: () => Promise.reject(new Error("/secret/path")) },
      clock,
      { emit: (item) => seen.push(item) },
    );
    scheduler.dirty(generation);
    await clock.advance(5_000);
    await scheduler.idle().catch(() => {});
    assertEquals(repository.batches().map((batch) => batch.status), ["failed"]);
    assertEquals(seen, [{
      type: "batch_build_failure",
      code: "hashtree_build_failed",
      batchId: 1,
      count: 1,
    }]);
    await scheduler.close().catch(() => {});
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
