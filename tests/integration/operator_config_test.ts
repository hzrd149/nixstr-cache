import { assert, assertEquals } from "@std/assert";
import { parseConfig, type RawConfig } from "../../src/config/config.ts";

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
