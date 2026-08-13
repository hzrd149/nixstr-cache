import { assertEquals, assertRejects } from "@std/assert";
import { VerifiedManifestCache } from "../../src/hashtree/manifest_cache.ts";
import type { SourceCandidate } from "../../src/blossom/source_plan.ts";

const hash = (n: number) => n.toString(16).padStart(64, "0");
const source = (url = "https://one.example"): SourceCandidate => ({
  baseUrl: url,
  origin: new URL(url).origin,
  trust: "publisher",
  role: "publisher",
});
const value = (decodedBytes: number) => ({
  manifest: Object.freeze({
    type: "directory" as const,
    links: Object.freeze([]),
  }),
  decodedBytes,
});

Deno.test("completed manifests hit across source plans and LRU bounds evict", async () => {
  const cache = new VerifiedManifestCache(2, 10);
  let loads = 0;
  const load = (bytes: number) =>
    cache.load(hash(loads + 1), [source()], undefined, () => {
      loads++;
      return Promise.resolve(value(bytes));
    });
  await load(4);
  await cache.load(
    hash(1),
    [source("https://other.example")],
    undefined,
    () => Promise.reject(new Error("unexpected reload")),
  );
  await load(4);
  await load(4);
  assertEquals(loads, 3);
  await cache.close();
});

Deno.test("same source plan joins inflight while different ordering does not", async () => {
  const cache = new VerifiedManifestCache(2, 100);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  let loads = 0;
  const loader = async () => {
    loads++;
    await gate;
    return value(2);
  };
  const sources = [source(), source("https://two.example")];
  const a = cache.load(hash(8), sources, undefined, loader);
  const b = cache.load(hash(8), sources, undefined, loader);
  const c = cache.load(hash(8), [...sources].reverse(), undefined, loader);
  assertEquals(loads, 2);
  release();
  await Promise.all([a, b, c]);
  await cache.close();
});

Deno.test("caller abort is isolated and rejected loads retry", async () => {
  const cache = new VerifiedManifestCache(2, 100);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const controller = new AbortController();
  const shared = cache.load(
    hash(9),
    [source()],
    controller.signal,
    async () => {
      await gate;
      return value(3);
    },
  );
  const survivor = cache.load(
    hash(9),
    [source()],
    undefined,
    () => Promise.resolve(value(3)),
  );
  controller.abort();
  await assertRejects(() => shared, DOMException);
  release();
  await survivor;
  let tries = 0;
  await assertRejects(() =>
    cache.load(hash(10), [source()], undefined, () => {
      tries++;
      return Promise.reject(new Error("bad"));
    })
  );
  await cache.load(hash(10), [source()], undefined, () => {
    tries++;
    return Promise.resolve(value(1));
  });
  assertEquals(tries, 2);
  await cache.close();
  await cache.close();
});

Deno.test("close aborts shared loader and rejects future loads", async () => {
  const cache = new VerifiedManifestCache(1, 10);
  const pending = cache.load(
    hash(11),
    [source()],
    undefined,
    (signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      ),
  );
  await cache.close();
  await assertRejects(() => pending);
  await assertRejects(() =>
    cache.load(
      hash(11),
      [source()],
      undefined,
      () => Promise.resolve(value(1)),
    )
  );
});
