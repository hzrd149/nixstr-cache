import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { createSignerCapability } from "../../src/signer/capability.ts";
import {
  WriteConflict,
  WriteIdentityMismatch,
  WriteRepository as BaseWriteRepository,
} from "../../src/persistence/write_repository.ts";
class WriteRepository extends BaseWriteRepository {
  constructor(...args: ConstructorParameters<typeof BaseWriteRepository>) {
    super(...args);
    this.bindIdentity(this.boundIdentity() ?? `17091:${"f".repeat(64)}:`);
  }
}
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import { EligibilityModel } from "../../src/write/eligibility.ts";
import { SignerOverlay } from "../../src/write/overlay.ts";
import { parseNarInfo } from "../../src/protocol/narinfo.ts";

const chunks = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(new TextEncoder().encode(part));
      }
      controller.close();
    },
  });

Deno.test("durable writable owner binds once and rejects relabeling", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-owner-" });
  try {
    const db = `${root}/write.sqlite`;
    const owner = `17091:${"a".repeat(64)}:`;
    let repository = new BaseWriteRepository(db, `${root}/spool`, {
      perBodyBytes: 32,
      aggregateBytes: 64,
    });
    repository.bindIdentity(owner);
    assertEquals(repository.boundIdentity(), owner);
    repository.close();
    repository = new BaseWriteRepository(db, `${root}/spool`, {
      perBodyBytes: 32,
      aggregateBytes: 64,
    });
    repository.bindIdentity(owner);
    assertThrows(
      () => repository.bindIdentity(`17091:${"b".repeat(64)}:`),
      WriteIdentityMismatch,
    );
    assertEquals(repository.boundIdentity(), owner);
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("identity mismatch does not recover database or touch staging", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-owner-recovery-" });
  try {
    const db = `${root}/write.sqlite`;
    const spool = `${root}/spool`;
    const owner = `17091:${"a".repeat(64)}:`;
    let repository = new BaseWriteRepository(db, spool, {
      perBodyBytes: 32,
      aggregateBytes: 64,
    });
    repository.bindIdentity(owner);
    repository.close();
    await Deno.writeTextFile(`${spool}/tmp/sentinel`, "keep");
    repository = new BaseWriteRepository(db, spool, {
      perBodyBytes: 32,
      aggregateBytes: 64,
    });
    assertThrows(
      () => repository.bindIdentity(`17091:${"b".repeat(64)}:`),
      WriteIdentityMismatch,
    );
    assertEquals(await Deno.readTextFile(`${spool}/tmp/sentinel`), "keep");
    assertEquals(repository.boundIdentity(), owner);
    for (
      const invalid of [
        `17091:${"a".repeat(64)}:named`,
        `37091:${"a".repeat(64)}:`,
        `37091:${"a".repeat(64)}:bad name`,
      ]
    ) assertThrows(() => repository.bindIdentity(invalid), TypeError);
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("owned signer streams one NAR into durable staging", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-" });
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const keyPath = `${root}/key`;
  await Deno.writeFile(keyPath, secret, { mode: 0o600 });
  const states: unknown[] = [];
  const capability = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, identifier: "" },
      signerPath: keyPath,
    },
  });
  const subscription = capability.state.subscribe((state) =>
    states.push(state)
  );
  await capability.start();
  assertEquals(capability.current(), { status: "ready", pubkey });
  assertEquals(states.map((state) => (state as { status: string }).status), [
    "disconnected",
    "connecting",
    "ready",
  ]);

  const db = `${root}/write.sqlite`;
  const spool = `${root}/spool`;
  let repository = new WriteRepository(db, spool, {
    perBodyBytes: 32,
    aggregateBytes: 64,
  });
  const staged = await repository.stage(
    "nar/example.nar",
    chunks(["hello", " world"]),
  );
  assertEquals(staged.size, 11);
  repository.close();
  repository = new WriteRepository(db, spool, {
    perBodyBytes: 32,
    aggregateBytes: 64,
  });
  assertEquals(
    await Deno.readTextFile(repository.lookup("nar/example.nar")!.path),
    "hello world",
  );
  const retry = await repository.stage(
    "nar/example.nar",
    chunks(["hello world"]),
  );
  assert(retry.idempotent);
  await assertRejects(
    () => repository.stage("nar/example.nar", chunks(["different"])),
    WriteConflict,
  );
  assertEquals(
    await Deno.readTextFile(repository.lookup("nar/example.nar")!.path),
    "hello world",
  );
  repository.close();
  await capability.close();
  subscription.unsubscribe();
  await Deno.remove(root, { recursive: true });
});

