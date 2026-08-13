import { assertEquals, assertRejects } from "@std/assert";
import {
  BlobStore,
  DEFAULT_BLOB_STORE_BYTES,
} from "../../src/persistence/blob_store.ts";

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
    assertEquals(store.usage(), { readyBytes: 4, reservedBytes: 0, capacityBytes: 8 });
    const reservation = store.reserve(4);
    assertEquals(store.usage().reservedBytes, 4);
    assertRejects(() => Promise.resolve().then(() => store.reserve(1)), RangeError);
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
    await store.admit(bytes("def"), { origin: "remote", reserveBytes: 3 });
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
