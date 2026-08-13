import { assertEquals, assertGreater, assertRejects } from "@std/assert";
import { FILE_CHUNK_BYTES, HashtreeWriter } from "../../src/hashtree/writer.ts";
import { decodeManifest } from "../../src/protocol/hashtree.ts";
import { WriteRepository as BaseWriteRepository } from "../../src/persistence/write_repository.ts";
class WriteRepository extends BaseWriteRepository {
  constructor(...args: ConstructorParameters<typeof BaseWriteRepository>) {
    super(...args);
    this.bindIdentity(this.boundIdentity() ?? `17091:${"f".repeat(64)}:`);
  }
}
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
    const manifestLimits = {
      maxWireBytes: 1_000_000,
      maxDecodedBytes: 1_000_000,
      maxLinks: 174,
    };
    const rootManifest = decodeManifest(rootWire, manifestLimits);
    assertEquals(rootManifest.type, "directory");
    const narLink = rootManifest.links.find((link) => link.name === "nar")!;
    assertEquals(narLink.size, input[0].size);
    const narWire = await Deno.readFile(
      [...first.inventory].find((x) => x.hash === narLink.hash.toHex())!.path,
    );
    const narManifest = decodeManifest(narWire, manifestLimits);
    const fileLink = narManifest.links.find((link) =>
      link.name === "example.nar"
    )!;
    assertEquals(fileLink.type, 1);
    assertEquals(fileLink.size, input[0].size);
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

Deno.test("file links preserve descendant plaintext sizes", async () => {
  const root = await Deno.makeTempDir();
  try {
    const size = FILE_CHUNK_BYTES * 2 + 1;
    const source = `${root}/source`;
    await Deno.writeFile(source, new Uint8Array(size).fill(7));
    const writer = new HashtreeWriter(`${root}/trees`, {
      maxLinks: 2,
      maxInventoryBlobs: 32,
      maxInventoryBytes: 8_000_000,
    });
    const built = await writer.build([
      { route: "nar/example.nar", path: source, size },
    ]);
    const limits = {
      maxWireBytes: 1_000_000,
      maxDecodedBytes: 1_000_000,
      maxLinks: 2,
    };
    const manifest = async (build: typeof built, hash: string) =>
      decodeManifest(
        await Deno.readFile(
          [...build.inventory].find((blob) => blob.hash === hash)!.path,
        ),
        limits,
      );
    const rootManifest = await manifest(built, built.rootHex);
    const narLink = rootManifest.links.find((link) => link.name === "nar")!;
    assertEquals(narLink.size, size);
    const narManifest = await manifest(built, narLink.hash.toHex());
    const fileLink = narManifest.links.find((link) =>
      link.name === "example.nar"
    )!;
    assertEquals(fileLink.type, 1);
    assertEquals(fileLink.size, size);
    const fileManifest = await manifest(built, fileLink.hash.toHex());
    assertEquals(fileManifest.type, "file");
    assertEquals(
      fileManifest.links.map((link) => link.size),
      [FILE_CHUNK_BYTES * 2, 1],
    );

    const updatedSize = FILE_CHUNK_BYTES + 1;
    await Deno.writeFile(source, new Uint8Array(updatedSize).fill(8));
    const updated = await writer.build([
      { route: "nar/example.nar", path: source, size: updatedSize },
    ], built);
    const updatedRoot = await manifest(updated, updated.rootHex);
    const updatedNar = updatedRoot.links.find((link) => link.name === "nar")!;
    assertEquals(updatedNar.size, updatedSize);
    const updatedDirectory = await manifest(updated, updatedNar.hash.toHex());
    const updatedFile = updatedDirectory.links.find((link) =>
      link.name === "example.nar"
    )!;
    assertEquals(updatedFile.size, updatedSize);
    assertEquals(
      (await manifest(updated, updatedFile.hash.toHex())).links.map((link) =>
        link.size
      ),
      [FILE_CHUNK_BYTES, 1],
    );
    await updated.dispose();
    await built.dispose();
    await writer.close();
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
      "a1180087f359125af504ab9bf443ebb5a77d1f9cb0a5f5694dbc1797f3546d21",
      "nhash1qqs2zxqqsle4jyj675z2hxl5g04mtfmar7wtpf04d9xmc9uh7d2x6ggdkgdax",
    ],
    [
      FILE_CHUNK_BYTES,
      "26099d59c52cd8963427d31e9116dc52711a4ee884c7b457296c71411d369fa2",
      "nhash1qqszvzvat8zjekykxsnax853zmw9yug6fm5gf3a52u5kcu2pr5mflgsa7rjfz",
    ],
    [
      FILE_CHUNK_BYTES + 1,
      "9a3e00917fd6f3ffabb59d2b7451b7eff7dc9652da5fee690f66a1bc277dcfae",
      "nhash1qqsf50sqj9ladull4w6e62m52xm7la7ujefd5hlwdy8kdgduya7ultsu35duw",
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
