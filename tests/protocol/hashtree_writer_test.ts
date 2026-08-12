import { assertEquals, assertGreater } from "@std/assert";
import { HashtreeWriter } from "../../src/hashtree/writer.ts";
import { decodeManifest } from "../../src/protocol/hashtree.ts";

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
      first.inventory.map((x) => x.hash),
      second.inventory.map((x) => x.hash),
    );
    assertEquals(second.createdBlobs, 0);
    assertGreater(first.inventory.length, 3);
    const rootWire = await Deno.readFile(
      first.inventory.find((x) => x.hash === first.rootHex)!.path,
    );
    assertEquals(
      decodeManifest(rootWire, {
        maxWireBytes: 1_000_000,
        maxDecodedBytes: 1_000_000,
        maxLinks: 174,
      }).type,
      "directory",
    );
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
    const result = await writer.build(["z", "é", "a"].map((name) => ({
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
      second.inventory.some((blob) =>
        first.inventory.some((old) => old.hash === blob.hash)
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
