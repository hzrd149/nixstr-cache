import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseConfig, type RawConfig } from "../../src/config/config.ts";
import {
  collectRawConfigFromEnvironment,
  rawConfigFromEnvironment,
} from "../../main.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import { Subject } from "rxjs";
import type { RawPublication } from "../../src/protocol/publication.ts";

const PUBKEY = "a".repeat(64);
const SECOND_PUBKEY = "b".repeat(64);

function validRaw(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    publisherPubkeys: PUBKEY,
    relayUrls: "wss://relay.example",
    databasePath: "/tmp/nixstr-operator.sqlite",
    spoolDirectory: "/tmp/nixstr-operator-spool",
    ...overrides,
  };
}

Deno.test("operator config preserves canonical ordered default and named identities", () => {
  const identities = [
    `17091:${PUBKEY}:`,
    `37091:${SECOND_PUBKEY}:Nixpkgs-Unstable`,
  ];
  const parsed = parseConfig(validRaw({
    cacheIdentities: identities.join(","),
    publisherPubkeys: undefined,
  }));
  assert(parsed.ok);
  assertEquals(parsed.value.identities, identities);
  assertEquals(parsed.value.publisherPubkeys, [PUBKEY, SECOND_PUBKEY]);
  assert(Object.isFrozen(parsed.value.identities));
});

Deno.test("operator config rejects malformed duplicate and excessive identities before side effects", () => {
  const invalidLists = [
    [`17091:${PUBKEY}:`, `17091:${PUBKEY}:`],
    [`17092:${PUBKEY}:`],
    [`17091:${PUBKEY}:named`],
    [`37091:${PUBKEY}:`],
    [`37091:${PUBKEY}:named:extra`],
    [`17091:${PUBKEY.toUpperCase()}:`],
    Array.from(
      { length: 33 },
      (_, index) => `37091:${PUBKEY}:cache-${index}`,
    ),
  ];
  for (const identities of invalidLists) {
    let sideEffects = 0;
    const parsed = parseConfig(
      validRaw({
        cacheIdentities: identities.join(","),
        publisherPubkeys: undefined,
      }),
      { onSideEffect: () => sideEffects++ },
    );
    assert(!parsed.ok, identities.join(","));
    assertEquals(sideEffects, 0);
    assert(
      parsed.diagnostics.some((diagnostic) =>
        diagnostic.field.startsWith("cacheIdentities")
      ),
    );
  }
});

Deno.test("environment mapper preserves ordered cache identities", () => {
  const value = `17091:${PUBKEY}:,37091:${SECOND_PUBKEY}:named`;
  assertEquals(
    rawConfigFromEnvironment({ NIXSTR_CACHE_IDENTITIES: value })
      .cacheIdentities,
    value,
  );
});

Deno.test("local cache configuration is optional exact and side-effect free", () => {
  const absent = parseConfig(validRaw());
  assert(absent.ok);
  assertEquals(absent.value.localBlossomUrl, undefined);

  const mapped = rawConfigFromEnvironment({
    NIXSTR_LOCAL_BLOSSOM_URL: "http://127.0.0.1:3000",
  });
  assertEquals(mapped.localBlossomUrl, "http://127.0.0.1:3000");
  const present = parseConfig(validRaw({
    localBlossomUrl: mapped.localBlossomUrl,
  }));
  assert(present.ok);
  assertEquals(present.value.localBlossomUrl?.origin, "http://127.0.0.1:3000");

  let sideEffects = 0;
  const invalid = parseConfig(
    validRaw({ localBlossomUrl: "http://secret@127.0.0.1:3000" }),
    { onSideEffect: () => sideEffects++ },
  );
  assert(!invalid.ok);
  assertEquals(sideEffects, 0);
  assertEquals(invalid.diagnostics[0].field, "localBlossomUrl");
});

Deno.test("operator config defaults to explicit read-only write intent", () => {
  for (const raw of [validRaw(), validRaw({ signerMode: "disabled" })]) {
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent, { mode: "disabled" });
  }
});

Deno.test("operator config parses complete supported write intents", () => {
  const cases = [
    ["nip46", `17091:${PUBKEY}:`, 17091, ""],
    ["local", `37091:${PUBKEY}:nixpkgs-unstable`, 37091, "nixpkgs-unstable"],
  ] as const;
  for (const [mode, writableIdentity, kind, identifier] of cases) {
    const parsed = parseConfig(
      validRaw({
        signerMode: mode,
        writableIdentity,
        localKeyPath: mode === "local" ? "/tmp/key" : undefined,
        nip46SessionPath: mode === "nip46" ? "/tmp/session" : undefined,
        stagingDirectory: "/tmp/staging",
      }),
    );
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent, {
      mode,
      identity: { kind, pubkey: PUBKEY, identifier },
    });
  }
});

