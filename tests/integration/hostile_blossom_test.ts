import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { BlobFetcher, HashMismatch } from "../../src/blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { PinnedResponse } from "../../src/network/safe_fetcher.ts";
import {
  AddressPolicy,
  NetworkPolicyError,
  NetworkTimeoutError,
  PinnedTransport,
  SafeFetcher,
} from "../../src/network/safe_fetcher.ts";
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

Deno.test("local Blossom is first and corrupt local cache falls back without quarantine", async () => {
  const good = new TextEncoder().encode("remote verified bytes");
  const calls: string[] = [];
  const diagnostics: unknown[] = [];
  const quarantined: string[] = [];
  const fetcher = new BlobFetcher({
    fetcher: {
      fetch: (url: string | URL) => {
        calls.push(String(url));
        return Promise.resolve(response(calls.length === 1 ? new TextEncoder().encode("corrupt") : good));
      },
    },
    quarantine: {
      isQuarantined: () => false,
      quarantine: (origin) => quarantined.push(origin),
      releaseQuarantine: () => {},
    },
    spoolDirectory: await Deno.makeTempDir(),
    onLocalDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const plan = buildSourcePlan({
    localCache: "http://127.0.0.1:3000",
    configured: "https://preferred.example/base",
    event: ["https://publisher.example"],
  });
  assertEquals(plan.map((candidate) => candidate.role), [
    "local-cache",
    "publisher",
    "publisher",
  ]);
  const blob = await fetcher.fetch(hex(sha256(good)), plan, {
    maxAttempts: 3,
    maxTransferBytes: 100,
  });
  assertEquals(await new Response(blob.open()).text(), "remote verified bytes");
  assertEquals(calls.length, 2);
  assertEquals(quarantined, []);
  assertEquals(diagnostics, [{
    code: "local_hash_mismatch",
    origin: "http://127.0.0.1:3000",
    hash: hex(sha256(good)),
    retryable: true,
  }]);
  await blob.dispose();
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

const traversalLimits = (overrides: Record<string, number> = {}) => ({
  maxDepth: 5,
  maxLinks: 20,
  maxUniqueNodes: 10,
  maxDecodedBytes: 10000,
  maxAttempts: 10,
  maxRedirects: 3,
  maxConcurrent: 2,
  maxBlobTransferBytes: 4096,
  maxTransferredBytes: 10000,
  maxOutputBytes: 10000,
  deadline: Date.now() + 5000,
  ...overrides,
});

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
    new RequestBudget(traversalLimits()),
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
    new RequestBudget(traversalLimits()),
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
        new RequestBudget(traversalLimits()),
      ),
    VerifiedAbsent,
  );
  const budget = new RequestBudget(traversalLimits({
    maxDepth: 1,
    maxLinks: 1,
    maxUniqueNodes: 1,
    maxDecodedBytes: 1,
    maxAttempts: 1,
    maxRedirects: 1,
    maxConcurrent: 1,
  }));
  budget.debitLinks(1);
  assertThrows(() => budget.debitLinks(1));
});

Deno.test("ordered|transfer budget|output budget: nested file manifests preserve authenticated chunk order", async () => {
  const chunks = ["A", "B", "C", "D"].map((text) =>
    new TextEncoder().encode(text)
  );
  const child = manifest({
    l: chunks.slice(1, 3).map((bytes) => ({
      h: hashBytes(bytes),
      s: bytes.length,
      t: 0,
    })),
    t: 1,
  });
  const parent = manifest({
    l: [
      { h: hashBytes(chunks[0]), s: 1, t: 0 },
      { h: hashBytes(child), s: 2, t: 1 },
      { h: hashBytes(chunks[3]), s: 1, t: 0 },
    ],
    t: 1,
  });
  const root = manifest({
    l: [{ h: hashBytes(parent), n: "nested", s: 4, t: 1 }],
    t: 2,
  });
  const blobs = new Map(
    [root, parent, child, ...chunks].map((
      bytes,
    ) => [hex(hashBytes(bytes)), bytes]),
  );
  const resolver = new PathResolver(
    new BlobFetcher({
      fetcher: {
        fetch: (url: string | URL) => {
          const bytes = blobs.get(String(url).split("/").at(-1)!);
          return Promise.resolve(response(bytes!));
        },
      },
      quarantine: {
        isQuarantined: () => false,
        quarantine: () => {},
        releaseQuarantine: () => {},
      },
      spoolDirectory: await Deno.makeTempDir(),
    }),
    buildSourcePlan({ event: ["http://tree.test"] }),
    { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 },
  );
  const result = await resolver.resolve(
    hex(hashBytes(root)),
    "nested",
    "GET",
    new RequestBudget(traversalLimits()),
  );
  assertEquals(await new Response(result.body).text(), "ABCD");
});

