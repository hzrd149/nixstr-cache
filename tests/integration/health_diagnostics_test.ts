import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createConsoleDiagnosticSink,
  type OperationalDiagnostic,
} from "../../src/operations/diagnostics.ts";
import {
  createHealthSnapshotProvider,
  type HealthInputs,
} from "../../src/operations/health.ts";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import type { WriteRepository } from "../../src/persistence/write_repository.ts";

const secretCorpus = [
  "Bearer authorization-secret",
  "cookie-secret",
  "nbunksec1bunker-secret",
  "private-key-deadbeef",
  "full-nar-marker",
  "narinfo-secret-body",
  "stack-secret",
  "cause-secret",
  "query-secret",
];

function healthInputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    process: { repositoryHealthy: true, fatalCode: undefined },
    read: { selectedPublications: 1, overlayEntries: 0 },
    write: {
      enabled: true,
      repositoryHealthy: true,
      signerStatus: "ready",
      signerOwned: true,
      destinations: 1,
      relays: 1,
      publication: { phase: "replicating", completeReplica: false },
    },
    ...overrides,
  };
}

Deno.test("blocked publication is observable without side effects or secrets", async () => {
  const lines: string[] = [];
  const sink = createConsoleDiagnosticSink({
    write: (line) => lines.push(line),
    now: () => 1_786_550_400_000,
  });
  const hostile = {
    authorization: secretCorpus[0],
    cookie: secretCorpus[1],
    bunker: secretCorpus[2],
    key: secretCorpus[3],
    body: secretCorpus[4],
    narinfo: secretCorpus[5],
    stack: secretCorpus[6],
    cause: new Error(secretCorpus[7]),
    arbitrary: "must-not-serialize",
  };
  sink.emit(
    {
      type: "replica_attempt",
      code: "replica_unavailable",
      cacheIdentity: `17091:${"a".repeat(64)}:`,
      rootHash: "b".repeat(64),
      endpoint: `https://user:password@example.test/upload?token=${
        secretCorpus[8]
      }#fragment`,
      attempt: 2,
      count: 5,
      durationMs: 37,
      ok: false,
      ...hostile,
    } as OperationalDiagnostic & typeof hostile,
  );
  assertEquals(lines.length, 1);
  const encoded = lines[0];
  assertStringIncludes(encoded, "WARN  Blossom replica failed");
  assertStringIncludes(encoded, "endpoint=https://example.test/upload");
  for (const secret of secretCorpus) {
    assertEquals(encoded.includes(secret), false);
  }
  assertEquals(encoded.includes("must-not-serialize"), false);

  let reads = 0;
  const provider = createHealthSnapshotProvider(() => {
    reads++;
    return healthInputs();
  }, () => 1_786_550_400_000);
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    health: provider,
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
  });
  const get = await handler(new Request("http://cache.test/health"));
  assertEquals(get.status, 200);
  assertEquals(await get.json(), {
    timestamp: "2026-08-12T16:00:00.000Z",
    process: { status: "ok", reasons: [] },
    read: { status: "ok", reasons: [] },
    write: { status: "blocked", reasons: ["no_complete_replica"] },
  });
  const head = await handler(
    new Request("http://cache.test/health", { method: "HEAD" }),
  );
  const getAgain = await handler(new Request("http://cache.test/health"));
  assertEquals(
    head.headers.get("content-length"),
    getAgain.headers.get("content-length"),
  );
  assertEquals(await head.text(), "");
  assertEquals(reads, 3);
});

Deno.test("staging failure diagnostic is typed secret-safe and non-authoritative", async () => {
  const lines: string[] = [];
  const sink = createConsoleDiagnosticSink({
    write: (line) => lines.push(line),
    now: () => 0,
  });
  const repository = {
    stage: () => Promise.reject(new Error("path-secret body-secret")),
  } as unknown as WriteRepository;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
    operationalDiagnostics: sink,
    write: { current: () => ({ ready: true, repository }) },
  });
  const response = await handler(
    new Request("http://cache.test/nar/fail.nar", {
      method: "PUT",
      body: "body-secret",
    }),
  );
  assertEquals(response.status, 503);
  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0], "upload staging failed: staging_unavailable");
  assertStringIncludes(lines[1], "PUT /nar/fail.nar -> 503");
  assertEquals(lines.some((line) => line.includes("secret")), false);

  const throwing = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
    operationalDiagnostics: {
      emit: () => {
        throw new Error("sink-secret");
      },
    },
    write: { current: () => ({ ready: true, repository }) },
  });
  assertEquals(
    (await throwing(
      new Request("http://cache.test/nar/fail.nar", {
        method: "PUT",
        body: "x",
      }),
    )).status,
    503,
  );
});

