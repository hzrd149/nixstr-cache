import { assert, assertEquals, assertRejects } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateSecretKey, verifyEvent } from "nostr-tools";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { PublicationUploader } from "../../src/blossom/publication_uploader.ts";
import {
  createUploadAuthorizationBatch,
  MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES,
} from "../../src/blossom/upload_authorization.ts";
import { createControlledBlossomFixture } from "../fixtures/publication.ts";

function decodeAuthorization(value: string) {
  const encoded = value.slice("Nostr ".length);
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return JSON.parse(binary) as {
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  };
}

function authorizationFieldBytes(value: string): number {
  return new TextEncoder().encode(`Authorization: ${value}\r\n`).length;
}

Deno.test("upload authorization batches hashes into bounded BUD-11 events", async () => {
  const signer = PrivateKeySigner.fromKey(generateSecretKey());
  const hashes = Array.from(
    { length: 65 },
    (_, index) => index.toString(16).padStart(64, "0"),
  );
  let signCalls = 0;
  const batch = await createUploadAuthorizationBatch({
    signer: {
      signEvent: async (template) => {
        signCalls++;
        return await signer.signEvent(template);
      },
    },
    hashes,
    servers: [
      "https://CDN.Example/base",
      "https://cdn.example/other",
      "http://127.0.0.1:3000/base",
    ],
    now: 100,
    maxHeaderBytes: 100_000,
  });
  assertEquals(signCalls, 4);
  assertEquals(batch.eventCount, 4);
  const firstServer = "https://CDN.Example/base";
  const sameDomainServer = "https://cdn.example/other";
  const localServer = "http://127.0.0.1:3000/base";
  const first = decodeAuthorization(batch.header(firstServer, hashes[0])!);
  assert(verifyEvent(first as never));
  assertEquals(first.kind, 24242);
  assertEquals(first.content, "Upload Nix cache blobs");
  assertEquals(first.created_at, 100);
  assertEquals(first.tags.slice(0, 3), [
    ["t", "upload"],
    ["expiration", "3700"],
    ["server", "cdn.example"],
  ]);
  assertEquals(
    first.tags.filter((tag) => tag[0] === "x").map((tag) => tag[1]),
    hashes.slice(0, 64),
  );
  assertEquals(
    batch.header(firstServer, hashes[0]),
    batch.header(firstServer, hashes[63]),
  );
  assert(
    batch.header(firstServer, hashes[64]) !==
      batch.header(firstServer, hashes[63]),
  );
  assertEquals(
    batch.header(firstServer, hashes[0]),
    batch.header(sameDomainServer, hashes[0]),
  );
  assert(
    authorizationFieldBytes(batch.header(firstServer, hashes[0])!) >
      MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES,
    "the independent count-boundary fixture must exceed the default byte ceiling",
  );
  const local = decodeAuthorization(batch.header(localServer, hashes[0])!);
  assertEquals(local.tags.some((tag) => tag[0] === "server"), false);

  const byteBounded = await createUploadAuthorizationBatch({
    signer,
    hashes,
    servers: [firstServer],
    now: 100,
  });
  assertEquals(byteBounded.eventCount, 2);
  assert(
    hashes.every((hash) =>
      authorizationFieldBytes(byteBounded.header(firstServer, hash)!) <=
        MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES
    ),
  );
});

Deno.test("upload authorization splits before signing at the exact header-byte boundary", async () => {
  const signer = PrivateKeySigner.fromKey(generateSecretKey());
  const hashes = ["a".repeat(64), "b".repeat(64)];
  const servers = ["https://cdn.example/base"];
  const signed = async (maxHeaderBytes: number) => {
    let signCalls = 0;
    const batch = await createUploadAuthorizationBatch({
      signer: {
        signEvent: async (template) => {
          signCalls++;
          return await signer.signEvent(template);
        },
      },
      hashes,
      servers,
      now: 100,
      maxHeaderBytes,
    });
    return { batch, signCalls };
  };

  const reference = await signed(100_000);
  const twoHashHeader = reference.batch.header(servers[0], hashes[0])!;
  const exactBytes = authorizationFieldBytes(twoHashHeader);
  assert(exactBytes < MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES);

  const atBoundary = await signed(exactBytes);
  assertEquals(atBoundary.signCalls, 1);
  assertEquals(atBoundary.batch.eventCount, 1);
  assertEquals(
    authorizationFieldBytes(atBoundary.batch.header(servers[0], hashes[0])!),
    exactBytes,
  );

  const belowBoundary = await signed(exactBytes - 1);
  assertEquals(belowBoundary.signCalls, 2);
  assertEquals(belowBoundary.batch.eventCount, 2);
  assert(
    belowBoundary.batch.header(servers[0], hashes[0]) !==
      belowBoundary.batch.header(servers[0], hashes[1]),
  );
  assert(
    hashes.every((hash) =>
      authorizationFieldBytes(
        belowBoundary.batch.header(servers[0], hash)!,
      ) <= exactBytes - 1
    ),
  );

  const oneHash = await createUploadAuthorizationBatch({
    signer,
    hashes: hashes.slice(0, 1),
    servers,
    now: 100,
    maxHeaderBytes: 100_000,
  });
  const oneHashBytes = authorizationFieldBytes(
    oneHash.header(servers[0], hashes[0])!,
  );
  let undersizedSignCalls = 0;
  await assertRejects(
    () =>
      createUploadAuthorizationBatch({
        signer: {
          signEvent: async (template) => {
            undersizedSignCalls++;
            return await signer.signEvent(template);
          },
        },
        hashes: hashes.slice(0, 1),
        servers,
        now: 100,
        maxHeaderBytes: oneHashBytes - 1,
      }),
    RangeError,
    "cannot fit one hash",
  );
  assertEquals(undersizedSignCalls, 0);
});

