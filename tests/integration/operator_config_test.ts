import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseConfig, type RawConfig } from "../../src/config/config.ts";
import { rawConfigFromEnvironment } from "../../main.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import { Subject } from "rxjs";
import type { RawPublication } from "../../src/protocol/publication.ts";

const PUBKEY = "a".repeat(64);

function validRaw(overrides: Partial<RawConfig> = {}): RawConfig {
  return {
    publisherPubkeys: PUBKEY,
    relayUrls: "wss://relay.example",
    databasePath: "/tmp/nixstr-operator.sqlite",
    spoolDirectory: "/tmp/nixstr-operator-spool",
    ...overrides,
  };
}

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
      validRaw({ signerMode: mode, writableIdentity }),
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

Deno.test("complete write intent does not enable Phase 1 PUT", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-write-intent-" });
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  try {
    const result = launchDaemon(
      validRaw({
        databasePath: `${root}/state.sqlite`,
        spoolDirectory: `${root}/spool`,
        signerMode: "local",
        writableIdentity: `17091:${PUBKEY}:`,
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
