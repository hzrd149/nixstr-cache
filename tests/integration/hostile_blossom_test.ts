import { assertEquals, assertRejects } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { BlobFetcher, HashMismatch } from "../../src/blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { PinnedResponse } from "../../src/network/safe_fetcher.ts";

const hex = (bytes: Uint8Array) => bytes.toHex();
const response = (body: Uint8Array, status = 200): PinnedResponse => ({
  status,
  headers: new Headers({ "content-length": String(body.length) }),
  body: new Response(body.slice()).body!,
  peerAddress: "127.0.0.1",
  text: () => Promise.resolve(new TextDecoder().decode(body)),
  cancel: (reason?: unknown) => new Response(body.slice()).body!.cancel(reason),
});

Deno.test("source plan|verified spool|quarantine: preserves configured, event, BUD-03 order and canonical dedup", () => {
  const plan = buildSourcePlan({
    configured: "https://cache.test/prefix/",
    event: ["https://ONE.test/", "bad", "https://cache.test/prefix"],
    bud03: ["https://one.test", "https://two.test/base/"],
    isQuarantined: (origin) => origin === "https://one.test",
  });
  assertEquals(plan.map((x) => [x.baseUrl, x.trust]), [
    ["https://cache.test/prefix", "configured"],
    ["https://two.test/base", "publisher"],
  ]);
});

Deno.test("source plan|verified spool|quarantine: falls back and exposes bytes only after hash verification", async () => {
  const bytes = new TextEncoder().encode("verified bytes");
  const calls: string[] = [];
  const fetcher = new BlobFetcher({
    fetcher: {
      fetch: async (url: string | URL) => {
        calls.push(String(url));
        return calls.length === 1
          ? response(new Uint8Array(), 404)
          : response(bytes);
      },
    },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => {},
      releaseQuarantine: () => {},
    },
    spoolDirectory: await Deno.makeTempDir(),
  });
  const blob = await fetcher.fetch(
    hex(sha256(bytes)),
    buildSourcePlan({ event: ["http://a.test", "http://b.test"] }),
    { maxAttempts: 2, maxTransferBytes: 100 },
  );
  assertEquals(await new Response(blob.open()).text(), "verified bytes");
  assertEquals(calls.length, 2);
  await blob.dispose();
});

Deno.test("source plan|verified spool|quarantine: hash mismatch persists across restart and can be released", async () => {
  const dir = await Deno.makeTempDir();
  const db = `${dir}/state.db`;
  let repository = new StateRepository(db);
  const fetcher = new BlobFetcher({
    fetcher: {
      fetch: () => Promise.resolve(response(new TextEncoder().encode("bad"))),
    },
    quarantine: repository,
    spoolDirectory: dir,
  });
  await assertRejects(
    () =>
      fetcher.fetch(
        "00".repeat(32),
        buildSourcePlan({ event: ["http://bad.test"] }),
        { maxAttempts: 1, maxTransferBytes: 10 },
      ),
    HashMismatch,
  );
  repository.close();
  repository = new StateRepository(db);
  assertEquals(repository.isQuarantined("http://bad.test"), true);
  repository.releaseQuarantine("http://bad.test");
  assertEquals(repository.isQuarantined("http://bad.test"), false);
  repository.close();
});

Deno.test("source plan|verified spool|quarantine: oversize removes partial spools without quarantine", async () => {
  const dir = await Deno.makeTempDir();
  let quarantined = 0;
  const fetcher = new BlobFetcher({
    fetcher: { fetch: () => Promise.resolve(response(new Uint8Array(20))) },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => quarantined++,
      releaseQuarantine: () => {},
    },
    spoolDirectory: dir,
  });
  await assertRejects(() =>
    fetcher.fetch(
      "00".repeat(32),
      buildSourcePlan({ event: ["http://large.test"] }),
      { maxAttempts: 1, maxTransferBytes: 10 },
    )
  );
  assertEquals(quarantined, 0);
  assertEquals([...Deno.readDirSync(dir)].length, 0);
});
