import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parseConfig, type RawConfig } from "../../src/config/config.ts";
import {
  collectRawConfigFromEnvironment,
  loadStartupConfig,
  rawConfigFromEnvironment,
} from "../../main.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import { Subject } from "rxjs";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { encrypt } from "nostr-tools/nip49";
import { NostrConnectSigner } from "applesauce-signers";
import type { RawPublication } from "../../src/protocol/publication.ts";

const PUBKEY = "a".repeat(64);
const SECOND_PUBKEY = "b".repeat(64);

const JSON_CONFIG = {
  caches: [`17091:${PUBKEY}:`],
  extraRelays: ["wss://relay.example"],
  databasePath: "state.sqlite",
  spoolDirectory: "spool",
  bindPort: 9876,
  writable: { enabled: false },
  limits: { maxRedirects: 5, sourceAttempts: 12 },
};

function validRaw(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    caches: PUBKEY,
    extraRelays: "wss://relay.example",
    databasePath: "/tmp/nixstr-operator.sqlite",
    spoolDirectory: "/tmp/nixstr-operator-spool",
    ...overrides,
  };
}

Deno.test("startup loader reads native JSON and resolves file-owned paths", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-config-" });
  try {
    const path = `${root}/operator/config.json`;
    await Deno.mkdir(`${root}/operator`);
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        ...JSON_CONFIG,
        writable: { enabled: false, signer: { path: 42 } },
      }),
    );
    const raw = await loadStartupConfig(["--config", path], {
      readEnvironment: () => undefined,
    });
    assertEquals(raw.databasePath, `${root}/operator/state.sqlite`);
    assertEquals(raw.spoolDirectory, `${root}/operator/spool`);
    assertEquals(raw.writable?.enabled, false);
    const parsed = parseConfig(raw);
    assert(parsed.ok); // Disabled mode ignores every other writable member.
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("startup loader applies environment overrides member-wise", async () => {
  const environment: Record<string, string> = {
    NIXSTR_BIND_PORT: "8788",
    NIXSTR_DATABASE_PATH: "/env/state.sqlite",
    NIXSTR_LIMIT_MAX_REDIRECTS: "7",
  };
  const raw = await loadStartupConfig(["--config", "/etc/nixstr/config.json"], {
    readTextFile: () => Promise.resolve(JSON.stringify(JSON_CONFIG)),
    readEnvironment: (name) => environment[name],
  });
  assertEquals(raw.bindPort, "8788");
  assertEquals(raw.databasePath, "/env/state.sqlite");
  assertEquals(raw.spoolDirectory, "/etc/nixstr/spool");
  assertEquals(raw.limits?.maxRedirects, "7");
  assertEquals(raw.limits?.sourceAttempts, 12);
  const parsed = parseConfig(raw);
  assert(parsed.ok);
  assertEquals(parsed.value.bindPort, 8788);
  assertEquals(parsed.value.limits.maxRedirects, 7);
  assertEquals(parsed.value.limits.sourceAttempts, 12);
});

Deno.test("disabled environment override ignores malformed writable JSON", async () => {
  const raw = await loadStartupConfig(["--config", "/tmp/config.json"], {
    readTextFile: () =>
      Promise.resolve(JSON.stringify({
        ...JSON_CONFIG,
        writable: { enabled: true, unknown: true, signer: 42 },
      })),
    readEnvironment: (name) =>
      name === "NIXSTR_WRITABLE_ENABLED" ? "false" : undefined,
  });
  const parsed = parseConfig(raw);
  assert(parsed.ok);
  assertEquals(parsed.value.writable, { enabled: false });
});

Deno.test("startup loader preserves commas inside native JSON list entries", async () => {
  const identity = `37091:${PUBKEY}:cache,development`;
  const raw = await loadStartupConfig(["--config", "/tmp/config.json"], {
    readTextFile: () =>
      Promise.resolve(JSON.stringify({
        ...JSON_CONFIG,
        caches: [identity],
        extraServers: ["https://blossom.example/path,segment"],
      })),
    readEnvironment: () => undefined,
  });
  assertEquals(raw.caches, [identity]);
  const parsed = parseConfig(raw);
  assert(parsed.ok);
  assertEquals(parsed.value.identities, [identity]);
  assertEquals(
    parsed.value.extraServers.map((url) => url.href),
    ["https://blossom.example/path,segment"],
  );
});

