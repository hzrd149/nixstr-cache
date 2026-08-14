import { assertEquals } from "@std/assert";
import type { SelectedPublication } from "../../src/nostr/selection.ts";
import type { EndpointWork } from "../../src/persistence/write_repository.ts";
import type {
  HealthSnapshot,
  ProcessHealthReason,
  ReadHealthReason,
  WriteHealthReason,
} from "../../src/operations/health.ts";
import {
  createStatusSnapshotProvider,
  REASON_TEXT,
  type StatusInputs,
  summarizeEndpointWork,
} from "../../src/operations/status.ts";

const NHASH_VALID = "nhash1" + "023456789acdefghjklmnpqrstuvwxyz".slice(0, 20);

function health(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    timestamp: "2026-08-14T00:00:00.000Z",
    process: { status: "ok", reasons: [] },
    read: { status: "ok", reasons: [] },
    write: { status: "disabled", reasons: ["write_disabled"] },
    ...overrides,
  };
}

function inputs(overrides: Partial<StatusInputs> = {}): StatusInputs {
  return {
    health: health(),
    endpoint: { host: "127.0.0.1", port: 8787 },
    caches: [],
    overlayEntries: 0,
    write: {
      enabled: false,
      acceptingUploads: false,
      destinations: 0,
      relays: 0,
    },
    ...overrides,
  };
}

function publication(
  overrides: Partial<{
    kind: 17091 | 37091;
    pubkey: string;
    name: string;
    nhash: string;
    keys: readonly { name: string; encoded: string }[];
    blossomServers: readonly string[];
    createdAt: number;
    expiresAt: number;
  }> = {},
): SelectedPublication {
  const kind = overrides.kind ?? 17091;
  const pubkey = overrides.pubkey ?? "a".repeat(64);
  return {
    event: Object.freeze({
      id: "e".repeat(64),
      pubkey,
      created_at: overrides.createdAt ?? 1_000,
      kind,
      tags: [],
      content: "",
      sig: "s".repeat(128),
    }),
    identity: Object.freeze({
      kind,
      pubkey,
      ...(overrides.name === undefined ? {} : { name: overrides.name }),
    }),
    root: Object.freeze({
      bytes: new Uint8Array(32),
      hex: "0".repeat(64),
      nhash: overrides.nhash ?? NHASH_VALID,
    }),
    nixSigKeys: Object.freeze(
      (overrides.keys ?? []).map((key) =>
        Object.freeze({
          name: key.name,
          encoded: key.encoded,
          bytes: new Uint8Array(32),
        })
      ),
    ),
    blossomServers: Object.freeze(overrides.blossomServers ?? []),
    ...(overrides.expiresAt === undefined
      ? {}
      : { expiresAt: overrides.expiresAt }),
    bud03Servers: Object.freeze([]),
  } as unknown as SelectedPublication;
}

Deno.test("overall.level matrix covers all four health axes", () => {
  const cases: Array<[HealthSnapshot, "ok" | "degraded" | "down"]> = [
    [
      health({ process: { status: "failed", reasons: ["fatal_error"] } }),
      "down",
    ],
    [
      health({
        read: { status: "unavailable", reasons: ["no_read_sources"] },
      }),
      "degraded",
    ],
    [
      health({
        write: { status: "blocked", reasons: ["no_publication_relay"] },
      }),
      "degraded",
    ],
    [
      health({
        write: { status: "repairing", reasons: ["repair_pending"] },
      }),
      "degraded",
    ],
    [
      health({ write: { status: "disabled", reasons: ["write_disabled"] } }),
      "ok",
    ],
    [health({ write: { status: "ready", reasons: [] } }), "ok"],
  ];
  for (const [snapshot, expected] of cases) {
    const provider = createStatusSnapshotProvider(
      () => inputs({ health: snapshot }),
      () => 0,
    );
    assertEquals(provider.current().overall.level, expected);
  }
});

Deno.test("zero caches produce a complete snapshot without throwing", () => {
  const provider = createStatusSnapshotProvider(() => inputs(), () => 0);
  const snapshot = provider.current();
  assertEquals(snapshot.read.caches, []);
  assertEquals(snapshot.setup.trustedPublicKeys, []);
});

Deno.test("priority is positional and 1-based across a three-cache selection", () => {
  const caches = [
    publication({ pubkey: "a".repeat(64) }),
    publication({ pubkey: "b".repeat(64) }),
    publication({ pubkey: "c".repeat(64) }),
  ];
  const provider = createStatusSnapshotProvider(
    () => inputs({ caches }),
    () => 0,
  );
  const snapshot = provider.current();
  assertEquals(
    snapshot.read.caches.map((cache) => cache.priority),
    [1, 2, 3],
  );
});

Deno.test("writable is true only on exact identity match", () => {
  const target = publication({ pubkey: "a".repeat(64) });
  const other = publication({ pubkey: "b".repeat(64) });
  const identity = `17091:${"a".repeat(64)}:`;
  const withIdentity = createStatusSnapshotProvider(
    () => inputs({ caches: [target, other], writableIdentity: identity }),
    () => 0,
  ).current();
  assertEquals(withIdentity.read.caches[0].writable, true);
  assertEquals(withIdentity.read.caches[1].writable, false);

  const withoutIdentity = createStatusSnapshotProvider(
    () => inputs({ caches: [target, other] }),
    () => 0,
  ).current();
  assertEquals(
    withoutIdentity.read.caches.every((cache) => cache.writable === false),
    true,
  );
});