Deno.test("operator config rejects partial contradictory and malformed write intent", () => {
  const invalid = [
    { signerMode: "disabled", writableIdentity: `17091:${PUBKEY}:` },
    { signerMode: "nip46" },
    { writableIdentity: `17091:${PUBKEY}:` },
    { signerMode: "other", writableIdentity: `17091:${PUBKEY}:` },
    { signerMode: "local", writableIdentity: `17092:${PUBKEY}:` },
    { signerMode: "local", writableIdentity: `17091:${PUBKEY}:name` },
    { signerMode: "local", writableIdentity: `37091:${PUBKEY}:` },
    { signerMode: "local", writableIdentity: `37091:${PUBKEY}:name:extra` },
    { signerMode: "local", writableIdentity: `17091:${PUBKEY.toUpperCase()}:` },
    { signerMode: "local", writableIdentity: `17091:${PUBKEY.slice(1)}:` },
  ];
  for (const overrides of invalid) {
    const parsed = parseConfig(validRaw(overrides));
    assert(!parsed.ok, JSON.stringify(overrides));
    assert(
      parsed.diagnostics.some((diagnostic) =>
        diagnostic.field === "signerMode" ||
        diagnostic.field === "writableIdentity"
      ),
    );
  }
});

Deno.test("write-intent diagnostics aggregate without side effects", () => {
  let sideEffects = 0;
  const parsed = parseConfig({
    ...validRaw({ signerMode: "nip46" }),
    bindPort: "0",
    relayUrls: "invalid",
  }, { onSideEffect: () => sideEffects++ });
  assert(!parsed.ok);
  assertEquals(sideEffects, 0);
  assert(
    parsed.diagnostics.some((diagnostic) => diagnostic.field === "bindPort"),
  );
  assert(
    parsed.diagnostics.some((diagnostic) =>
      diagnostic.field === "relayUrls[0]"
    ),
  );
  assert(
    parsed.diagnostics.some((diagnostic) =>
      diagnostic.field === "writableIdentity"
    ),
  );
});

Deno.test("environment mapper preserves signer write-intent fields", () => {
  assertEquals(rawConfigFromEnvironment({}).signerMode, undefined);
  assertEquals(rawConfigFromEnvironment({}).writableIdentity, undefined);
  const mapped = rawConfigFromEnvironment({
    NIXSTR_SIGNER_MODE: "nip46",
    NIXSTR_WRITABLE_IDENTITY: `37091:${PUBKEY}:named`,
  });
  assertEquals(mapped.signerMode, "nip46");
  assertEquals(mapped.writableIdentity, `37091:${PUBKEY}:named`);
});

Deno.test("enabled signer requires exactly its protected source and staging limits", () => {
  const local = parseConfig(validRaw({
    signerMode: "local",
    writableIdentity: `17091:${PUBKEY}:`,
    localKeyPath: "/tmp/key",
    stagingDirectory: "/tmp/staging",
    stagingBodyBytes: "1024",
    stagingAggregateBytes: "4096",
  }));
  assert(local.ok);
  assertEquals(local.value.localKeyPath, "/tmp/key");
  const missing = parseConfig(
    validRaw({ signerMode: "local", writableIdentity: `17091:${PUBKEY}:` }),
  );
  assert(!missing.ok);
  const contradictory = parseConfig(validRaw({
    signerMode: "local",
    writableIdentity: `17091:${PUBKEY}:`,
    localKeyPath: "/tmp/key",
    nip46SessionPath: "/tmp/session",
    stagingDirectory: "/tmp/staging",
    stagingBodyBytes: "1024",
    stagingAggregateBytes: "4096",
  }));
  assert(!contradictory.ok);
});