Deno.test("ordered|transfer budget|output budget: policy bounds declarations and actual retry bytes", async () => {
  const content = new TextEncoder().encode("12345");
  const contentHash = hashBytes(content);
  const oversizedRoot = manifest({
    l: [{ h: contentHash, n: "raw", s: 101, t: 0 }],
    t: 2,
  });
  let rawFetches = 0;
  const blobs = new Map([[hex(hashBytes(oversizedRoot)), oversizedRoot], [
    hex(contentHash),
    content,
  ]]);
  const resolver = new PathResolver(
    new BlobFetcher({
      fetcher: {
        fetch: (url: string | URL) => {
          const hash = String(url).split("/").at(-1)!;
          if (hash === hex(contentHash)) rawFetches++;
          return Promise.resolve(response(blobs.get(hash)!));
        },
      },
      quarantine: {
        isQuarantined: () => false,
        quarantine: () => {},
        releaseQuarantine: () => {},
      },
      spoolDirectory: await Deno.makeTempDir(),
    }),
    buildSourcePlan({ event: ["http://tree.test"] }),
    { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 },
  );
  await assertRejects(
    () =>
      resolver.resolve(
        hex(hashBytes(oversizedRoot)),
        "raw",
        "GET",
        new RequestBudget(traversalLimits({ maxBlobTransferBytes: 100 })),
      ),
    Error,
    "per-blob",
  );
  assertEquals(rawFetches, 0);

  const budget = new RequestBudget(traversalLimits({
    maxBlobTransferBytes: 100,
    maxTransferredBytes: oversizedRoot.length + 4,
  }));
  const exactRoot = manifest({
    l: [{ h: contentHash, n: "raw", s: 5, t: 0 }],
    t: 2,
  });
  blobs.set(hex(hashBytes(exactRoot)), exactRoot);
  await assertRejects(
    async () => {
      const result = await resolver.resolve(
        hex(hashBytes(exactRoot)),
        "raw",
        "GET",
        budget,
      );
      await new Response(result.body).bytes();
    },
    Error,
  );
});

Deno.test("ordered|transfer budget|output budget: exact output succeeds and one byte over is rejected", () => {
  const exact = new RequestBudget(traversalLimits({ maxOutputBytes: 4 }));
  exact.ensureOutputAvailable(4);
  exact.debitOutput(4);
  assertThrows(
    () => exact.debitOutput(1),
    Error,
    "output budget exceeded",
  );
  const over = new RequestBudget(traversalLimits({ maxOutputBytes: 3 }));
  assertThrows(() => over.ensureOutputAvailable(4), Error, "output budget");
  assertStringIncludes(String(over.remainingOutputBytes), "3");
});

async function withRawResponse<T>(
  parts: readonly (string | { delay: number })[],
  run: (port: number) => Promise<T>,
): Promise<T> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const serve = (async () => {
    using conn = await listener.accept();
    await conn.read(new Uint8Array(4096));
    for (const part of parts) {
      if (typeof part === "string") {
        await conn.write(new TextEncoder().encode(part));
      } else await new Promise((resolve) => setTimeout(resolve, part.delay));
    }
  })();
  try {
    return await run((listener.addr as Deno.NetAddr).port);
  } finally {
    listener.close();
    await serve.catch(() => {});
  }
}