Deno.test("extra Blossom servers preserve order and reject invalid entries", () => {
  const parsed = parseConfig(validRaw({
    extraServers: [
      "https://one.example/base/",
      "http://127.0.0.1:24242",
    ],
  }));
  assert(parsed.ok);
  assertEquals(parsed.value.extraServers.map(String), [
    "https://one.example/base",
    "http://127.0.0.1:24242/",
  ]);

  for (
    const extraServers of [
      ["https://one.example", "https://one.example/"],
      ["ftp://one.example"],
      ["https://user@one.example"],
      ["https://one.example/?query=yes"],
      ["https://one.example/#fragment"],
    ]
  ) {
    const invalid = parseConfig(validRaw({ extraServers }));
    assert(!invalid.ok);
    assert(
      invalid.diagnostics.some((item) => item.field.startsWith("extraServers")),
    );
  }
});

Deno.test("legacy preferred Blossom configuration is rejected", async () => {
  await assertRejects(
    () =>
      loadStartupConfig(["--config", "/tmp/config.json"], {
        readTextFile: () =>
          Promise.resolve(JSON.stringify({
            ...JSON_CONFIG,
            preferredBlossomUrl: "https://blossom.example",
          })),
        readEnvironment: () => undefined,
      }),
    Error,
    "unknown config field preferredBlossomUrl",
  );
  assertThrows(
    () =>
      rawConfigFromEnvironment({
        NIXSTR_PREFERRED_BLOSSOM_URL: "https://blossom.example",
      }),
    Error,
    "use NIXSTR_EXTRA_SERVERS",
  );
});

Deno.test("startup loader retains environment-only operation and absolute env paths", async () => {
  const environment: Record<string, string> = {
    NIXSTR_CACHES: `17091:${PUBKEY}:`,
    NIXSTR_EXTRA_RELAYS: "wss://relay.example",
    NIXSTR_DATABASE_PATH: "/env/state.sqlite",
    NIXSTR_SPOOL_DIRECTORY: "/env/spool",
  };
  const raw = await loadStartupConfig([], {
    readEnvironment: (name) => environment[name],
  });
  const parsed = parseConfig(raw);
  assert(parsed.ok);
  assertEquals(parsed.value.databasePath, "/env/state.sqlite");
});

