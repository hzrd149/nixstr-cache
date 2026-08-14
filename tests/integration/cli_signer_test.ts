import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { NostrConnectSigner } from "applesauce-signers";
import {
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
} from "nostr-tools";
import { encrypt } from "nostr-tools/nip49";
import { loadStartupConfig, parseStartupArguments } from "../../main.ts";
import { parseConfig } from "../../src/config/config.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";

const PUBKEY = "a".repeat(64);
const WRITABLE_JSON = {
  caches: [PUBKEY],
  extraRelays: ["wss://relay.example"],
  databasePath: "/tmp/nixstr-cli-state.sqlite",
  writable: {
    enabled: true,
    type: "root",
    staging: { directory: "/tmp/nixstr-cli-staging" },
  },
};

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function signerValues() {
  const key = generateSecretKey();
  const remote = generateSecretKey();
  const client = generateSecretKey();
  return {
    nsec: nip19.nsecEncode(key),
    ncryptsec: encrypt(key, "password", 16),
    nbunksec: NostrConnectSigner.createNbunksec({
      remote: getPublicKey(remote),
      clientKey: hex(client),
      relays: ["wss://relay.example"],
      bunkerSecret: "secret",
    }),
    dispose() {
      key.fill(0);
      remote.fill(0);
      client.fill(0);
    },
  };
}

Deno.test("CLI accepts each signer form in either syntax and argument order", () => {
  const values = signerValues();
  try {
    for (
      const [type, value] of Object.entries(values).filter(([key]) =>
        key !== "dispose"
      )
    ) {
      const separated = parseStartupArguments([
        "--signer",
        value as string,
        "--config",
        "config.json",
      ]);
      assertEquals(separated.signerOverride?.type, type);
      assert(separated.configPath?.endsWith("/config.json"));
      const equals = parseStartupArguments([
        "--config=config.json",
        `--signer=${value}`,
      ]);
      assertEquals(equals.signerOverride?.type, type);
    }
  } finally {
    values.dispose();
  }
});

Deno.test("CLI signer replaces configured source but requires enabled writable policy", async () => {
  const values = signerValues();
  try {
    const warnings: string[] = [];
    const raw = await loadStartupConfig([
      "--config",
      "/tmp/config.json",
      "--signer",
      values.ncryptsec,
    ], {
      readEnvironment: () => undefined,
      readTextFile: () =>
        Promise.resolve(JSON.stringify({
          ...WRITABLE_JSON,
          writable: {
            ...WRITABLE_JSON.writable,
            signer: { type: "local", path: "/configured/key" },
          },
        })),
      warn: (message) => warnings.push(message),
    });
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    assertEquals(parsed.value.writeIntent.mode, "ncryptsec");
    assertEquals(warnings.length, 1);
    assert(!warnings[0].includes(values.ncryptsec));

    const disabled = parseConfig({
      ...raw,
      writable: { enabled: false },
    });
    assert(!disabled.ok);
    assert(disabled.diagnostics.some((item) => item.field === "--signer"));
  } finally {
    values.dispose();
  }
});

Deno.test("inline nsec starts and signs without requesting a password", async () => {
  const values = signerValues();
  try {
    const raw = await loadStartupConfig(["--signer", values.nsec], {
      readEnvironment: (name) =>
        ({
          NIXSTR_CACHES: PUBKEY,
          NIXSTR_EXTRA_RELAYS: "wss://relay.example",
          NIXSTR_DATABASE_PATH: "/tmp/nixstr-cli-state.sqlite",
          NIXSTR_WRITABLE_ENABLED: "true",
          NIXSTR_WRITABLE_TYPE: "root",
          NIXSTR_WRITABLE_STAGING_DIRECTORY: "/tmp/nixstr-cli-staging",
        } as Record<string, string>)[name],
      warn: () => {},
    });
    const parsed = parseConfig(raw);
    assert(parsed.ok);
    let prompts = 0;
    const signer = createSignerCapability({
      intent: parsed.value.writeIntent,
      requestPassword: () => {
        prompts++;
        return Promise.resolve("unused");
      },
    });
    await signer.start();
    const event = await signer.signEvent({
      kind: 17091,
      created_at: 1,
      content: "",
      tags: [],
    });
    assert(verifyEvent(event));
    assertEquals(prompts, 0);
    await signer.close();
  } finally {
    values.dispose();
  }
});

Deno.test("CLI rejects ambiguous or malformed input without disclosing it", async () => {
  for (
    const [args, message] of [
      [["--signer"], "requires a value"],
      [["--config"], "requires a path"],
      [["--signer", "nsec1bad"], "must be a valid"],
      [["--signer=ncryptsec1bad"], "must be a valid"],
      [["--signer=nbunksec1bad"], "must be a valid"],
      [["--other"], "unsupported argument"],
      [["positional"], "positional arguments"],
    ] as const
  ) {
    await assertRejects(
      () => loadStartupConfig(args, { readEnvironment: () => undefined }),
      Error,
      message,
    );
  }
  const values = signerValues();
  try {
    assertThrows(
      () =>
        parseStartupArguments([
          "--signer",
          values.nsec,
          "--signer",
          values.nsec,
        ]),
      Error,
      "specified once",
    );
    assertThrows(
      () => parseStartupArguments(["--config=a", "--config=b"]),
      Error,
      "specified once",
    );
  } finally {
    values.dispose();
  }
});