Deno.test("production environment collector maps every supported limit", () => {
  const environment = {
    NIXSTR_PUBLISHER_PUBKEYS: PUBKEY,
    NIXSTR_RELAY_URLS: "wss://relay.example",
    NIXSTR_DATABASE_PATH: "/tmp/nixstr-limit-state.sqlite",
    NIXSTR_SPOOL_DIRECTORY: "/tmp/nixstr-limit-spool",
    NIXSTR_LIMIT_MANIFEST_WIRE_BYTES: "1000001",
    NIXSTR_LIMIT_DECODED_METADATA_BYTES: "100002",
    NIXSTR_LIMIT_BLOB_TRANSFER_BYTES: "10000003",
    NIXSTR_LIMIT_REQUEST_TRANSFER_BYTES: "100000004",
    NIXSTR_LIMIT_REQUEST_OUTPUT_BYTES: "100000005",
    NIXSTR_LIMIT_TRAVERSAL_DEPTH: "26",
    NIXSTR_LIMIT_LINKS_PER_NODE: "127",
    NIXSTR_LIMIT_UNIQUE_MANIFEST_NODES: "1028",
    NIXSTR_LIMIT_TOTAL_DECODED_MANIFEST_BYTES: "10000009",
    NIXSTR_LIMIT_SOURCE_ATTEMPTS: "11",
    NIXSTR_LIMIT_MAX_REDIRECTS: "4",
    NIXSTR_LIMIT_CONNECT_TIMEOUT_MS: "5001",
    NIXSTR_LIMIT_IDLE_TIMEOUT_MS: "30002",
    NIXSTR_LIMIT_TOTAL_TIMEOUT_MS: "300003",
    NIXSTR_LIMIT_CONCURRENT_FETCHES: "9",
  } as const;
  const requested: string[] = [];
  const raw = collectRawConfigFromEnvironment((name) => {
    requested.push(name);
    return environment[name as keyof typeof environment];
  });
  const parsed = parseConfig(raw);
  assert(parsed.ok);
  assertEquals(parsed.value.limits, {
    manifestWireBytes: 1000001,
    decodedMetadataBytes: 100002,
    blobTransferBytes: 10000003,
    requestTransferBytes: 100000004,
    requestOutputBytes: 100000005,
    traversalDepth: 26,
    linksPerNode: 127,
    uniqueManifestNodes: 1028,
    totalDecodedManifestBytes: 10000009,
    sourceAttempts: 11,
    maxRedirects: 4,
    connectTimeoutMs: 5001,
    idleTimeoutMs: 30002,
    totalTimeoutMs: 300003,
    concurrentFetches: 9,
  });
  for (const name of Object.keys(environment)) assert(requested.includes(name));
});

Deno.test("invalid collected production limit stops before startup", () => {
  const root = `/tmp/nixstr-limit-invalid-${crypto.randomUUID()}`;
  const environment: Record<string, string> = {
    NIXSTR_PUBLISHER_PUBKEYS: PUBKEY,
    NIXSTR_RELAY_URLS: "wss://relay.example",
    NIXSTR_DATABASE_PATH: `${root}/state.sqlite`,
    NIXSTR_SPOOL_DIRECTORY: `${root}/spool`,
    NIXSTR_LIMIT_MAX_REDIRECTS: "not-an-integer",
  };
  const calls: string[] = [];
  const result = launchDaemon(
    collectRawConfigFromEnvironment((name) => environment[name]),
    {
      createEventStream: () => {
        calls.push("relay");
        return { events: new Subject<RawPublication>(), dispose() {} };
      },
      bind: () => {
        calls.push("listener");
        return { shutdown: () => Promise.resolve() };
      },
      signals: [],
    },
  );
  assert(!result.ok);
  assert(
    result.diagnostics.some((diagnostic) =>
      diagnostic.includes("limits.maxRedirects") &&
      diagnostic.includes("positive integer")
    ),
  );
  assertEquals(calls, []);
  assertThrows(() => Deno.statSync(root), Deno.errors.NotFound);
});

Deno.test("partial environment write intent stops before startup side effects", () => {
  const root = `/tmp/nixstr-partial-${crypto.randomUUID()}`;
  const calls: string[] = [];
  const result = launchDaemon({
    ...validRaw({
      databasePath: `${root}/state.sqlite`,
      spoolDirectory: `${root}/spool`,
    }),
    ...rawConfigFromEnvironment({ NIXSTR_SIGNER_MODE: "local" }),
  }, {
    createEventStream: () => {
      calls.push("relay");
      return { events: new Subject<RawPublication>(), dispose() {} };
    },
    bind: () => {
      calls.push("listener");
      return { shutdown: () => Promise.resolve() };
    },
    signals: [],
  });
  assert(!result.ok);
  assertEquals(calls, []);
  assertThrows(() => Deno.statSync(root), Deno.errors.NotFound);
});

Deno.test("configured write intent stays disabled until ownership is ready", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-intent-" });
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  try {
    await Deno.writeFile(`${root}/key`, new Uint8Array(32).fill(1), {
      mode: 0o600,
    });
    const result = launchDaemon(
      validRaw({
        databasePath: `${root}/state.sqlite`,
        spoolDirectory: `${root}/spool`,
        signerMode: "local",
        writableIdentity: `17091:${PUBKEY}:`,
        localKeyPath: `${root}/key`,
        stagingDirectory: `${root}/staging`,
      }),
      {
        createEventStream: () => ({
          events: new Subject<RawPublication>(),
          dispose() {},
        }),
        bind: (createdHandler) => {
          handler = createdHandler;
          return { shutdown: () => Promise.resolve() };
        },
        signals: [],
      },
    );
    assert(result.ok);
    assert(handler);
    const response = await handler(
      new Request("http://cache/nix-cache-info", {
        method: "PUT",
        body: "payload",
      }),
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
    await result.shutdown();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
