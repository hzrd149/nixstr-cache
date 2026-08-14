import { assertEquals, assertExists } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { WriteRepository as BaseWriteRepository } from "../../src/persistence/write_repository.ts";
class WriteRepository extends BaseWriteRepository {
  constructor(...args: ConstructorParameters<typeof BaseWriteRepository>) {
    super(...args);
    this.bindIdentity(this.boundIdentity() ?? `17091:${"f".repeat(64)}:`);
  }
}
import {
  type BatchClock,
  PublicationBatchScheduler,
} from "../../src/write/batch_scheduler.ts";
import { FILE_CHUNK_BYTES, HashtreeWriter } from "../../src/hashtree/writer.ts";
import type { HashtreeBuild } from "../../src/hashtree/writer.ts";

const NHASH_A =
  "nhash1qqsg2g2kl6dmsqxmgfgwrnpq794qd0h2zcn4r4q4qcvn9jcq0m7792cf2764x";
const NHASH_B =
  "nhash1qqs9z6rzcqs82lfrzgrwckty9hapjruvms3pnarkr75t7vfj6xynhqs9zzcqs";

function candidate(rootNhash: string, rootHex: string): HashtreeBuild {
  return {
    runId: `run-${rootHex[0]}`,
    rootHex,
    rootNhash,
    rootPath: "/not-logged",
    inventory: Object.assign([], { length: 0 }),
    totalBytes: 17,
    createdBlobs: 0,
    maxBufferedLinks: 0,
    dispose: () => Promise.resolve(),
  };
}

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
    const store = repository.openBlobStore(`${root}/store`, {
      capacityBytes: 65536,
    });
    const clock = new FakeClock();
    const writer = new HashtreeWriter(
      `${root}/trees`,
      {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 65536,
      },
      repository,
      store,
    );
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
    assertEquals(
      store.inventory().every((entry) => entry.owners > 0),
      true,
      "disposing the writer run must retain the durable publication owner",
    );
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("configured quiet delay logs one successful publication claim", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      { perBodyBytes: 4096, aggregateBytes: 65536 },
    );
    await repository.stage("one", new Blob(["1"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    const seen: unknown[] = [];
    const started: number[] = [];
    const scheduler = new PublicationBatchScheduler(
      repository,
      new HashtreeWriter(`${root}/trees`, {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 65536,
      }, repository),
      clock,
      { emit: (item) => seen.push(item) },
      undefined,
      9_000,
      undefined,
      (batch) => started.push(batch.id),
    );
    scheduler.dirty(generation);
    await clock.advance(8_999);
    assertEquals(repository.pendingCandidate(), undefined);
    assertEquals(seen, []);
    await clock.advance(1);
    await scheduler.idle();
    assertEquals(seen, [{
      type: "publication_window",
      code: "publication_window_elapsed",
      trigger: "quiet",
      batchId: 1,
      generation,
      count: 1,
    }]);
    assertEquals(started, [1]);
    await scheduler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("pending publication inventory includes every staged NAR component", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      {
        perBodyBytes: FILE_CHUNK_BYTES + 1,
        aggregateBytes: 16_000_000,
      },
    );
    const store = repository.openBlobStore(`${root}/spool/store`, {
      capacityBytes: 16_000_000,
    });
    const bytes = new Uint8Array(FILE_CHUNK_BYTES + 1).fill(7);
    await repository.stage("nar/x.nar", new Blob([bytes]).stream());
    const generation = repository.commitOverlayRoutes(["nar/x.nar"]);
    const clock = new FakeClock();
    const writer = new HashtreeWriter(
      `${root}/trees`,
      {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 16_000_000,
      },
      repository,
      store,
    );
    const scheduler = new PublicationBatchScheduler(repository, writer, clock);
    scheduler.dirty(generation);
    await clock.advance(5_000);
    await scheduler.idle();
    const pending = repository.pendingCandidate();
    assertExists(pending);
    const inventory = [...repository.pendingInventory()];
    assertEquals(pending.blobCount, inventory.length);
    for (
      const hash of [
        sha256(bytes.subarray(0, FILE_CHUNK_BYTES)).toHex(),
        sha256(bytes.subarray(FILE_CHUNK_BYTES)).toHex(),
      ]
    ) {
      assertEquals(
        inventory.filter((blob) => blob.hash === hash).length,
        1,
      );
    }
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
    const seen: unknown[] = [];
    const scheduler = new PublicationBatchScheduler(
      repository,
      new HashtreeWriter(`${root}/trees`, {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 65536,
      }, repository),
      clock,
      { emit: (item) => seen.push(item) },
    );
    for (let elapsed = 0; elapsed < 60_000; elapsed += 4_000) {
      scheduler.dirty(one);
      await clock.advance(4_000);
    }
    await scheduler.idle();
    assertEquals(repository.batches().length, 1);
    assertEquals(seen, [{
      type: "publication_window",
      code: "publication_window_elapsed",
      trigger: "maximum",
      batchId: 1,
      generation: one,
      count: 1,
    }]);
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
    }, repository);
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
      }, repository),
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

