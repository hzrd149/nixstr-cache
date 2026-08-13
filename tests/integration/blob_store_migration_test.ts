import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { BlobStore } from "../../src/persistence/blob_store.ts";

Deno.test("legacy migration rehashes routes, is idempotent, and quarantines unknown spool files", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-blob-migrate-" });
  try {
    const staging = `${root}/legacy-staging`;
    const spool = `${root}/legacy-spool`;
    await Deno.mkdir(staging, { recursive: true });
    await Deno.mkdir(spool, { recursive: true });
    const legacy = `${staging}/body`;
    await Deno.writeTextFile(legacy, "legacy body");
    await Deno.writeTextFile(`${spool}/.nixstr-spool-dead`, "partial");
    await Deno.writeTextFile(`${spool}/operator-note`, "keep me");
    const database = `${root}/state.sqlite`;
    const db = new DatabaseSync(database);
    db.exec("CREATE TABLE staged_blobs(route TEXT PRIMARY KEY,digest TEXT NOT NULL,size INTEGER NOT NULL,path TEXT NOT NULL)");
    db.prepare("INSERT INTO staged_blobs VALUES(?,?,?,?)").run(
      "nix-cache-info",
      "legacy",
      11,
      legacy,
    );
    db.close();

    const store = new BlobStore(database, `${root}/store`, { capacityBytes: 1024 });
    const first = await store.migrateLegacy({ stagingDirectory: staging, spoolDirectory: spool });
    const second = await store.migrateLegacy({ stagingDirectory: staging, spoolDirectory: spool });
    assertEquals(first.routesMigrated, 1);
    assertEquals(second.routesMigrated, 0);
    assertEquals(store.routeComponents("nix-cache-info").length, 1);
    assertEquals(await exists(`${spool}/.nixstr-spool-dead`), false);
    assertEquals(await exists(`${spool}/operator-note`), false);
    assertEquals(first.quarantined, 1);
    store.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
