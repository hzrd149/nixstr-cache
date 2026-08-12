import { assertEquals, assertExists } from "@std/assert";
import { RequestBudget, VerifiedAbsent } from "../../src/hashtree/reader.ts";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import {
  SignerRouteRegistry,
  WinnerRouteRegistry,
} from "../../src/nix/merged_cache.ts";
import type {
  MergedSelectionSnapshot,
  SelectedPublication,
} from "../../src/nostr/selection.ts";

const encoder = new TextEncoder();
const hash = "0123456789abcdfghijklmnpqrsvwxyz";
const sig =
  "Sig: duplicate:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const record = (extra: readonly string[] = [], url = "nar/winner.nar") =>
  [
    `StorePath: /nix/store/${hash}-demo`,
    `URL: ${url}`,
    "Compression: none",
    `FileHash: sha256:${hash}${hash.slice(0, 20)}`,
    "FileSize: 3",
    `NarHash: sha256:${hash}${hash.slice(0, 20)}`,
    "NarSize: 3",
    "References: ",
    ...extra,
    "",
  ].join("\n");

function publication(id: string, pubkey: string): SelectedPublication {
  return {
    event: {
      id,
      pubkey,
      created_at: 1,
      kind: 17091,
      tags: [],
      content: "",
      sig: "",
    },
    identity: { kind: 17091, pubkey },
    root: { bytes: new Uint8Array(32), hex: id.padEnd(64, "0") },
    nixSigKeys: [],
    blossomServers: [],
    bud03Servers: [],
  } as unknown as SelectedPublication;
}

function budget() {
  return new RequestBudget({
    maxDepth: 10,
    maxLinks: 100,
    maxUniqueNodes: 100,
    maxDecodedBytes: 4096,
    maxAttempts: 20,
    maxRedirects: 3,
    maxConcurrent: 2,
    maxBlobTransferBytes: 4096,
    maxTransferredBytes: 16384,
    maxOutputBytes: 16384,
    deadline: Date.now() + 10_000,
  });
}

Deno.test("agreement preserves duplicate signature occurrence order and exact HEAD length", async () => {
  const layers = [
    publication("winner", "a".repeat(64)),
    publication("loser", "b".repeat(64)),
  ] as MergedSelectionSnapshot;
  const texts = new Map([["winner", record([sig, "System: x86_64-linux"])], [
    "loser",
    record(["System: x86_64-linux", sig, sig]),
  ]]);
  const budgets = new Set<RequestBudget>();
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => layers },
    budgetFor: budget,
    resolverFor: (p) => ({
      resolve: (_r, path, method, b) => {
        budgets.add(b);
        if (!path.endsWith(".narinfo")) {
          return Promise.reject(new VerifiedAbsent(path));
        }
        const bytes = encoder.encode(texts.get(p.event.id)!);
        return Promise.resolve({
          hash: p.event.id,
          size: bytes.length,
          type: 0,
          ...(method === "GET" ? { body: new Blob([bytes]).stream() } : {}),
        });
      },
    }),
  });
  const response = await handler(new Request(`http://cache/${hash}.narinfo`));
  const expected = record([sig, "System: x86_64-linux", sig, sig]);
  assertEquals(await response.text(), expected);
  assertEquals(budgets.size, 1);
  const head = await handler(
    new Request(`http://cache/${hash}.narinfo`, { method: "HEAD" }),
  );
  assertEquals(
    head.headers.get("content-length"),
    String(encoder.encode(expected).length),
  );
  assertEquals(await head.text(), "");
});

Deno.test("pinned signer registry releases generation leases exactly once", () => {
  let now = 0;
  let released = 0;
  const registry = new SignerRouteRegistry(1, 10, () => now);
  const lease = (generation: number) => ({
    snapshot: {
      generation,
      entries: new Map(),
      storePaths: new Set<string>(),
    },
    release: () => released++,
  });
  registry.set("nar/one.nar", lease(1));
  registry.set("nar/two.nar", lease(2));
  assertEquals(released, 1);
  const taken = registry.take("nar/two.nar");
  taken?.release();
  assertEquals(released, 2);
  registry.set("nar/three.nar", lease(3));
  now = 11;
  assertEquals(registry.take("nar/three.nar"), undefined);
  assertEquals(released, 3);
  registry.close();
  registry.close();
  assertEquals(released, 3);
});

Deno.test("conflict returns byte-identical winner and emits one redacted diagnostic per loser", async () => {
  const layers = [
    publication("winner-event", "a".repeat(64)),
    publication("loser-event", "b".repeat(64)),
  ] as MergedSelectionSnapshot;
  const winnerText = record([sig, "Deriver: secret-winner"]);
  const loserText = record(["Deriver: secret-loser", "CA: hostile-secret"]);
  const diagnostics: unknown[] = [];
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => layers },
    budgetFor: budget,
    diagnostics: { emit: (item) => diagnostics.push(item) },
    resolverFor: (p) => ({
      resolve: (_r, _path, method) => {
        const bytes = encoder.encode(
          p.event.id === "winner-event" ? winnerText : loserText,
        );
        return Promise.resolve({
          hash: "x",
          size: bytes.length,
          type: 0,
          ...(method === "GET" ? { body: new Blob([bytes]).stream() } : {}),
        });
      },
    }),
  });
  assertEquals(
    await (await handler(new Request(`http://cache/${hash}.narinfo`))).text(),
    winnerText,
  );
  assertEquals(diagnostics.length, 1);
  const encoded = JSON.stringify(diagnostics[0]);
  assertEquals(encoded.includes("secret"), false);
  assertEquals(encoded.includes(sig), false);
  assertEquals(diagnostics[0], {
    code: "narinfo-semantic-conflict",
    storePathHash: hash,
    winnerIdentity: `17091:${"a".repeat(64)}:`,
    winnerEventId: "winner-event",
    loserIdentity: `17091:${"b".repeat(64)}:`,
    loserEventId: "loser-event",
    differingFields: ["CA", "Deriver"],
  });
});

Deno.test("winner route remains pinned across selection update and registry evicts deterministically", async () => {
  const old = publication("old", "a".repeat(64));
  const fresh = publication("fresh", "b".repeat(64));
  let current: MergedSelectionSnapshot = [old];
  const registry = new WinnerRouteRegistry(1, 1000, () => 100);
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => current },
    routes: registry,
    budgetFor: budget,
    resolverFor: (p) => ({
      resolve: (_r, path, method) => {
        if (path.endsWith(".narinfo")) {
          const bytes = encoder.encode(record());
          return Promise.resolve({
            hash: "i",
            size: bytes.length,
            type: 0,
            body: new Blob([bytes]).stream(),
          });
        }
        if (path === "nar/winner.nar") {
          const bytes = encoder.encode(p.event.id);
          return Promise.resolve({
            hash: "n",
            size: bytes.length,
            type: 0,
            ...(method === "GET" ? { body: new Blob([bytes]).stream() } : {}),
          });
        }
        return Promise.reject(new VerifiedAbsent(path));
      },
    }),
  });
  await (await handler(new Request(`http://cache/${hash}.narinfo`))).text();
  current = [fresh];
  assertEquals(
    await (await handler(new Request("http://cache/nar/winner.nar"))).text(),
    "old",
  );
  assertExists(registry.get("nar/winner.nar"));
  registry.set("nar/other.nar", fresh);
  assertEquals(registry.get("nar/winner.nar"), undefined);
});