Deno.test("startup loader rejects malformed CLI files and native JSON types", async () => {
  const cases: Array<[string[], string, string]> = [
    [["--config"], "{}", "requires a path"],
    [["--other"], "{}", "unsupported argument"],
    [["--config", "/tmp/config.json"], "{", "valid JSON"],
    [["--config", "/tmp/config.json"], "[]", "JSON object"],
  ];
  for (const [args, content, message] of cases) {
    let error: unknown;
    try {
      await loadStartupConfig(args, {
        readTextFile: () => Promise.resolve(content),
        readEnvironment: () => undefined,
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error);
    assert(error.message.includes(message), error.message);
  }

  for (
    const [field, value] of [
      ["extraRelays", ["wss://relay.example", 1]],
      ["bindPort", "not-a-port"],
      ["writable", true],
      ["limits", { maxRedirects: "5" }],
    ] as const
  ) {
    let error: unknown;
    try {
      await loadStartupConfig(["--config", "/tmp/config.json"], {
        readTextFile: () =>
          Promise.resolve(JSON.stringify({
            ...JSON_CONFIG,
            [field]: value,
          })),
        readEnvironment: () => undefined,
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error);
    assert(error.message.includes(field), error.message);
  }

  for (
    const config of [
      { ...JSON_CONFIG, relayUrl: ["wss://typo.example"] },
      { ...JSON_CONFIG, limits: { redirectCount: 3 } },
      {
        ...JSON_CONFIG,
        caches: undefined,
        cacheIdentities: [PUBKEY],
      },
      {
        ...JSON_CONFIG,
        caches: undefined,
        publisherPubkeys: [PUBKEY],
      },
    ]
  ) {
    let error: unknown;
    try {
      await loadStartupConfig(["--config", "/tmp/config.json"], {
        readTextFile: () => Promise.resolve(JSON.stringify(config)),
        readEnvironment: () => undefined,
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error);
    assert(error.message.includes("unknown config field"), error.message);
  }
});

Deno.test("invalid loaded config reaches no daemon startup side effects", async () => {
  const root = `/tmp/nixstr-json-invalid-${crypto.randomUUID()}`;
  const raw = await loadStartupConfig(["--config", `${root}/config.json`], {
    readTextFile: () =>
      Promise.resolve(JSON.stringify({
        ...JSON_CONFIG,
        databasePath: "state.sqlite",
        spoolDirectory: "spool",
        limits: { maxRedirects: 0 },
      })),
    readEnvironment: () => undefined,
  });
  const calls: string[] = [];
  const result = await launchDaemon(raw, {
    createEventStream: () => {
      calls.push("relay");
      return { events: new Subject<RawPublication>(), close() {} };
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

Deno.test("operator config normalizes ordered read-cache identity forms", () => {
  const npub = nip19.npubEncode(SECOND_PUBKEY);
  const naddr = nip19.naddrEncode({
    kind: 37091,
    pubkey: PUBKEY,
    identifier: "Nixpkgs-Unstable",
    relays: ["wss://ignored.example"],
  });
  const identities = [
    PUBKEY,
    npub,
    `17091:${"c".repeat(64)}:`,
    `37091:${SECOND_PUBKEY}:development`,
    naddr,
  ];
  const parsed = parseConfig(validRaw({
    caches: identities,
  }));
  assert(parsed.ok);
  assertEquals(parsed.value.identities, [
    `17091:${PUBKEY}:`,
    `17091:${SECOND_PUBKEY}:`,
    `17091:${"c".repeat(64)}:`,
    `37091:${SECOND_PUBKEY}:development`,
    `37091:${PUBKEY}:Nixpkgs-Unstable`,
  ]);
  assertEquals(parsed.value.publisherPubkeys, [
    PUBKEY,
    SECOND_PUBKEY,
    "c".repeat(64),
  ]);
  assertEquals(parsed.value.extraRelays.map((url) => url.href), [
    "wss://relay.example/",
  ]);
  assertEquals(parsed.value.bootstrapRelays.map((url) => url.href), [
    "wss://purplepag.es/",
    "wss://index.hzrd149.com/",
  ]);
  assert(Object.isFrozen(parsed.value.identities));
});

Deno.test("operator can override bootstrap relays independently", () => {
  const parsed = parseConfig(validRaw({
    bootstrapRelays: ["wss://indexer.example"],
  }));
  assert(parsed.ok);
  assertEquals(parsed.value.bootstrapRelays.map((url) => url.href), [
    "wss://indexer.example/",
  ]);
  assertEquals(parsed.value.extraRelays.map((url) => url.href), [
    "wss://relay.example/",
  ]);
});

Deno.test("JSON and environment cache identities share normalization and priority", async () => {
  const npub = nip19.npubEncode(SECOND_PUBKEY);
  const fileRaw = await loadStartupConfig(["--config", "/tmp/config.json"], {
    readTextFile: () =>
      Promise.resolve(JSON.stringify({
        ...JSON_CONFIG,
        caches: [npub, PUBKEY],
      })),
    readEnvironment: () => undefined,
  });
  const environmentRaw = await loadStartupConfig([], {
    readEnvironment: (name) =>
      name === "NIXSTR_CACHES"
        ? `${npub},${PUBKEY}`
        : name === "NIXSTR_EXTRA_RELAYS"
        ? "wss://relay.example"
        : name === "NIXSTR_DATABASE_PATH"
        ? "/tmp/state.sqlite"
        : name === "NIXSTR_SPOOL_DIRECTORY"
        ? "/tmp/spool"
        : undefined,
  });
  for (const raw of [fileRaw, environmentRaw]) {
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    assertEquals(parsed.value.identities, [
      `17091:${SECOND_PUBKEY}:`,
      `17091:${PUBKEY}:`,
    ]);
    assertEquals(parsed.value.publisherPubkeys, [SECOND_PUBKEY, PUBKEY]);
  }
});

Deno.test("operator config rejects equivalent read-cache aliases", () => {
  const aliases = [
    PUBKEY,
    nip19.npubEncode(PUBKEY),
    `17091:${PUBKEY}:`,
  ];
  const parsed = parseConfig(validRaw({
    caches: aliases,
  }));
  assert(!parsed.ok);
  assertEquals(
    parsed.diagnostics.filter((item) =>
      item.message === "cache identities must be unique"
    ).map((item) => item.field),
    ["caches[1]", "caches[2]"],
  );
});

Deno.test("operator config rejects malformed duplicate and excessive identities before side effects", () => {
  const invalidLists = [
    [`17091:${PUBKEY}:`, `17091:${PUBKEY}:`],
    [`17092:${PUBKEY}:`],
    [`17091:${PUBKEY}:named`],
    [`37091:${PUBKEY}:`],
    [`37091:${PUBKEY}:named:extra`],
    [`17091:${PUBKEY.toUpperCase()}:`],
    [PUBKEY.toUpperCase()],
    [PUBKEY.slice(1)],
    ["npub1malformed"],
    [nip19.noteEncode(PUBKEY)],
    [nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: "named" })],
    [nip19.naddrEncode({
      kind: 37091,
      pubkey: PUBKEY,
      identifier: "bad name",
    })],
    [nip19.naddrEncode({
      kind: 37091,
      pubkey: PUBKEY,
      identifier: "x".repeat(65),
    })],
    [`37091:${nip19.npubEncode(PUBKEY)}:named`],
    Array.from(
      { length: 33 },
      (_, index) => `37091:${PUBKEY}:cache-${index}`,
    ),
  ];
  for (const identities of invalidLists) {
    let sideEffects = 0;
    const parsed = parseConfig(
      validRaw({
        caches: identities.join(","),
      }),
      { onSideEffect: () => sideEffects++ },
    );
    assert(!parsed.ok, identities.join(","));
    assertEquals(sideEffects, 0);
    assert(
      parsed.diagnostics.some((diagnostic) =>
        diagnostic.field.startsWith("caches")
      ),
    );
  }
});

Deno.test("environment mapper preserves ordered cache identities", () => {
  const value = `17091:${PUBKEY}:,37091:${SECOND_PUBKEY}:named`;
  assertEquals(
    rawConfigFromEnvironment({ NIXSTR_CACHES: value })
      .caches,
    value,
  );
  assertEquals(
    rawConfigFromEnvironment({
      NIXSTR_CACHE_IDENTITIES: value,
      NIXSTR_PUBLISHER_PUBKEYS: PUBKEY,
    }).caches,
    undefined,
  );
});

Deno.test("removed local Blossom inputs are not part of operator config", () => {
  assertThrows(
    () => rawConfigFromEnvironment({ NIXSTR_LOCAL_BLOSSOM_URL: "http://127.0.0.1:24242" }),
    Error,
    "NIXSTR_LOCAL_BLOSSOM_URL is no longer supported",
  );
});

Deno.test("operator config defaults to explicit read-only write intent", () => {
  for (const raw of [validRaw(), validRaw({ writable: { enabled: false } })]) {
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent, { mode: "disabled" });
  }
});

Deno.test("operator config parses complete supported write intents", () => {
  const cases = [
    ["nip46", "root", 17091, ""],
    ["local", "named", 37091, "nixpkgs-unstable"],
  ] as const;
  for (const [mode, type, kind, identifier] of cases) {
    const parsed = parseConfig(
      validRaw({
        writable: {
          enabled: true,
          type,
          ...(type === "named" ? { name: identifier } : {}),
          signer: { type: mode, path: "/tmp/source" },
          staging: { directory: "/tmp/staging" },
        },
      }),
    );
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent, {
      mode,
      signerPath: "/tmp/source",
      identity: { kind, identifier },
    });
  }
});

Deno.test("operator config accepts only the ncryptsec signer source", () => {
  const key = generateSecretKey();
  const encrypted = encrypt(key, "password", 16);
  const parsed = parseConfig(validRaw({
    writable: {
      enabled: true,
      type: "root",
      signer: { type: "ncryptsec", ncryptsec: encrypted },
      staging: { directory: "/tmp/staging" },
    },
  }));
  assert(parsed.ok);
  assertEquals(parsed.value.writeIntent, {
    mode: "ncryptsec",
    identity: { kind: 17091, identifier: "" },
    ncryptsec: encrypted,
  });
  for (
    const signer of [
      { type: "ncryptsec" },
      { type: "ncryptsec", ncryptsec: "", path: "/tmp/key" },
      { type: "local", path: "/tmp/key", ncryptsec: encrypted },
    ]
  ) {
    const invalid = parseConfig(validRaw({
      writable: {
        enabled: true,
        type: "root",
        signer,
        staging: { directory: "/tmp/staging" },
      },
    }));
    assert(!invalid.ok);
  }
  key.fill(0);
});

Deno.test("JSON config accepts only a valid inline nbunksec source", async () => {
  const remote = generateSecretKey();
  const client = generateSecretKey();
  const toHex = (bytes: Uint8Array) =>
    [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const nbunksec = NostrConnectSigner.createNbunksec({
    remote: getPublicKey(remote),
    clientKey: toHex(client),
    relays: ["wss://relay.example"],
    bunkerSecret: "secret",
  });
  try {
    const writable = {
      enabled: true,
      type: "root",
      signer: { type: "nbunksec", nbunksec },
      staging: { directory: "/tmp/staging" },
    } as const;
    const raw = await loadStartupConfig(["--config", "/tmp/config.json"], {
      readEnvironment: () => undefined,
      readTextFile: () =>
        Promise.resolve(JSON.stringify({ ...JSON_CONFIG, writable })),
    });
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent, {
      mode: "nbunksec",
      identity: { kind: 17091, identifier: "" },
      nbunksec,
    });
    for (
      const signer of [
        { type: "nbunksec" },
        { type: "nbunksec", nbunksec: "nbunksec1malformed" },
        { type: "nbunksec", nbunksec, path: "/tmp/session" },
        { type: "local", path: "/tmp/key", nbunksec },
      ]
    ) {
      const invalid = parseConfig(validRaw({
        writable: {
          enabled: true,
          type: "root",
          signer,
          staging: { directory: "/tmp/staging" },
        },
      }));
      assert(!invalid.ok);
    }
  } finally {
    remote.fill(0);
    client.fill(0);
  }
});

Deno.test("operator config rejects partial contradictory and malformed write intent", () => {
  const invalid: Partial<RawConfig>[] = [
    { writable: { enabled: true } },
    { writable: { enabled: true, type: "other" } },
    { writable: { enabled: true, type: "root", name: "named" } },
    { writable: { enabled: true, type: "named", name: "" } },
    { writable: { enabled: true, type: "named", name: "bad name" } },
  ];
  for (const overrides of invalid) {
    const parsed = parseConfig(validRaw(overrides));
    assert(!parsed.ok, JSON.stringify(overrides));
    assert(
      parsed.diagnostics.some((diagnostic) =>
        diagnostic.field.startsWith("writable.")
      ),
    );
  }
});

Deno.test("write-intent diagnostics aggregate without side effects", () => {
  let sideEffects = 0;
  const parsed = parseConfig({
    ...validRaw({ writable: { enabled: true, type: "root" } }),
    bindPort: "0",
    extraRelays: "invalid",
  }, { onSideEffect: () => sideEffects++ });
  assert(!parsed.ok);
  assertEquals(sideEffects, 0);
  assert(
    parsed.diagnostics.some((diagnostic) => diagnostic.field === "bindPort"),
  );
  assert(
    parsed.diagnostics.some((diagnostic) =>
      diagnostic.field === "extraRelays[0]"
    ),
  );
  assert(
    parsed.diagnostics.some((diagnostic) =>
      diagnostic.field.startsWith("writable.")
    ),
  );
});

Deno.test("environment mapper preserves nested writable leaves", () => {
  assertEquals(rawConfigFromEnvironment({}).writable, undefined);
  const mapped = rawConfigFromEnvironment({
    NIXSTR_WRITABLE_ENABLED: "true",
    NIXSTR_WRITABLE_TYPE: "named",
    NIXSTR_WRITABLE_NAME: "named",
    NIXSTR_WRITABLE_SIGNER_TYPE: "nip46",
    NIXSTR_WRITABLE_SIGNER_PATH: "/tmp/session",
    NIXSTR_WRITABLE_SIGNER_NCRYPTSEC: "ncryptsec1encrypted",
  });
  assertEquals(mapped.writable?.signer?.type, "nip46");
  assertEquals(mapped.writable?.name, "named");
  assertEquals(mapped.writable?.signer?.ncryptsec, "ncryptsec1encrypted");
});

Deno.test("publication policy is canonical bounded and explicitly mapped", () => {
  const mapped = rawConfigFromEnvironment({
    NIXSTR_WRITABLE_PUBLICATION_NIX_SIG_KEYS:
      "cache-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=,other-1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    NIXSTR_WRITABLE_PUBLICATION_LIFETIME_SECONDS: "86400",
    NIXSTR_WRITABLE_PUBLICATION_LOCAL_RELAY_URL: "ws://127.0.0.1:7447",
    NIXSTR_WRITABLE_PUBLICATION_CONCURRENCY: "3",
    NIXSTR_WRITABLE_PUBLICATION_MAX_ATTEMPTS: "7",
  });
  const parsed = parseConfig(validRaw({
    writable: {
      enabled: true,
      type: "root",
      signer: { type: "local", path: "/tmp/key" },
      staging: { directory: "/tmp/staging" },
      publication: mapped.writable?.publication,
    },
  }));
  assert(parsed.ok);
  assert(parsed.value.writable.enabled);
  assertEquals(parsed.value.writable.publication.nixSigKeys, [
    "cache-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "other-1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  ]);
  assertEquals(parsed.value.writable.publication.lifetimeSeconds, 86400);
  assertEquals(
    parsed.value.writable.publication.localRelayUrl?.href,
    "ws://127.0.0.1:7447/",
  );
  assertEquals(parsed.value.writable.publication.concurrency, 3);
  assertEquals(parsed.value.writable.publication.maxAttempts, 7);
  const defaults = parseConfig(validRaw());
  assert(defaults.ok);
  assertEquals(defaults.value.writable, { enabled: false });
});

Deno.test("enabled signer requires exactly its protected source and staging limits", () => {
  const local = parseConfig(
    validRaw({
      writable: {
        enabled: true,
        type: "root",
        signer: { type: "local", path: "/tmp/key" },
        staging: {
          directory: "/tmp/staging",
          bodyBytes: "1024",
          aggregateBytes: "4096",
        },
      },
    }),
  );
  assert(local.ok);
  assert(local.value.writable.enabled);
  assertEquals(local.value.writable.signer.type, "local");
  if (local.value.writable.signer.type !== "local") {
    throw new Error("unreachable");
  }
  assertEquals(local.value.writable.signer.path, "/tmp/key");
  const missing = parseConfig(
    validRaw({
      writable: { enabled: true, type: "root", signer: { type: "local" } },
    }),
  );
  assert(!missing.ok);
});

Deno.test("production environment collector maps every supported limit", () => {
  const environment = {
    NIXSTR_CACHES: PUBKEY,
    NIXSTR_EXTRA_RELAYS: "wss://relay.example",
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
    NIXSTR_LIMIT_MANIFEST_CACHE_ENTRIES: "1000",
    NIXSTR_LIMIT_MANIFEST_CACHE_BYTES: "10000010",
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
    manifestCacheEntries: 1000,
    manifestCacheBytes: 10000010,
  });
  for (const name of Object.keys(environment)) assert(requested.includes(name));
});

Deno.test("invalid collected production limit stops before startup", async () => {
  const root = `/tmp/nixstr-limit-invalid-${crypto.randomUUID()}`;
  const environment: Record<string, string> = {
    NIXSTR_CACHES: PUBKEY,
    NIXSTR_EXTRA_RELAYS: "wss://relay.example",
    NIXSTR_DATABASE_PATH: `${root}/state.sqlite`,
    NIXSTR_SPOOL_DIRECTORY: `${root}/spool`,
    NIXSTR_LIMIT_MAX_REDIRECTS: "not-an-integer",
  };
  const calls: string[] = [];
  const result = await launchDaemon(
    collectRawConfigFromEnvironment((name) => environment[name]),
    {
      createEventStream: () => {
        calls.push("relay");
        return { events: new Subject<RawPublication>(), close() {} };
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

Deno.test("partial environment write intent stops before startup side effects", async () => {
  const root = `/tmp/nixstr-partial-${crypto.randomUUID()}`;
  const calls: string[] = [];
  const result = await launchDaemon({
    ...validRaw({
      databasePath: `${root}/state.sqlite`,
      spoolDirectory: `${root}/spool`,
    }),
    ...rawConfigFromEnvironment({
      NIXSTR_WRITABLE_ENABLED: "true",
      NIXSTR_WRITABLE_SIGNER_TYPE: "local",
    }),
  }, {
    createEventStream: () => {
      calls.push("relay");
      return { events: new Subject<RawPublication>(), close() {} };
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

Deno.test("extra Blossom servers do not make configured writes ready", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-intent-" });
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  try {
    await Deno.writeFile(`${root}/key`, new Uint8Array(32).fill(1), {
      mode: 0o600,
    });
    const result = await launchDaemon(
      validRaw({
        databasePath: `${root}/state.sqlite`,
        spoolDirectory: `${root}/spool`,
        extraServers: ["http://127.0.0.1:9"],
        writable: {
          enabled: true,
          type: "root",
          signer: { type: "local", path: `${root}/key` },
          staging: { directory: `${root}/staging` },
        },
      }),
      {
        createEventStream: () => ({
          events: new Subject<RawPublication>(),
          close() {},
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