Deno.test("deadline|chunked|cancel: total and idle deadlines govern body through EOF", async () => {
  await withRawResponse([
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\no",
    { delay: 100 },
    "k",
  ], async (port) => {
    const fetcher = new SafeFetcher(
      new AddressPolicy(
        () => Promise.resolve(["127.0.0.1"]),
        `http://stall.test:${port}`,
      ),
      new PinnedTransport(),
      {
        maxRedirects: 0,
        connectTimeoutMs: 50,
        idleTimeoutMs: 25,
        totalTimeoutMs: 70,
      },
    );
    const response = await fetcher.fetch(
      `http://stall.test:${port}/`,
      "configured",
    );
    await assertRejects(() => response.text(), NetworkTimeoutError);
  });
});

Deno.test("deadline|chunked|cancel: split chunk framing is decoded before spooling", async () => {
  const payload = new TextEncoder().encode("Wikipedia");
  await withRawResponse([
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r",
    "\nWiki\r\n5\r\npedia\r\n0\r\nX-Test: ok\r\n\r\n",
  ], async (port) => {
    const fetcher = new SafeFetcher(
      new AddressPolicy(
        () => Promise.resolve(["127.0.0.1"]),
        `http://chunks.test:${port}`,
      ),
      new PinnedTransport(),
      {
        maxRedirects: 0,
        connectTimeoutMs: 100,
        idleTimeoutMs: 100,
        totalTimeoutMs: 1000,
      },
    );
    const spool = await Deno.makeTempDir();
    const blobs = new BlobFetcher({
      fetcher,
      quarantine: {
        isQuarantined: () => false,
        quarantine: () => {},
        releaseQuarantine: () => {},
      },
      spoolDirectory: spool,
    });
    const blob = await blobs.fetch(
      hex(sha256(payload)),
      buildSourcePlan({ configured: `http://chunks.test:${port}` }),
      { maxAttempts: 1, maxTransferBytes: 100 },
    );
    assertEquals(await new Response(blob.open()).text(), "Wikipedia");
    await blob.dispose();
  });
});

Deno.test("deadline|chunked|cancel: ambiguous and malformed framing fails closed", async () => {
  const cases = [
    "Content-Length: 1\r\nContent-Length: 1\r\n\r\nx",
    "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    "Transfer-Encoding: gzip\r\n\r\nx",
    "Transfer-Encoding: chunked\r\n\r\nZ\r\nx\r\n0\r\n\r\n",
    "Transfer-Encoding: chunked\r\n\r\n1\r\nxX\n0\r\n\r\n",
  ];
  for (const framing of cases) {
    await withRawResponse([`HTTP/1.1 200 OK\r\n${framing}`], async (port) => {
      const response = await new PinnedTransport().fetch({
        url: new URL(`http://x.test:${port}/`),
        hostname: "x.test",
        address: "127.0.0.1",
        port,
      }, { signal: AbortSignal.timeout(1000), idleTimeoutMs: 100 });
      await assertRejects(() => response.text(), NetworkPolicyError);
    }).catch((error) => {
      if (!(error instanceof NetworkPolicyError)) throw error;
    });
  }
});

Deno.test("deadline|chunked|cancel: exceptional spool cancels reader and removes partial file", async () => {
  const dir = await Deno.makeTempDir();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = new BlobFetcher({
    fetcher: {
      fetch: () =>
        Promise.resolve({
          status: 200,
          headers: new Headers(),
          body,
          peerAddress: "127.0.0.1",
          text: () => Promise.resolve(""),
          cancel: (reason) => body.cancel(reason),
        }),
    },
    quarantine: {
      isQuarantined: () => false,
      quarantine: () => {},
      releaseQuarantine: () => {},
    },
    spoolDirectory: dir,
  });
  await assertRejects(() =>
    fetcher.fetch(
      "00".repeat(32),
      buildSourcePlan({ event: ["http://x.test"] }),
      { maxAttempts: 1, maxTransferBytes: 10 },
    )
  );
  assertEquals(cancelled, true);
  assertEquals([...Deno.readDirSync(dir)].length, 0);
});