Deno.test("empty cache preflight logs actionable write readiness reasons", async () => {
  const lines: string[] = [];
  const sink = createConsoleDiagnosticSink({
    write: (line) => lines.push(line),
    now: () => 0,
  });
  const health = createHealthSnapshotProvider(() =>
    healthInputs({
      read: { selectedPublications: 0, overlayEntries: 0 },
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "ready",
        signerOwned: true,
        activationStatus: "failed",
        destinations: 1,
        relays: 1,
      },
    }), () => 0);
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    health,
    operationalDiagnostics: sink,
    selection: { current: () => Object.freeze([]) },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
    write: { current: () => ({ ready: false }) },
  });
  const response = await handler(
    new Request("http://cache.test/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  assertEquals(response.status, 503);
  assertEquals(lines.length, 1);
  assertStringIncludes(
    lines[0],
    "GET /0123456789abcdfghijklmnpqrsvwxyz.narinfo -> 503",
  );
  assertStringIncludes(
    lines[0],
    "reason=no_read_sources,write_activation_failed",
  );
});

Deno.test("health state matrix is deterministic and independent", () => {
  const cases: Array<[Partial<HealthInputs>, unknown]> = [
    [{ write: { enabled: false } }, {
      status: "disabled",
      reasons: ["write_disabled"],
    }],
    [{ read: { selectedPublications: 0, overlayEntries: 0 } }, {
      status: "unavailable",
      reasons: ["no_read_sources"],
    }],
    [{ process: { repositoryHealthy: false } }, {
      status: "failed",
      reasons: ["repository_unavailable"],
    }],
    [{
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "connecting",
        signerOwned: false,
        destinations: 1,
        relays: 1,
      },
    }, { status: "blocked", reasons: ["signer_connecting"] }],
    [{
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "ready",
        signerOwned: true,
        destinations: 0,
        relays: 0,
      },
    }, {
      status: "blocked",
      reasons: ["no_blossom_destination", "no_publication_relay"],
    }],
    [{
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "ready",
        signerOwned: true,
        destinations: 1,
        relays: 1,
        publication: { phase: "repairing", completeReplica: true },
      },
    }, { status: "repairing", reasons: ["repair_pending"] }],
    [{
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "ready",
        signerOwned: true,
        destinations: 1,
        relays: 1,
        publication: { phase: "idle", completeReplica: true },
      },
    }, { status: "ready", reasons: [] }],
  ];
  for (const [override, expected] of cases) {
    const input = healthInputs(override);
    const snapshot = createHealthSnapshotProvider(() => input, () => 0)
      .current();
    const axis = "process" in override
      ? snapshot.process
      : "read" in override
      ? snapshot.read
      : snapshot.write;
    assertEquals(axis, expected);
  }
});

