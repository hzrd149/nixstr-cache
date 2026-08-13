import { assert, assertEquals, assertRejects } from "@std/assert";
import { PasswordSigner } from "applesauce-signers";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { encrypt } from "nostr-tools/nip49";
import { createPasswordRequest } from "../../src/runtime/password_prompt.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";

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
  assert(
    !new TextDecoder().decode(Uint8Array.from(writes.flat())).includes(
      "secret",
    ),
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
