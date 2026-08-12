import {
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import {
  createJsonDiagnosticSink,
  type OperationalDiagnostic,
} from "../../src/operations/diagnostics.ts";
import {
  createHealthSnapshotProvider,
  type HealthInputs,
} from "../../src/operations/health.ts";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";

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
  const sink = createJsonDiagnosticSink({
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
  sink.emit({
    type: "replica_attempt",
    code: "replica_unavailable",
    cacheIdentity: `17091:${"a".repeat(64)}:`,
    rootHash: "b".repeat(64),
    endpoint:
      `https://user:password@example.test/upload?token=${secretCorpus[8]}#fragment`,
    attempt: 2,
    count: 5,
    durationMs: 37,
    ok: false,
    ...hostile,
  } as OperationalDiagnostic & typeof hostile);
  assertEquals(lines.length, 1);
  const encoded = lines[0];
  assertStringIncludes(encoded, '"type":"replica_attempt"');
  assertStringIncludes(encoded, '"endpoint":"https://example.test/upload"');
  for (const secret of secretCorpus) assertEquals(encoded.includes(secret), false);
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
  const head = await handler(new Request("http://cache.test/health", { method: "HEAD" }));
  const getAgain = await handler(new Request("http://cache.test/health"));
  assertEquals(head.headers.get("content-length"), getAgain.headers.get("content-length"));
  assertEquals(await head.text(), "");
  assertEquals(reads, 3);
});

Deno.test("health state matrix is deterministic and independent", () => {
  const cases: Array<[Partial<HealthInputs>, unknown]> = [
    [{ write: { enabled: false } }, { status: "disabled", reasons: ["write_disabled"] }],
    [{ read: { selectedPublications: 0, overlayEntries: 0 } }, { status: "unavailable", reasons: ["no_read_sources"] }],
    [{ process: { repositoryHealthy: false } }, { status: "failed", reasons: ["repository_unavailable"] }],
    [{ write: { enabled: true, repositoryHealthy: true, signerStatus: "connecting", signerOwned: false, destinations: 1, relays: 1 } }, { status: "blocked", reasons: ["signer_connecting"] }],
    [{ write: { enabled: true, repositoryHealthy: true, signerStatus: "ready", signerOwned: true, destinations: 0, relays: 0 } }, { status: "blocked", reasons: ["no_blossom_destination", "no_publication_relay"] }],
    [{ write: { enabled: true, repositoryHealthy: true, signerStatus: "ready", signerOwned: true, destinations: 1, relays: 1, publication: { phase: "repairing", completeReplica: true } } }, { status: "repairing", reasons: ["repair_pending"] }],
    [{ write: { enabled: true, repositoryHealthy: true, signerStatus: "ready", signerOwned: true, destinations: 1, relays: 1, publication: { phase: "idle", completeReplica: true } } }, { status: "ready", reasons: [] }],
  ];
  for (const [override, expected] of cases) {
    const input = healthInputs(override);
    const snapshot = createHealthSnapshotProvider(() => input, () => 0).current();
    const axis = "process" in override ? snapshot.process : "read" in override ? snapshot.read : snapshot.write;
    assertEquals(axis, expected);
  }
});

Deno.test("diagnostic taxonomy is closed, allow-listed, and sink failures are contained", () => {
  const lines: string[] = [];
  const sink = createJsonDiagnosticSink({ write: (line) => lines.push(line), now: () => 0 });
  const events: OperationalDiagnostic[] = [
    { type: "event_rejection", code: "invalid_event", eventId: "e", cacheIdentity: "i" },
    { type: "merge_conflict", code: "narinfo_semantic_conflict", storePathHash: "h", winnerIdentity: "w", loserIdentity: "l", differingFields: ["URL"] },
    { type: "upstream_failure", code: "upstream_timeout", endpoint: "https://example.test/x", attempt: 1, durationMs: 2 },
    { type: "signer_transition", code: "signer_ready", status: "ready", cacheIdentity: "i" },
    { type: "batch_transition", code: "batch_pending", batchId: 3, count: 2 },
    { type: "replica_attempt", code: "replica_complete", endpoint: "https://example.test", attempt: 1, count: 2, durationMs: 3, ok: true },
    { type: "relay_acknowledgement", code: "relay_acknowledged", endpoint: "wss://relay.test", attempt: 1, ok: true },
    { type: "promotion", code: "publication_promoted", batchId: 3, eventId: "e", rootHash: "h" },
  ];
  for (const event of events) sink.emit(event);
  assertEquals(lines.map((line) => JSON.parse(line).type), events.map((event) => event.type));
  const failing = createJsonDiagnosticSink({ write: () => { throw new Error("sink failed"); } });
  failing.emit(events[0]);
});
