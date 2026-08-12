import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { BlobFetcher, HashMismatch } from "../../src/blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { PinnedResponse } from "../../src/network/safe_fetcher.ts";
import { encode } from "@msgpack/msgpack";
import {
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../../src/hashtree/reader.ts";

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
      fetch: (url: string | URL) => {
        calls.push(String(url));
        return Promise.resolve(
          calls.length === 1
            ? response(new Uint8Array(), 404)
            : response(bytes),
        );
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

const manifest = (value: unknown) => encode(value);
const hashBytes = (bytes: Uint8Array) => sha256(bytes);

Deno.test("traversal|backpressure|HEAD: lazy lookup ignores unrelated missing branches", async () => {
  const content = new TextEncoder().encode("hello");
  const contentHash = hashBytes(content);
  const root = manifest({
    l: [
      { h: contentHash, n: "wanted", s: content.length, t: 0 },
      { h: new Uint8Array(32).fill(9), n: "zzz", s: 0, t: 2 },
    ],
    t: 2,
  });
  const blobs = new Map([[hex(hashBytes(root)), root], [
    hex(contentHash),
    content,
  ]]);
  const calls: string[] = [];
  const spool = await Deno.makeTempDir();
  const blobFetcher = new BlobFetcher({
    fetcher: {
      fetch: (url: string | URL) => {
        const h = String(url).split("/").at(-1)!;
        calls.push(h);
        const b = blobs.get(h);
        return Promise.resolve(
          b ? response(b) : response(new Uint8Array(), 404),
        );
      },
    },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => {},
      releaseQuarantine: () => {},
    },
    spoolDirectory: spool,
  });
  const resolver = new PathResolver(
    blobFetcher,
    buildSourcePlan({ event: ["http://tree.test"] }),
    { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 },
  );
  const result = await resolver.resolve(
    hex(hashBytes(root)),
    "wanted",
    "GET",
    new RequestBudget({
      maxDepth: 5,
      maxLinks: 20,
      maxUniqueNodes: 10,
      maxDecodedBytes: 10000,
      maxAttempts: 10,
      maxRedirects: 3,
      maxConcurrent: 2,
      deadline: Date.now() + 5000,
    }),
  );
  assertEquals(await new Response(result.body).text(), "hello");
  assertEquals(calls.length, 2);
});

Deno.test("traversal|backpressure|HEAD: authenticates final link without fetching content", async () => {
  const content = new TextEncoder().encode("not fetched");
  const root = manifest({
    l: [{ h: hashBytes(content), n: "file", s: content.length, t: 0 }],
    t: 2,
  });
  let calls = 0;
  const blobFetcher = new BlobFetcher({
    fetcher: {
      fetch: () => {
        calls++;
        return Promise.resolve(response(root));
      },
    },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => {},
      releaseQuarantine: () => {},
    },
    spoolDirectory: await Deno.makeTempDir(),
  });
  const resolver = new PathResolver(
    blobFetcher,
    buildSourcePlan({ event: ["http://tree.test"] }),
    { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 },
  );
  const result = await resolver.resolve(
    hex(hashBytes(root)),
    "file",
    "HEAD",
    new RequestBudget({
      maxDepth: 5,
      maxLinks: 20,
      maxUniqueNodes: 10,
      maxDecodedBytes: 10000,
      maxAttempts: 10,
      maxRedirects: 3,
      maxConcurrent: 2,
      deadline: Date.now() + 5000,
    }),
  );
  assertEquals(result.size, content.length);
  assertEquals(calls, 1);
});

Deno.test("traversal|backpressure|HEAD: absence and budget overflow remain typed", async () => {
  const root = manifest({ l: [], t: 2 });
  const blobFetcher = new BlobFetcher({
    fetcher: { fetch: () => Promise.resolve(response(root)) },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => {},
      releaseQuarantine: () => {},
    },
    spoolDirectory: await Deno.makeTempDir(),
  });
  const resolver = new PathResolver(
    blobFetcher,
    buildSourcePlan({ event: ["http://tree.test"] }),
    { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 },
  );
  await assertRejects(
    () =>
      resolver.resolve(
        hex(hashBytes(root)),
        "missing",
        "HEAD",
        new RequestBudget({
          maxDepth: 5,
          maxLinks: 20,
          maxUniqueNodes: 10,
          maxDecodedBytes: 10000,
          maxAttempts: 10,
          maxRedirects: 3,
          maxConcurrent: 2,
          deadline: Date.now() + 5000,
        }),
      ),
    VerifiedAbsent,
  );
  const budget = new RequestBudget({
    maxDepth: 1,
    maxLinks: 1,
    maxUniqueNodes: 1,
    maxDecodedBytes: 1,
    maxAttempts: 1,
    maxRedirects: 1,
    maxConcurrent: 1,
    deadline: Date.now() + 5000,
  });
  budget.debitLinks(1);
  assertThrows(() => budget.debitLinks(1));
});
