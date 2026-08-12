import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { createSignerCapability } from "../../src/signer/capability.ts";
import {
  WriteConflict,
  WriteRepository,
} from "../../src/persistence/write_repository.ts";
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
      identity: { kind: 17091, pubkey, identifier: "" },
    },
    localKeyPath: keyPath,
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

Deno.test("mismatched signer and failed staging fail closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-fail-" });
  const secret = generateSecretKey();
  const keyPath = `${root}/key`;
  await Deno.writeFile(keyPath, secret, { mode: 0o600 });
  const capability = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, pubkey: "0".repeat(64), identifier: "" },
    },
    localKeyPath: keyPath,
  });
  await capability.start();
  assertEquals(capability.current(), {
    status: "failed",
    code: "ownership_mismatch",
  });
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
  assertEquals(await (await handler(new Request(`http://cache/${storeHash}.narinfo`))).text(), narinfo);
  const response = await handler(new Request("http://cache/nar/signer.nar"));
  assertEquals(await response.text(), "signer");
  repository.close();
  await Deno.remove(root, { recursive: true });
});
