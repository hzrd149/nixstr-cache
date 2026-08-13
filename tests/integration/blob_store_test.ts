import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  BlobStore,
  DEFAULT_BLOB_STORE_BYTES,
} from "../../src/persistence/blob_store.ts";
import { BlobFetcher } from "../../src/blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { sha256 } from "@noble/hashes/sha2.js";

const bytes = (value: string) => new TextEncoder().encode(value);

Deno.test("blob store accounts physical bytes once and enforces reservations", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-blob-store-" });
  try {
    const store = new BlobStore(`${root}/state.sqlite`, `${root}/store`, {
      capacityBytes: 8,
    });
    assertEquals(DEFAULT_BLOB_STORE_BYTES, 16 * 1024 * 1024 * 1024);
    const first = await store.admit(bytes("abcd"), {
      origin: "write",
      owner: "route:a",
      reserveBytes: 4,
    });
    const duplicate = await store.admit(bytes("abcd"), {
      origin: "remote",
      owner: "route:b",
      reserveBytes: 4,
    });
    assertEquals(first.hash, duplicate.hash);
    assertEquals(store.usage(), {
      readyBytes: 4,
      reservedBytes: 0,
      capacityBytes: 8,
    });
    const reservation = store.reserve(4);
    assertEquals(store.usage().reservedBytes, 4);
    assertThrows(() => store.reserve(1), RangeError);
    reservation.release();
    store.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("blob store leases exclude eviction and write ownership controls deletion", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-blob-lifetime-" });
  try {
    let clock = 1;
    const store = new BlobStore(`${root}/state.sqlite`, `${root}/store`, {
      capacityBytes: 6,
      now: () => clock++,
    });
    const remote = await store.admit(bytes("abc"), {
      origin: "remote",
      reserveBytes: 3,
    });
    const lease = store.lookup(remote.hash)!;
    await store.admit(bytes("def"), {
      origin: "remote",
      owner: "pinned",
      reserveBytes: 3,
    });
    assertRejects(
      () => store.admit(bytes("g"), { origin: "remote", reserveBytes: 1 }),
      RangeError,
    );
    lease.release();
    await store.admit(bytes("g"), { origin: "remote", reserveBytes: 1 });
    assertEquals(store.has(remote.hash), false);

    const written = await store.admit(bytes("xy"), {
      origin: "write",
      owner: "route:write",
      reserveBytes: 2,
    });
    store.releaseOwner("route:write", written.hash);
    assertEquals(store.has(written.hash), false);
    store.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("verified remote fetches remain cached and warm reads avoid the network", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-blob-fetch-" });
  try {
    const store = new BlobStore(`${root}/state.sqlite`, `${root}/store`, {
      capacityBytes: 64,
    });
    const payload = bytes("remote payload");
    const hash = sha256(payload).toHex();
    let requests = 0;
    const fetcher = new BlobFetcher({
      store,
      fetcher: {
        fetch: () => {
          requests++;
          return Promise.resolve({
            status: 200,
            headers: new Headers({ "content-length": String(payload.length) }),
            body: new Response(payload.slice()).body!,
            peerAddress: "127.0.0.1",
            text: () => Promise.resolve(""),
            cancel: () => Promise.resolve(),
          });
        },
      },
      quarantine: {
        isQuarantined: () => false,
        quarantine: () => {},
        releaseQuarantine: () => {},
      },
    });
    const sources = buildSourcePlan({ event: ["https://cache.example"] });
    const first = await fetcher.fetch(hash, sources, {
      maxAttempts: 1,
      maxTransferBytes: 64,
    });
    assertEquals(await new Response(first.open()).bytes(), payload);
    await first.dispose();
    const warm = await fetcher.fetch(hash, sources, {
      maxAttempts: 1,
      maxTransferBytes: 64,
    });
    assertEquals(await new Response(warm.open()).bytes(), payload);
    await warm.dispose();
    assertEquals(requests, 1);
    assertEquals(store.has(hash), true);
    store.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
