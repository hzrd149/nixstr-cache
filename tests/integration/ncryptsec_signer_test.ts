import { assert, assertEquals, assertRejects } from "@std/assert";
import { PasswordSigner } from "applesauce-signers";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { encrypt } from "nostr-tools/nip49";
import { createPasswordRequest } from "../../src/runtime/password_prompt.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import type { RawConfig } from "../../src/config/config.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";
import { Subject } from "rxjs";

const identity = { kind: 17091 as const, identifier: "" };

Deno.test("locked PasswordSigner unlocks ncryptsec and capability signs valid events", async () => {
  const key = generateSecretKey();
  const password = "correct horse battery staple";
  const encrypted = encrypt(key, password, 10);
  const locked = await PasswordSigner.fromNcryptsec(encrypted);
  assertEquals(locked.unlocked, false);
  await locked.unlock(password);
  assertEquals(await locked.getPublicKey(), getPublicKey(key));
  locked.key?.fill(0);
  locked.lock();

  const capability = createSignerCapability({
    intent: { mode: "ncryptsec", identity, ncryptsec: encrypted },
    requestPassword: () => Promise.resolve(password),
  });
  await capability.start();
  assertEquals(capability.current(), {
    status: "ready",
    pubkey: getPublicKey(key),
  });
  const event = await capability.signEvent({
    kind: 17091,
    created_at: 1,
    content: "",
    tags: [],
  });
  assert(verifyEvent(event));
  await capability.close();
  key.fill(0);
});

Deno.test("ncryptsec failures are sanitized and fail closed", async () => {
  const key = generateSecretKey();
  const encrypted = encrypt(key, "right", 10);
  for (
    const [source, requestPassword, code] of [
      [encrypted, () => Promise.resolve("wrong"), "invalid_source"],
      ["ncryptsec1malformed", () => Promise.resolve("right"), "invalid_source"],
      [
        encrypted,
        () => Promise.reject(new Error("SECRET prompt detail")),
        "password_unavailable",
      ],
    ] as const
  ) {
    const capability = createSignerCapability({
      intent: { mode: "ncryptsec", identity, ncryptsec: source },
      requestPassword,
    });
    await capability.start();
    assertEquals(capability.current(), { status: "failed", code });
    await assertRejects(
      () =>
        capability.signEvent({ kind: 1, created_at: 1, content: "", tags: [] }),
      Error,
      "not ready",
    );
    await capability.close();
  }
  key.fill(0);
});

Deno.test("password prompt suppresses TTY echo, restores raw mode, and bounds input", async () => {
  const writes: number[][] = [];
  const raw: boolean[] = [];
  const input = [...new TextEncoder().encode("secret\n")];
  const request = createPasswordRequest({
    isTerminal: () => true,
    setRaw: (value) => raw.push(value),
    read: (buffer) => {
      const value = input.shift();
      if (value === undefined) return Promise.resolve(null);
      buffer[0] = value;
      return Promise.resolve(1);
    },
    write: (data) => {
      writes.push([...data]);
      return Promise.resolve(data.length);
    },
  });
  assertEquals(await request(), "secret");
  assertEquals(raw, [true, false]);
  const output = new TextDecoder().decode(Uint8Array.from(writes.flat()));
  assert(
    output.includes(
      "The ncryptsec signer is locked. Enter its unlock password.\nPassword: ",
    ),
  );
  assert(
    !output.includes("secret"),
  );

  const tooLong = createPasswordRequest({
    isTerminal: () => false,
    setRaw: () => {},
    read: (buffer) => {
      buffer[0] = 97;
      return Promise.resolve(1);
    },
    write: (data) => Promise.resolve(data.length),
  }, 2);
  await assertRejects(tooLong, Error, "too long");
});

Deno.test("non-terminal password input requires a bounded newline-terminated value", async () => {
  const input = [...new TextEncoder().encode("supervised\n")];
  const request = createPasswordRequest({
    isTerminal: () => false,
    setRaw: () => {
      throw new Error("must not set raw mode");
    },
    read: (buffer) => {
      const value = input.shift();
      if (value === undefined) return Promise.resolve(null);
      buffer[0] = value;
      return Promise.resolve(1);
    },
    write: (data) => Promise.resolve(data.length),
  });
  assertEquals(await request(), "supervised");
});

function ncryptsecRaw(root: string, encrypted: string): RawConfig {
  return {
    caches: "a".repeat(64),
    extraRelays: "wss://relay.example",
    databasePath: `${root}/state.sqlite`,
    spoolDirectory: `${root}/spool`,
    writable: {
      enabled: true,
      type: "root",
      signer: { type: "ncryptsec", ncryptsec: encrypted },
      staging: { directory: `${root}/staging` },
    },
  };
}

Deno.test("ncryptsec startup waits for unlock before binding", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-prebind-" });
  const key = generateSecretKey();
  const encrypted = encrypt(key, "password", 16);
  let release!: (password: string) => void;
  const password = new Promise<string>((resolve) => release = resolve);
  let binds = 0;
  try {
    const launching = launchDaemon(ncryptsecRaw(root, encrypted), {
      requestPassword: () => password,
      createEventStream: () => ({
        events: new Subject<RawPublication>(),
        close() {},
      }),
      bind: () => {
        binds++;
        return { shutdown: () => Promise.resolve() };
      },
      signals: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(binds, 0);
    release("password");
    const daemon = await launching;
    assert(daemon.ok);
    assertEquals(binds, 1);
    await daemon.shutdown();
  } finally {
    key.fill(0);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("interactive ncryptsec retries before bind and failed piped input cleans up", async () => {
  const key = generateSecretKey();
  const encrypted = encrypt(key, "right", 16);
  const root = await Deno.makeTempDir({ prefix: "nixstr-prebind-retry-" });
  let attempts = 0;
  let rejected = 0;
  let binds = 0;
  try {
    const requestPassword = Object.assign(
      () => Promise.resolve(++attempts === 1 ? "wrong" : "right"),
      {
        interactive: true,
        rejected: () => {
          rejected++;
          return Promise.resolve();
        },
      },
    );
    const daemon = await launchDaemon(ncryptsecRaw(root, encrypted), {
      requestPassword,
      createEventStream: () => ({
        events: new Subject<RawPublication>(),
        close() {},
      }),
      bind: () => {
        binds++;
        return { shutdown: () => Promise.resolve() };
      },
      signals: [],
    });
    assert(daemon.ok);
    assertEquals({ attempts, rejected, binds }, {
      attempts: 2,
      rejected: 1,
      binds: 1,
    });
    await daemon.shutdown();

    let disposed = false;
    const failed = await launchDaemon(
      ncryptsecRaw(`${root}/failed`, encrypted),
      {
        requestPassword: () => Promise.resolve("wrong"),
        createEventStream: () => ({
          events: new Subject<RawPublication>(),
          close() {
            disposed = true;
          },
        }),
        bind: () => {
          binds++;
          return { shutdown: () => Promise.resolve() };
        },
        signals: [],
      },
    );
    assert(!failed.ok);
    assertEquals(binds, 1);
    assertEquals(disposed, true);
    assert(!JSON.stringify(failed.diagnostics).includes("wrong"));
  } finally {
    key.fill(0);
    await Deno.remove(root, { recursive: true });
  }
});