Deno.test("NAR staging records canonical content-addressed route components", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-components-" });
  try {
    const repository = new WriteRepository(
      `${root}/write.sqlite`,
      `${root}/spool`,
      { perBodyBytes: 3_000_000, aggregateBytes: 6_000_000 },
    );
    const store = repository.openBlobStore(`${root}/store`, {
      capacityBytes: 6_000_000,
    });
    const body = new Uint8Array(2_097_153).fill(7);
    const staged = await repository.stage(
      "nar/chunked.nar",
      new Blob([body]).stream(),
    );
    assertEquals(staged.size, body.length);
    assertEquals(store.routeComponents("nar/chunked.nar").map((x) => x.size), [
      2_097_152,
      1,
    ]);
    assertEquals(store.inventory().filter((x) => x.origin === "write").length, 2);
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("mismatched signer and failed staging fail closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-fail-" });
  const secret = generateSecretKey();
  const keyPath = `${root}/key`;
  await Deno.writeFile(keyPath, secret, { mode: 0o600 });
  const capability = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, identifier: "" },
      signerPath: keyPath,
    },
  });
  await capability.start();
  assertEquals(capability.current().status, "ready");
  const repository = new WriteRepository(
    `${root}/write.sqlite`,
    `${root}/spool`,
    { perBodyBytes: 3, aggregateBytes: 4 },
  );
  await assertRejects(
    () => repository.stage("nar/too-large.nar", chunks(["four"])),
    RangeError,
  );
  assertEquals(repository.lookup("nar/too-large.nar"), undefined);
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("PUT is fail closed and stock routes are immutable", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-put-" });
  const repository = new WriteRepository(
    `${root}/write.sqlite`,
    `${root}/spool`,
    {
      perBodyBytes: 4096,
      aggregateBytes: 8192,
    },
  );
  let ready = false;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 2048,
    selection: { current: () => [] },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
    write: { current: () => ({ ready, repository }) },
  });
  const hash = "0".repeat(32);
  const narinfo =
    `StorePath: /nix/store/${hash}-hello\nURL: nar/example.nar\nCompression: none\nFileHash: sha256:0\nFileSize: 5\nNarHash: sha256:0\nNarSize: 5\nReferences: \n`;
  let response = await handler(
    new Request(`http://cache/${hash}.narinfo`, {
      method: "PUT",
      body: narinfo,
    }),
  );
  assertEquals(response.status, 405);
  assertEquals(response.headers.get("allow"), "GET, HEAD");
  ready = true;
  response = await handler(
    new Request(
      "http://cache/nar/example.nar",
      {
        method: "PUT",
        body: chunks(["he", "llo"]),
        duplex: "half",
      } as RequestInit,
    ),
  );
  assertEquals(response.status, 200);
  response = await handler(
    new Request(`http://cache/${hash}.narinfo`, {
      method: "PUT",
      body: narinfo,
    }),
  );
  assertEquals(response.status, 200);
  response = await handler(
    new Request("http://cache/nar/example.nar", {
      method: "PUT",
      body: "other",
    }),
  );
  assertEquals(response.status, 409);
  for (
    const url of [
      "http://cache/nar/%2fetc",
      "http://cache/unknown",
      `http://cache/${hash}.narinfo?x=1`,
    ]
  ) {
    response = await handler(new Request(url, { method: "PUT", body: "x" }));
    assertEquals(response.status, 404);
  }
  response = await handler(
    new Request("http://cache/nar/encoded.nar", {
      method: "PUT",
      body: "x",
      headers: { "content-encoding": "gzip" },
    }),
  );
  assertEquals(response.status, 415);
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("PUT reauthorizes before staging the request body", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-put-auth-" });
  const repository = new WriteRepository(
    `${root}/write.sqlite`,
    `${root}/spool`,
    { perBodyBytes: 4096, aggregateBytes: 8192 },
  );
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 2048,
    selection: { current: () => [] },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
    write: {
      current: () => ({
        ready: true,
        repository,
        authorize: () => Promise.reject(new Error("identity changed")),
      }),
    },
  });

  const response = await handler(
    new Request("http://cache/nar/rejected.nar", {
      method: "PUT",
      body: chunks(["must", "not", "stage"]),
      duplex: "half",
    } as RequestInit),
  );

  assertEquals(response.status, 405);
  assertEquals(repository.lookup("nar/rejected.nar"), undefined);
  handler.close();
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("complete object commits to signer-first immutable overlay", async () => {
  const root = await Deno.makeTempDir();
  const repository = new WriteRepository(`${root}/write.db`, `${root}/spool`, {
    perBodyBytes: 4096,
    aggregateBytes: 32768,
  });
  const storeHash = "0123456789abcdfghijklmnpqrsvwxyz";
  const narinfo = [
    `StorePath: /nix/store/${storeHash}-demo`,
    "URL: nar/signer.nar",
    "Compression: none",
    "FileHash: sha256:abc",
    "FileSize: 6",
    "NarHash: sha256:abc",
    "NarSize: 6",
    "References: lowerlowerlowerlowerlowerlower12-base",
    "",
  ].join("\n");
  await repository.stage(`${storeHash}.narinfo`, new Blob([narinfo]).stream());
  repository.recordNarInfo(`${storeHash}.narinfo`, parseNarInfo(narinfo));
  const overlay = new SignerOverlay(repository);
  const eligibility = new EligibilityModel(repository, overlay, {
    maxVisited: 64,
    maxMetadataBytes: 8192,
    lowerHasStorePath: (path) => path.includes("lowerlower"),
  });
  assertEquals(await eligibility.changed(storeHash), false);
  await repository.stage("nar/signer.nar", new Blob(["signer"]).stream());
  assertEquals(await eligibility.changed("nar/signer.nar"), true);
  const captured = overlay.current();
  assertEquals(captured.generation, 1);
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => [] },
    overlay,
    resolverFor: () => {
      throw new Error("publisher must not be consulted");
    },
  });
  assertEquals(
    await (await handler(new Request(`http://cache/${storeHash}.narinfo`)))
      .text(),
    narinfo,
  );
  const response = await handler(new Request("http://cache/nar/signer.nar"));
  assertEquals(await response.text(), "signer");
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("self-referential Nix narinfo commits to the writable overlay", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      { perBodyBytes: 4096, aggregateBytes: 32768 },
    );
    const storeHash = "h5yzhyi8j6iq4r26giryd0rh9ynsayan";
    const narinfo = [
      `StorePath: /nix/store/${storeHash}-libunistring-1.4.2`,
      "URL: nar/self.nar",
      "Compression: none",
      "FileHash: sha256:abc",
      "FileSize: 4",
      "NarHash: sha256:abc",
      "NarSize: 4",
      `References: ${storeHash}-libunistring-1.4.2`,
      "",
    ].join("\n");
    const overlay = new SignerOverlay(repository);
    const eligibility = new EligibilityModel(repository, overlay, {
      maxVisited: 8,
      maxMetadataBytes: 8192,
      lowerHasStorePath: () => false,
    });
    const handler = createNixHttpHandler({
      decodedMetadataBytes: 4096,
      selection: { current: () => [] },
      overlay,
      resolverFor: () => {
        throw new Error("publisher must not be consulted");
      },
      write: {
        current: () => ({
          ready: true,
          repository,
          onStaged: (route) => eligibility.changed(route),
        }),
      },
    });

    for (
      const [route, body] of [
        ["nar/self.nar", "self"],
        [`${storeHash}.narinfo`, narinfo],
      ]
    ) {
      assertEquals(
        (await handler(
          new Request(`http://cache/${route}`, {
            method: "PUT",
            body: new Blob([body]).stream(),
            duplex: "half",
          } as RequestInit),
        )).status,
        200,
      );
    }
    assertEquals(overlay.current().storePaths, new Set([storeHash]));
    assertEquals(
      (await handler(new Request(`http://cache/${storeHash}.narinfo`))).status,
      200,
    );
    handler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("idempotent narinfo PUT repairs a missing metadata index", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      { perBodyBytes: 4096, aggregateBytes: 32768 },
    );
    const storeHash = "0123456789abcdfghijklmnpqrsvwxyz";
    const narinfo = [
      `StorePath: /nix/store/${storeHash}-demo`,
      "URL: nar/recovered.nar",
      "Compression: none",
      "FileHash: sha256:abc",
      "FileSize: 9",
      "NarHash: sha256:abc",
      "NarSize: 9",
      "References: ",
      "",
    ].join("\n");

    // Reproduce an interrupted prior admission: durable bytes exist, but the
    // semantic narinfo index was never recorded.
    await repository.stage(
      `${storeHash}.narinfo`,
      new Blob([narinfo]).stream(),
    );
    assertEquals(repository.stagedCandidateHashes(8), []);

    const overlay = new SignerOverlay(repository);
    const eligibility = new EligibilityModel(repository, overlay, {
      maxVisited: 8,
      maxMetadataBytes: 8192,
      lowerHasStorePath: () => false,
    });
    const handler = createNixHttpHandler({
      decodedMetadataBytes: 4096,
      selection: { current: () => [] },
      overlay,
      resolverFor: () => {
        throw new Error("publisher must not be consulted");
      },
      write: {
        current: () => ({
          ready: true,
          repository,
          onStaged: (route) => eligibility.changed(route),
        }),
      },
    });

    assertEquals(
      (await handler(
        new Request(`http://cache/${storeHash}.narinfo`, {
          method: "PUT",
          body: new Blob([narinfo]).stream(),
          duplex: "half",
        } as RequestInit),
      )).status,
      200,
    );
    assertEquals(
      (await handler(
        new Request("http://cache/nar/recovered.nar", {
          method: "PUT",
          body: new Blob(["recovered"]).stream(),
          duplex: "half",
        } as RequestInit),
      )).status,
      200,
    );
    assertEquals(
      (await handler(new Request(`http://cache/${storeHash}.narinfo`))).status,
      200,
    );
    handler.close();
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("reverse dependencies cycles restart and concurrent generations remain closed", async () => {
  const root = await Deno.makeTempDir();
  const db = `${root}/write.db`;
  const spool = `${root}/spool`;
  let repository = new WriteRepository(db, spool, {
    perBodyBytes: 4096,
    aggregateBytes: 65536,
  });
  const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const make = (hash: string, url: string, references: string[]) =>
    [
      `StorePath: /nix/store/${hash}-item`,
      `URL: ${url}`,
      "Compression: none",
      "FileHash: sha256:abc",
      "FileSize: 1",
      "NarHash: sha256:abc",
      "NarSize: 1",
      `References: ${references.map((value) => `${value}-item`).join(" ")}`,
      "",
    ].join("\n");
  for (
    const [hash, url, refs] of [[a, "nar/a.nar", [b]], [b, "nar/b.nar", [
      a,
    ]]] as const
  ) {
    const raw = make(hash, url, [...refs]);
    await repository.stage(`${hash}.narinfo`, new Blob([raw]).stream());
    repository.recordNarInfo(`${hash}.narinfo`, parseNarInfo(raw));
    await repository.stage(url, new Blob([hash[0]]).stream());
  }
  let anchored = false;
  let overlay = new SignerOverlay(repository);
  let eligibility = new EligibilityModel(repository, overlay, {
    maxVisited: 8,
    maxMetadataBytes: 8192,
    lowerHasStorePath: (hash) => anchored && hash === a,
  });
  assertEquals(await eligibility.changed(b), false);
  assertEquals(overlay.current().generation, 0);
  anchored = true;
  assertEquals(await eligibility.changed(a), true);
  assertEquals(overlay.current().storePaths, new Set([a, b]));
  const generationOne = overlay.current();
  repository.close();
  repository = new WriteRepository(db, spool, {
    perBodyBytes: 4096,
    aggregateBytes: 65536,
  });
  overlay = new SignerOverlay(repository);
  assertEquals(overlay.current().generation, 1);
  assertEquals(overlay.current().entries.size, 4);
  const c = "cccccccccccccccccccccccccccccccc";
  const raw = make(c, "nar/c.nar", []);
  eligibility = new EligibilityModel(repository, overlay, {
    maxVisited: 8,
    maxMetadataBytes: 8192,
    lowerHasStorePath: () => false,
  });
  const subscription = eligibility.start();
  await repository.stage(`${c}.narinfo`, new Blob([raw]).stream());
  repository.recordNarInfo(`${c}.narinfo`, parseNarInfo(raw));
  await repository.stage("nar/c.nar", new Blob(["c"]).stream());
  await eligibility.idle();
  assertEquals(overlay.current().generation, 2);
  assertEquals(generationOne.entries.has("nar/c.nar"), false);
  subscription.unsubscribe();
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("restart reconciliation admits complete staged content without a later write", async () => {
  const root = await Deno.makeTempDir();
  const db = `${root}/write.db`, spool = `${root}/spool`;
  const hash = "dddddddddddddddddddddddddddddddd";
  const raw = [
    `StorePath: /nix/store/${hash}-restart`,
    "URL: nar/restart.nar",
    "Compression: none",
    "FileHash: sha256:abc",
    "FileSize: 1",
    "NarHash: sha256:abc",
    "NarSize: 1",
    "References: ",
    "",
  ].join("\n");
  let repository = new WriteRepository(db, spool, {
    perBodyBytes: 4096,
    aggregateBytes: 65536,
  });
  await repository.stage(`${hash}.narinfo`, new Blob([raw]).stream());
  repository.recordNarInfo(`${hash}.narinfo`, parseNarInfo(raw));
  await repository.stage("nar/restart.nar", new Blob(["x"]).stream());
  repository.close();
  repository = new WriteRepository(db, spool, {
    perBodyBytes: 4096,
    aggregateBytes: 65536,
  });
  const overlay = new SignerOverlay(repository);
  const eligibility = new EligibilityModel(repository, overlay, {
    maxVisited: 8,
    maxMetadataBytes: 8192,
    lowerHasStorePath: () => false,
  });
  const generations: number[] = [];
  const subscription = eligibility.start((generation) =>
    generations.push(generation)
  );
  assertEquals(
    await eligibility.reconcile((generation) => generations.push(generation)),
    true,
  );
  assertEquals(overlay.current().entries.size, 2);
  assertEquals(generations, [1]);
  assertEquals(await eligibility.reconcile(), false);
  subscription.unsubscribe();
  repository.close();
  await Deno.remove(root, { recursive: true });
});

Deno.test("atomic promotion is create-new complete and retry-idempotent", async () => {
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
    const first = await repository.stage(
      "nar/atomic.nar",
      new Blob(["complete"]).stream(),
    );
    assertEquals(await Deno.readTextFile(first.path), "complete");
    const stat = await Deno.stat(first.path);
    assertEquals(stat.size, 8);
    const retry = await repository.stage(
      "nar/atomic.nar",
      new Blob(["complete"]).stream(),
    );
    assertEquals(retry.idempotent, true);
    assertEquals(retry.path, first.path);
    let conflicted = false;
    try {
      await repository.stage("nar/atomic.nar", new Blob(["changed!"]).stream());
    } catch {
      conflicted = true;
    }
    assertEquals(conflicted, true);
    assertEquals(await Deno.readTextFile(first.path), "complete");
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("distinct live quota charges current overlay and shared blobs once", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repository = new WriteRepository(
      `${root}/write.db`,
      `${root}/spool`,
      {
        perBodyBytes: 10,
        aggregateBytes: 20,
      },
    );
    await repository.stage("nar/current", new Blob(["1234567890"]).stream());
    repository.commitOverlayRoutes(["nar/current"]);
    await repository.stage("nar/shared", new Blob(["1234567890"]).stream());
    await repository.stage("nar/second", new Blob(["abcdefghij"]).stream());
    await assertRejects(
      () => repository.stage("nar/overflow", new Blob(["x"]).stream()),
      RangeError,
      "aggregate staging reservation unavailable",
    );
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