Deno.test("hostile Blossom responses cannot establish false possession", async () => {
  const root = await Deno.makeTempDir({ prefix: "hostile-publication-" });
  const bytes = new TextEncoder().encode("immutable candidate");
  const path = `${root}/blob`;
  await Deno.writeFile(path, bytes);
  const hash = sha256(bytes).toHex();
  try {
    for (
      const mode of [
        "descriptor-hash",
        "descriptor-size",
        "truncated-proof",
        "false-possession",
      ] as const
    ) {
      const fixture = await createControlledBlossomFixture();
      try {
        fixture.control.mode = mode;
        const uploader = new PublicationUploader({ request: fixture.request });
        assertEquals(
          await uploader.prove(fixture.url, { hash, size: bytes.length, path }),
          false,
          mode,
        );
      } finally {
        await fixture.close();
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("publication skips upload when Blossom already has the blob", async () => {
  const root = await Deno.makeTempDir({ prefix: "existing-publication-" });
  const fixture = await createControlledBlossomFixture();
  const bytes = new TextEncoder().encode("existing immutable candidate");
  const path = `${root}/blob`;
  await Deno.writeFile(path, bytes);
  const entry = { hash: sha256(bytes).toHex(), size: bytes.length, path };
  let authorizationCalls = 0;
  const uploader = new PublicationUploader({
    request: fixture.request,
    authorization: () => {
      authorizationCalls++;
      return Promise.resolve("Nostr test");
    },
  });
  try {
    assertEquals(await uploader.prove(fixture.url, entry), true);
    assertEquals(fixture.facts.uploads, 1);
    assertEquals(authorizationCalls, 1);
    assertEquals(await uploader.prove(fixture.url, entry), true);
    assertEquals(fixture.facts.uploads, 1);
    assertEquals(authorizationCalls, 1);
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
    const entries = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const bytes = new Uint8Array(128 * 1024).fill(index);
        const path = `${root}/${index}`;
        await Deno.writeFile(path, bytes);
        return { hash: sha256(bytes).toHex(), size: bytes.length, path };
      }),
    );
    const ceiling = 2;
    for (let offset = 0; offset < entries.length; offset += ceiling) {
      assert(
        (await Promise.all(
          entries.slice(offset, offset + ceiling).map((entry) =>
            uploader.prove(fixture.url, entry)
          ),
        )).every(Boolean),
      );
    }
    assert(fixture.facts.maxActiveUploads <= ceiling);
    assert(
      fixture.facts.uploadChunks > entries.length,
      "fixture must observe streamed chunks",
    );
  } finally {
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("publication upload preserves server base path and publisher trust", async () => {
  const root = await Deno.makeTempDir({ prefix: "publication-target-" });
  const path = `${root}/blob`;
  const bytes = new TextEncoder().encode("blob");
  const hash = sha256(bytes).toHex();
  await Deno.writeFile(path, bytes);
  const calls: Array<[string, string]> = [];
  const uploader = new PublicationUploader({
    request: (url, trust, init) => {
      calls.push([String(url), trust]);
      return Promise.resolve({
        status: init.method === "HEAD"
          ? 404
          : init.method === "PUT"
          ? 201
          : 200,
        headers: new Headers(),
        body: new Response(
          init.method === "PUT"
            ? JSON.stringify({ sha256: hash, size: bytes.length })
            : bytes,
        ).body!,
        peerAddress: "203.0.113.1",
        text: () => Promise.resolve(""),
        cancel: () => Promise.resolve(),
      });
    },
  });
  try {
    assertEquals(
      await uploader.prove("https://blossom.example/base", {
        hash,
        size: bytes.length,
        path,
      }),
      true,
    );
    assertEquals(calls, [
      [`https://blossom.example/base/${hash}`, "publisher"],
      ["https://blossom.example/base/upload", "publisher"],
      [`https://blossom.example/base/${hash}`, "publisher"],
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
