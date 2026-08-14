import { assertEquals, assertStringIncludes } from "@std/assert";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import { createHealthSnapshotProvider } from "../../src/operations/health.ts";
import type {
  StatusSnapshot,
  StatusSnapshotProvider,
} from "../../src/operations/status.ts";
import type { WriteRepository } from "../../src/persistence/write_repository.ts";

function statusSnapshot(
  overrides: Partial<StatusSnapshot> = {},
): StatusSnapshot {
  return {
    timestamp: "2026-08-14T00:00:00.000Z",
    overall: {
      level: "ok",
      summary: "Serving 0 caches. Writes disabled.",
      reasons: [],
    },
    read: { status: "unavailable", caches: [], overlayEntries: 0 },
    storage: {
      available: false,
      readyBytes: 0,
      reservedBytes: 0,
      capacityBytes: 0,
      usedPercent: 0,
      tombstones: 0,
    },
    write: {
      status: "disabled",
      reasons: [],
      destinations: 0,
      relays: 0,
      acceptingUploads: false,
      signerDetail: "",
    },
    setup: { substituter: "http://127.0.0.1:8787", trustedPublicKeys: [] },
    ...overrides,
  };
}

function statusProvider(snapshot: StatusSnapshot): StatusSnapshotProvider {
  return { current: () => snapshot };
}

Deno.test("GET / serves the status page as HTML with the full security header set", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: statusProvider(statusSnapshot()),
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const response = await handler(new Request("http://cache.test/"));
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertStringIncludes(
    response.headers.get("content-security-policy") ?? "",
    "default-src 'none'",
  );
  const body = await response.text();
  assertStringIncludes(body, "<!DOCTYPE html>");
});

Deno.test("GET / with an empty selection is 200, not 503", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: statusProvider(statusSnapshot()),
    selection: {
      current: () => {
        throw new Error("status page must not read selection");
      },
    },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const response = await handler(new Request("http://cache.test/"));
  assertEquals(response.status, 200);
});

Deno.test("HEAD / matches GET /'s content-length with a null body", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: statusProvider(statusSnapshot()),
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const get = await handler(new Request("http://cache.test/"));
  const head = await handler(
    new Request("http://cache.test/", { method: "HEAD" }),
  );
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
  assertEquals(
    head.headers.get("content-length"),
    get.headers.get("content-length"),
  );
});

Deno.test("the 503-rewrite wrapper never touches the status page but still rewrites other 503s", async () => {
  const health = createHealthSnapshotProvider(
    () => ({
      process: { repositoryHealthy: true },
      read: { selectedPublications: 0, overlayEntries: 0 },
      write: { enabled: false },
    }),
    () => 0,
  );
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    health,
    status: statusProvider(statusSnapshot()),
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const page = await handler(new Request("http://cache.test/"));
  assertEquals(page.status, 200);
  assertEquals(
    page.headers.get("content-type"),
    "text/html; charset=utf-8",
  );

  const narinfo = await handler(
    new Request(`http://cache.test/${"a".repeat(32)}.narinfo`),
  );
  assertEquals(narinfo.status, 503);
  assertEquals(
    narinfo.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
  assertStringIncludes(await narinfo.text(), "no_read_sources");
});

Deno.test("a handler built without a status provider returns 404 for GET /", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const response = await handler(new Request("http://cache.test/"));
  assertEquals(response.status, 404);
  assertEquals(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
});

Deno.test("a throwing status provider yields 500 and the handler remains usable", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: {
      current: () => {
        throw new Error("boom");
      },
    },
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
  });
  const response = await handler(new Request("http://cache.test/"));
  assertEquals(response.status, 500);
  assertEquals(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
  const next = await handler(new Request("http://cache.test/nix-cache-info"));
  assertEquals(next.status, 200);
});

Deno.test("PUT / still returns 404 because it never matches a stock write route", async () => {
  const repository = {
    stage: () => Promise.reject(new Error("unused")),
  } as unknown as WriteRepository;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: statusProvider(statusSnapshot()),
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => Promise.reject(new Error("unused")),
    }),
    write: { current: () => ({ ready: true, repository }) },
  });
  const response = await handler(
    new Request("http://cache.test/", { method: "PUT", body: "x" }),
  );
  assertEquals(response.status, 404);
});

Deno.test("GET / and HEAD / never resolve a NAR, sign, or open a network connection", async () => {
  const calls = { statusReads: 0, resolve: 0, sign: 0, network: 0 };
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    status: {
      current: () => {
        calls.statusReads++;
        return statusSnapshot();
      },
    },
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({
      resolve: () => {
        calls.resolve++;
        return Promise.reject(new Error("status page attempted resolution"));
      },
    }),
  });
  let okCount = 0;
  for (let index = 0; index < 20; index++) {
    const method = index % 2 ? "HEAD" : "GET";
    const response = await handler(
      new Request("http://cache.test/", { method }),
    );
    if (response.status === 200) okCount++;
  }
  assertEquals(okCount, 20);
  assertEquals(calls, { statusReads: 20, resolve: 0, sign: 0, network: 0 });
});
