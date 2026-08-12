import { assertEquals, assertGreater, assertRejects } from "@std/assert";
import { FILE_CHUNK_BYTES, HashtreeWriter } from "../../src/hashtree/writer.ts";
import { decodeManifest } from "../../src/protocol/hashtree.ts";
import { WriteRepository } from "../../src/persistence/write_repository.ts";
import { DatabaseSync } from "node:sqlite";

Deno.test("canonical writer is deterministic, reader-compatible, and reuses blobs", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.writeFile(source, new Uint8Array(2_097_153).fill(7));
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 174,
      maxInventoryBlobs: 1024,
      maxInventoryBytes: 8_000_000,
    });
    const input = [{ route: "nar/example.nar", path: source, size: 2_097_153 }];
    const first = await writer.build(input);
    const second = await writer.build(input, first);
    assertEquals(first.rootHex, second.rootHex);
    assertEquals(
      [...first.inventory].map((x) => x.hash),
      [...second.inventory].map((x) => x.hash),
    );
    assertEquals(second.createdBlobs, 0);
    assertGreater(first.inventory.length, 3);
    const rootWire = await Deno.readFile(
      [...first.inventory].find((x) => x.hash === first.rootHex)!.path,
    );
    assertEquals(
      decodeManifest(rootWire, {
        maxWireBytes: 1_000_000,
        maxDecodedBytes: 1_000_000,
        maxLinks: 174,
      }).type,
      "directory",
    );
    await first.dispose();
    assertEquals(
      await Deno.stat(second.rootPath).then((value) => value.isFile),
      true,
      "one run must not delete content still owned by a concurrent run",
    );
    await second.dispose();
    assertEquals(
      await Deno.stat(second.rootPath).then(() => true).catch(() => false),
      false,
      "the final run owner must reclaim zero-owner content",
    );
    await writer.close();
    await writer.close();
    await writer.build(input).then(
      () => {
        throw new Error("closed writer accepted a build");
      },
      (error) =>
        assertEquals((error as Error).message, "hashtree writer is closed"),
    );
    const artifacts = [...Deno.readDirSync(`${root}/trees`)].map((entry) =>
      entry.name
    );
    assertEquals(
      artifacts.some((name) => name.startsWith("inventory-")),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("close build race drains active operation and rejects after closing", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.writeTextFile(source, "x");
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 32,
      maxInventoryBytes: 4096,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => release = resolve);
    const active = writer.build({
      async *[Symbol.asyncIterator]() {
        await gate;
        yield { route: "a", path: source, size: 1 };
      },
    });
    let closed = false;
    const closing = writer.close().then(() => closed = true);
    await Promise.resolve();
    assertEquals(closed, false);
    await assertRejects(
      () => writer.build([]),
      Error,
      "hashtree writer is closed",
    );
    release();
    await active;
    await closing;
    assertEquals(closed, true);
    await writer.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanup tombstone survives deletion failure and clears on retry", async () => {
  const root = await Deno.makeTempDir();
  const dbPath = `${root}/write.db`;
  try {
    const source = `${root}/source`;
    await Deno.writeTextFile(source, "x");
    let repository = new WriteRepository(
      dbPath,
      `${root}/spool`,
      { perBodyBytes: 64, aggregateBytes: 1024 },
      () => {
        throw new Deno.errors.PermissionDenied("injected");
      },
    );
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 32,
      maxInventoryBytes: 4096,
    }, repository);
    const build = await writer.build([{ route: "a", path: source, size: 1 }]);
    await build.dispose();
    await writer.close();
    repository.close();
    let inspect = new DatabaseSync(dbPath, { readOnly: true });
    assertEquals(
      (inspect.prepare("SELECT COUNT(*) count FROM writer_run_cleanup")
        .get() as { count: number }).count,
      1,
    );
    inspect.close();
    repository = new WriteRepository(dbPath, `${root}/spool`, {
      perBodyBytes: 64,
      aggregateBytes: 1024,
    });
    repository.close();
    inspect = new DatabaseSync(dbPath, { readOnly: true });
    assertEquals(
      (inspect.prepare("SELECT COUNT(*) count FROM writer_run_cleanup")
        .get() as { count: number }).count,
      0,
    );
    inspect.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("directory ordering is UTF-8 bytewise and fanout stays bounded", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.writeTextFile(source, "x");
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 1024,
      maxInventoryBytes: 1_000_000,
    });
    const result = await writer.build(["a", "z", "é"].map((name) => ({
      route: `${name}/file`,
      path: source,
      size: 1,
    })));
    const manifest = decodeManifest(await Deno.readFile(result.rootPath), {
      maxWireBytes: 1_000_000,
      maxDecodedBytes: 1_000_000,
      maxLinks: 2,
    });
    assertEquals(manifest.type, "fanout");
    assertEquals(
      manifest.links.every((link) => link.type === 2 || link.type === 3),
      true,
    );
    await result.dispose();
    await writer.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("one-path updates reuse unchanged persistent blobs", async () => {
  const root = await Deno.makeTempDir();
  try {
    const a = `${root}/a`, b = `${root}/b`;
    await Deno.writeTextFile(a, "same");
    await Deno.writeTextFile(b, "before");
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 174,
      maxInventoryBlobs: 100,
      maxInventoryBytes: 65536,
    });
    const first = await writer.build([
      { route: "a", path: a, size: 4 },
      { route: "b", path: b, size: 6 },
    ]);
    await Deno.writeTextFile(b, "after!");
    const second = await writer.build([
      { route: "a", path: a, size: 4 },
      { route: "b", path: b, size: 6 },
    ], first);
    assertEquals(first.rootHex === second.rootHex, false);
    assertEquals(second.createdBlobs < second.inventory.length, true);
    assertEquals(
      [...second.inventory].some((blob) =>
        [...first.inventory].some((old) => old.hash === blob.hash)
      ),
      true,
    );
    await first.dispose();
    await second.dispose();
    await writer.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("bounded durable iteration is single-pass ordered and cancellable", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.writeTextFile(source, "x");
    let iterations = 0;
    let yields = 0;
    const files = {
      async *[Symbol.asyncIterator]() {
        iterations++;
        for (const route of ["a", "b", "c"]) {
          yields++;
          yield { route, path: source, size: 1 };
        }
      },
    };
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 100,
      maxInventoryBytes: 65536,
      maxEntries: 3,
      maxRouteBytes: 16,
      maxRouteDepth: 2,
    });
    const streamed = await writer.build(files);
    const array = await writer.build(["a", "b", "c"].map((route) => ({
      route,
      path: source,
      size: 1,
    })));
    assertEquals(streamed.rootHex, array.rootHex);
    assertEquals(iterations, 1);
    assertEquals(yields, 3);
    assertEquals(streamed.maxBufferedLinks <= 2, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("durable directory runs keep link working set independent of route count", async () => {
  const root = await Deno.makeTempDir();
  try {
    const source = `${root}/source`;
    await Deno.writeTextFile(source, "x");
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 3,
      maxInventoryBlobs: 1000,
      maxInventoryBytes: 1_000_000,
      maxEntries: 200,
    });
    const routes = async function* () {
      for (let i = 0; i < 150; i++) {
        yield {
          route: `dir/${String(i).padStart(3, "0")}`,
          path: source,
          size: 1,
        };
      }
    };
    const built = await writer.build(routes());
    assertEquals(built.maxBufferedLinks, 3);
    assertEquals(built.inventory.length > built.maxBufferedLinks, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("pinned canonical boundary hashes detect chunk grouping drift", async () => {
  // BUD-16/17/18 proposal fixtures pinned by NIP.md on 2026-08-12.
  const expected = [
    [
      FILE_CHUNK_BYTES - 1,
      "852156fe9bb800db4250e1cc20f16a06beea162751d415061932cb007efde2ab",
      "nhash1qqsg2g2kl6dmsqxmgfgwrnpq794qd0h2zcn4r4q4qcvn9jcq0m7792cf2764x",
    ],
    [
      FILE_CHUNK_BYTES,
      "516862c020757d231206ec59642dfa190f8cdc2219f4761fa8bf3132d1893b82",
      "nhash1qqs9z6rzcqs82lfrzgrwckty9hapjruvms3pnarkr75t7vfj6xynhqs9zzcqs",
    ],
    [
      FILE_CHUNK_BYTES + 1,
      "85e63254c339fb200759e7cd3986bfa2854f8e1bbb24241876b1342d84fe1629",
      "nhash1qqsgte3j2npnn7eqqav70nfes6l69p203cdmkfpyrpmtzdpdsnlpv2g3m0p4c",
    ],
  ] as const;
  const root = await Deno.makeTempDir();
  try {
    for (const [size, rootHex, rootNhash] of expected) {
      const source = `${root}/${size}`;
      await Deno.writeFile(source, new Uint8Array(size).fill(7));
      const writer = new HashtreeWriter(`${root}/trees-${size}`, {
        maxLinks: 174,
        maxInventoryBlobs: 100,
        maxInventoryBytes: 10_000_000,
      });
      const built = await writer.build([
        { route: "nar/x.nar", path: source, size },
      ]);
      assertEquals(built.rootHex, rootHex);
      assertEquals(built.rootNhash, rootNhash);
      assertEquals(
        (await writer.build([
          { route: "nar/x.nar", path: source, size },
        ])).createdBlobs,
        0,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
