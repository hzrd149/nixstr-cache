import { assert, assertEquals } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicationUploader } from "../../src/blossom/publication_uploader.ts";
import { createControlledBlossomFixture } from "../fixtures/publication.ts";

Deno.test("hostile Blossom responses cannot establish false possession", async () => {
  const root = await Deno.makeTempDir({ prefix: "hostile-publication-" });
  const bytes = new TextEncoder().encode("immutable candidate");
  const path = `${root}/blob`;
  await Deno.writeFile(path, bytes);
  const hash = sha256(bytes).toHex();
  const fixture = await createControlledBlossomFixture();
  const uploader = new PublicationUploader({ request: fixture.request });
  try {
    for (const mode of ["descriptor-hash", "descriptor-size", "truncated-proof", "false-possession"] as const) {
      fixture.control.mode = mode;
      assertEquals(await uploader.prove(fixture.url, { hash, size: bytes.length, path }), false, mode);
    }
    fixture.control.mode = "ok";
    assertEquals(await uploader.prove(fixture.url, { hash, size: bytes.length, path }), true);
  } finally {
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("publication uploads retain backpressure and bounded concurrent readers", async () => {
  const root = await Deno.makeTempDir({ prefix: "bounded-publication-" });
  const fixture = await createControlledBlossomFixture({ throttleMs: 2 });
  const uploader = new PublicationUploader({ request: fixture.request });
  try {
    const entries = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const bytes = new Uint8Array(128 * 1024).fill(index);
      const path = `${root}/${index}`;
      await Deno.writeFile(path, bytes);
      return { hash: sha256(bytes).toHex(), size: bytes.length, path };
    }));
    const ceiling = 2;
    for (let offset = 0; offset < entries.length; offset += ceiling) {
      assert((await Promise.all(entries.slice(offset, offset + ceiling).map((entry) => uploader.prove(fixture.url, entry)))).every(Boolean));
    }
    assert(fixture.facts.maxActiveUploads <= ceiling);
    assert(fixture.facts.uploadChunks > entries.length, "fixture must observe streamed chunks");
  } finally {
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
});