Deno.test("diagnostic taxonomy is closed, allow-listed, and sink failures are contained", () => {
  const lines: string[] = [];
  const sink = createConsoleDiagnosticSink({
    write: (line) => lines.push(line),
    now: () => 0,
  });
  const events: OperationalDiagnostic[] = [
    {
      type: "event_rejection",
      code: "invalid_event",
      eventId: "e",
      cacheIdentity: "i",
    },
    {
      type: "merge_conflict",
      code: "narinfo_semantic_conflict",
      storePathHash: "h",
      winnerIdentity: "w",
      loserIdentity: "l",
      differingFields: ["URL"],
    },
    {
      type: "upstream_failure",
      code: "upstream_timeout",
      endpoint: "https://example.test/x",
      attempt: 1,
      durationMs: 2,
    },
    {
      type: "signer_transition",
      code: "signer_ready",
      status: "ready",
      cacheIdentity: "i",
    },
    { type: "batch_transition", code: "batch_pending", batchId: 3, count: 2 },
    {
      type: "publication_stage",
      code: "authorization_failed",
      stage: "authorization",
      status: "failed",
      batchId: 3,
      rootHash: "a".repeat(64),
      count: 2,
    },
    {
      type: "replica_attempt",
      code: "replica_complete",
      endpoint: "https://example.test",
      attempt: 1,
      count: 2,
      durationMs: 3,
      ok: true,
    },
    {
      type: "relay_acknowledgement",
      code: "relay_acknowledged",
      endpoint: "wss://relay.test",
      attempt: 1,
      ok: true,
    },
    {
      type: "promotion",
      code: "publication_promoted",
      batchId: 3,
      eventId: "e",
      rootHash: "h",
    },
    {
      type: "blossom_server_list",
      code: "write_server_list_changed",
      count: 1,
      endpoints: ["https://user:secret@example.test/base?token=hidden#part"],
    },
    {
      type: "write_relay_list",
      code: "write_relay_list_found",
      count: 2,
      configuredCount: 1,
      outboxCount: 1,
      endpoints: [
        "wss://user:secret@relay.test/path?token=hidden#part",
        "wss://outbox.test",
      ],
    },
    {
      type: "writable_identity_mismatch",
      code: "durable_writable_identity_mismatch",
      configuredIdentity: `17091:${"a".repeat(64)}:`,
      durableIdentity: `17091:${"b".repeat(64)}:`,
    },
  ];
  for (const event of events) sink.emit(event);
  assertEquals(lines.length, events.length);
  assertStringIncludes(lines[0], "Nostr event rejected: invalid_event");
  assertStringIncludes(lines[1], "narinfo publisher conflict");
  assertStringIncludes(lines[2], "upstream request failed: upstream_timeout");
  assertStringIncludes(lines[3], "signer ready: signer_ready");
  assertStringIncludes(lines[4], "publication batch: batch_pending");
  assertStringIncludes(
    lines[5],
    "publication authorization failed: authorization_failed",
  );
  assertStringIncludes(lines[6], "Blossom replica succeeded: replica_complete");
  assertStringIncludes(lines[7], "relay publication acknowledged");
  assertStringIncludes(lines[8], "cache publication promoted");
  assertStringIncludes(lines[9], "write Blossom server list changed");
  assertStringIncludes(lines[9], "endpoints=https://example.test/base");
  assertEquals(lines[9].includes("secret"), false);
  assertEquals(lines[9].includes("hidden"), false);
  assertStringIncludes(lines[10], "write relay list found");
  assertStringIncludes(lines[10], "configured=1");
  assertStringIncludes(lines[10], "outboxes=1");
  assertStringIncludes(
    lines[10],
    "endpoints=wss://relay.test/path,wss://outbox.test",
  );
  assertEquals(lines[10].includes("secret"), false);
  assertEquals(lines[10].includes("hidden"), false);
  assertStringIncludes(
    lines[11],
    "WRITABLE CACHE OWNER MISMATCH — WRITES HAVE BEEN DISABLED",
  );
  assertStringIncludes(
    lines[11],
    `Configured signer: 17091:${"a".repeat(64)}:`,
  );
  assertStringIncludes(
    lines[11],
    `Durable owner:     17091:${"b".repeat(64)}:`,
  );
  assertStringIncludes(lines[11], "writable.enabled was honored");
  assertStringIncludes(lines[11], "PUT is disabled");
  assertStringIncludes(lines[11], "Do not delete state casually");
  const failing = createConsoleDiagnosticSink({
    write: () => {
      throw new Error("sink failed");
    },
  });
  failing.emit(events[0]);
});

Deno.test("health GET and HEAD never touch work-producing dependencies", async () => {
  const calls = { selection: 0, resolve: 0, write: 0, sign: 0, network: 0 };
  const provider = createHealthSnapshotProvider(() =>
    healthInputs({
      write: {
        enabled: true,
        repositoryHealthy: true,
        signerStatus: "ready",
        signerOwned: true,
        destinations: 1,
        relays: 1,
        publication: { phase: "idle", completeReplica: true },
      },
    }), () => 0);
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 1024,
    health: provider,
    selection: {
      current: () => {
        calls.selection++;
        return Object.freeze([]);
      },
    },
    resolverFor: () => ({
      resolve: () => {
        calls.resolve++;
        return Promise.reject(new Error("health attempted resolution"));
      },
    }),
    write: {
      current: () => {
        calls.write++;
        throw new Error("health attempted write readiness");
      },
    },
  });
  for (let index = 0; index < 20; index++) {
    const method = index % 2 ? "HEAD" : "GET";
    assertEquals(
      (await handler(new Request("http://cache.test/health", { method })))
        .status,
      200,
    );
  }
  assertEquals(calls, {
    selection: 0,
    resolve: 0,
    write: 0,
    sign: 0,
    network: 0,
  });
  assertEquals(
    (await handler(new Request("http://cache.test/health", { method: "POST" })))
      .status,
    405,
  );
});

Deno.test("serializer does not inspect unknown properties or recursive errors", () => {
  const lines: string[] = [];
  let touched = 0;
  const hostile = Object.defineProperties({
    type: "upstream_failure",
    code: "upstream_unavailable",
    endpoint: "https://user:pass@example.test/blob?authorization=secret#cookie",
    attempt: 4,
    durationMs: 8,
  }, {
    cause: {
      enumerable: true,
      get: () => {
        touched++;
        throw new Error("cause-secret");
      },
    },
    headers: {
      enumerable: true,
      get: () => {
        touched++;
        throw new Error("header-secret");
      },
    },
    body: {
      enumerable: true,
      get: () => {
        touched++;
        throw new Error("body-secret");
      },
    },
  }) as OperationalDiagnostic;
  createConsoleDiagnosticSink({
    write: (line) => lines.push(line),
    now: () => 0,
  })
    .emit(hostile);
  assertEquals(touched, 0);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes("secret"), false);
});