Deno.test("scheduler resolves and passes the frozen base root to the writer", async () => {
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
    await repository.stage("one", new Blob(["1"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    const base = { rootHex: "base" } as HashtreeBuild;
    let received: HashtreeBuild | undefined;
    const scheduler = new PublicationBatchScheduler(
      repository,
      {
        build: (_files, value) => {
          received = value;
          return Promise.reject(new Error("stop after observing base"));
        },
      },
      clock,
      undefined,
      undefined,
      5_000,
      (root) => {
        assertEquals(root, "selected-root");
        return Promise.resolve(base);
      },
    );
    scheduler.dirty(generation, "selected-root");
    await clock.advance(5_000);
    await scheduler.idle().catch(() => {});
    assertEquals(received, base);
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
    assertEquals(seen, [
      {
        type: "publication_window",
        code: "publication_window_elapsed",
        trigger: "quiet",
        batchId: 1,
        generation,
        count: 1,
      },
      {
        type: "batch_build_failure",
        code: "hashtree_build_failed",
        batchId: 1,
        count: 1,
      },
    ]);
    await scheduler.close().catch(() => {});
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("streams frozen batch rows directly into the writer", async () => {
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
    await repository.stage("a", new Blob(["a"]).stream());
    await repository.stage("b", new Blob(["b"]).stream());
    const generation = repository.commitOverlayRoutes(["a", "b"]);
    const clock = new FakeClock();
    let asyncSource = false;
    const real = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 100,
      maxInventoryBytes: 65536,
    }, repository);
    const scheduler = new PublicationBatchScheduler(repository, {
      build(source, base, signal) {
        asyncSource = Symbol.asyncIterator in source;
        return real.build(source, base, signal);
      },
    }, clock);
    scheduler.dirty(generation);
    await clock.advance(5_000);
    await scheduler.idle();
    assertEquals(asyncSource, true);
    assertExists(repository.pendingCandidate());
    await scheduler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("writable Hashtree state logs durable distinct roots only", async () => {
  const root = await Deno.makeTempDir();
  const calls: string[] = [];
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      { perBodyBytes: 4096, aggregateBytes: 65536 },
    );
    await repository.stage("one", new Blob(["1"]).stream());
    const first = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    let build = 0;
    const scheduler = new PublicationBatchScheduler(
      repository,
      {
        build: () =>
          Promise.resolve(
            build++ < 2
              ? candidate(NHASH_A, "a".repeat(64))
              : candidate(NHASH_B, "b".repeat(64)),
          ),
      },
      clock,
      undefined,
      (message, fields) => {
        calls.push(
          `${message} generation=${fields.generation} batchId=${fields.batchId} root=${fields.root} blobCount=${fields.blobCount} totalBytes=${fields.totalBytes}`,
        );
      },
    );
    scheduler.dirty(first);
    await clock.advance(5_000);
    await scheduler.idle();
    scheduler.dirty(first);
    await clock.advance(5_000);
    await scheduler.idle();
    await repository.stage("two", new Blob(["2"]).stream());
    const second = repository.commitOverlayRoutes(["one", "two"]);
    scheduler.dirty(second);
    await clock.advance(5_000);
    await scheduler.idle();
    assertEquals(calls, [
      `pending generation=${first} batchId=1 root=${NHASH_A} blobCount=0 totalBytes=17`,
      `pending generation=${second} batchId=3 root=${NHASH_B} blobCount=0 totalBytes=17`,
    ]);
    await scheduler.close();
    const recovered = new PublicationBatchScheduler(
      repository,
      { build: () => Promise.reject(new Error("unused")) },
      clock,
      undefined,
      (message, fields) => {
        calls.push(
          `${message} generation=${fields.generation} batchId=${fields.batchId} root=${fields.root} blobCount=${fields.blobCount} totalBytes=${fields.totalBytes}`,
        );
      },
    );
    assertEquals(
      calls[2],
      `pending generation=${second} batchId=3 root=${NHASH_B} blobCount=0 totalBytes=17`,
    );
    await recovered.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("failed Hashtree builds do not log a pending root", async () => {
  const root = await Deno.makeTempDir();
  const calls: unknown[] = [];
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      { perBodyBytes: 4096, aggregateBytes: 65536 },
    );
    await repository.stage("one", new Blob(["1"]).stream());
    const generation = repository.commitOverlayRoutes(["one"]);
    const clock = new FakeClock();
    const scheduler = new PublicationBatchScheduler(
      repository,
      {
        build: () => Promise.reject(new Error("failed")),
      },
      clock,
      undefined,
      (...args) => calls.push(args),
    );
    scheduler.dirty(generation);
    await clock.advance(5_000);
    await scheduler.idle().catch(() => {});
    assertEquals(calls, []);
    await scheduler.close().catch(() => {});
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