Deno.test("expired is computed against an injected now", () => {
  const cache = publication({ expiresAt: 1_000 });
  const before = createStatusSnapshotProvider(
    () => inputs({ caches: [cache] }),
    () => 999 * 1000,
  ).current();
  assertEquals(before.read.caches[0].expired, false);
  const after = createStatusSnapshotProvider(
    () => inputs({ caches: [cache] }),
    () => 1_001 * 1000,
  ).current();
  assertEquals(after.read.caches[0].expired, true);
});

Deno.test("setup.substituter normalizes wildcard binds for pasteability", () => {
  const cases: Array<[string, number, string]> = [
    ["0.0.0.0", 8787, "http://127.0.0.1:8787"],
    ["::", 8787, "http://[::1]:8787"],
    ["[::]", 8787, "http://[::1]:8787"],
    ["fe80::1", 8787, "http://[fe80::1]:8787"],
    ["127.0.0.1", 8787, "http://127.0.0.1:8787"],
    ["127.0.0.1", 9999, "http://127.0.0.1:9999"],
  ];
  for (const [host, port, expected] of cases) {
    const snapshot = createStatusSnapshotProvider(
      () => inputs({ endpoint: { host, port } }),
      () => 0,
    ).current();
    assertEquals(snapshot.setup.substituter, expected);
  }
});

Deno.test("trustedPublicKeys dedupes identical name:encoded pairs and sorts", () => {
  const caches = [
    publication({
      pubkey: "a".repeat(64),
      keys: [{ name: "zeta", encoded: "Z".repeat(43) + "=" }],
    }),
    publication({
      pubkey: "b".repeat(64),
      keys: [
        { name: "alpha", encoded: "A".repeat(43) + "=" },
        { name: "zeta", encoded: "Z".repeat(43) + "=" },
      ],
    }),
  ];
  const snapshot = createStatusSnapshotProvider(
    () => inputs({ caches }),
    () => 0,
  ).current();
  assertEquals(snapshot.setup.trustedPublicKeys, [
    `alpha:${"A".repeat(43)}=`,
    `zeta:${"Z".repeat(43)}=`,
  ]);
});

Deno.test("blossom server scrubbing drops userinfo/query and rejects non-http/ws schemes", () => {
  const cache = publication({
    blossomServers: [
      "https://user:secret@example.test/base?token=hidden#part",
      "ws://relay.test/blossom",
      "ftp://blocked.test/base",
    ],
  });
  const snapshot = createStatusSnapshotProvider(
    () => inputs({ caches: [cache] }),
    () => 0,
  ).current();
  const servers = snapshot.read.caches[0].blossomServers;
  assertEquals(servers.includes("ws://relay.test/blossom"), true);
  assertEquals(servers.includes("https://example.test/base"), true);
  assertEquals(servers.some((server) => server.includes("secret")), false);
  assertEquals(servers.some((server) => server.includes("hidden")), false);
  assertEquals(servers.some((server) => server.includes("ftp://")), false);
  assertEquals(servers.length, 2);
});

function work(
  overrides: Partial<EndpointWork> & { readonly kind: "replica" | "relay" },
): EndpointWork {
  return {
    batchId: 1,
    target: "https://example.test",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    code: "ok",
    ...overrides,
  };
}

Deno.test("summarizeEndpointWork reproduces the coordinator's counters", () => {
  const rows: EndpointWork[] = [
    work({ kind: "replica", status: "pending", attempts: 0 }),
    work({ kind: "replica", status: "claimed", attempts: 1 }),
    work({ kind: "replica", status: "retry", attempts: 2 }),
    work({ kind: "replica", status: "complete", attempts: 1 }),
    work({ kind: "replica", status: "exhausted", attempts: 8 }),
    work({ kind: "relay", status: "complete", attempts: 1 }),
    work({ kind: "relay", status: "pending", attempts: 0 }),
  ];
  const replicas = summarizeEndpointWork(rows, "replica");
  assertEquals(replicas, {
    total: 5,
    succeeded: 1,
    failed: 3,
    retries: 0 + 0 + 1 + 0 + 7,
    exhausted: 1,
  });
  const relays = summarizeEndpointWork(rows, "relay");
  assertEquals(relays, {
    total: 2,
    succeeded: 1,
    failed: 0,
    retries: 0,
    exhausted: 0,
  });
});

Deno.test("REASON_TEXT has a non-empty sentence for every reason", () => {
  const processReasons: readonly ProcessHealthReason[] = [
    "repository_unavailable",
    "fatal_error",
  ];
  const readReasons: readonly ReadHealthReason[] = ["no_read_sources"];
  const writeReasons: readonly WriteHealthReason[] = [
    "write_disabled",
    "write_repository_unavailable",
    "signer_disconnected",
    "signer_connecting",
    "signer_failed",
    "signer_ownership_mismatch",
    "write_initializing",
    "write_activation_failed",
    "no_blossom_destination",
    "no_publication_relay",
    "no_complete_replica",
    "relay_not_acknowledged",
    "repair_pending",
  ];
  for (const reason of [...processReasons, ...readReasons, ...writeReasons]) {
    assertEquals(typeof REASON_TEXT[reason], "string");
    assertEquals(REASON_TEXT[reason].length > 0, true);
  }
});
