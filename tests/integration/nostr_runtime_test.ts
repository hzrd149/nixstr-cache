import { assert, assertEquals } from "@std/assert";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { filter, firstValueFrom } from "rxjs";
import { parseConfig } from "../../src/config/config.ts";
import { NostrRuntime } from "../../src/nostr/runtime.ts";

Deno.test("shared Nostr runtime derives publisher outboxes plus extra relays", async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const parsed = parseConfig({
    caches: pubkey,
    extraRelays: "wss://fallback.example",
    bootstrapRelays: "wss://bootstrap.example",
    databasePath: "/tmp/nixstr-unused.sqlite",
    spoolDirectory: "/tmp/nixstr-unused-spool",
  });
  assert(parsed.ok);
  const runtime = new NostrRuntime(parsed.value);
  try {
    const relaySet = firstValueFrom(
      runtime.relaySetFor([pubkey]).pipe(
        filter((values) => values.includes("wss://outbox.example.com/")),
      ),
    );
    runtime.store.add(finalizeEvent({
      kind: 10002,
      created_at: 1,
      content: "",
      tags: [
        ["r", "wss://outbox.example.com", "write"],
        ["r", "wss://inbox.example.com", "read"],
      ],
    }, secret));
    const relays = await relaySet;
    assertEquals(relays, [
      "wss://fallback.example/",
      "wss://outbox.example.com/",
    ]);
    assertEquals(runtime.currentRelaySet([pubkey]), relays);
  } finally {
    runtime.dispose();
  }
});
