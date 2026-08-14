import { assert, assertEquals } from "@std/assert";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { filter, firstValueFrom } from "rxjs";
import { parseConfig } from "../../src/config/config.ts";
import { createNostrService } from "../../src/nostr/runtime.ts";
import { createPublicationEventStream } from "../../src/nostr/publications.ts";
import { bech32 } from "@scure/base";

Deno.test("shared Nostr service derives publisher outboxes plus extra relays", async () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const parsed = parseConfig({
    caches: pubkey,
    extraRelays: "wss://fallback.example",
    bootstrapRelays: "wss://bootstrap.example",
    databasePath: "/tmp/nixstr-unused.sqlite",
  });
  assert(parsed.ok);
  const runtime = createNostrService(parsed.value);
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
    runtime.close();
  }
});

Deno.test("cache publications require the guarded accepted-event gateway", () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const parsed = parseConfig({
    caches: pubkey,
    extraRelays: "wss://fallback.example",
    databasePath: "/tmp/nixstr-unused.sqlite",
  });
  assert(parsed.ok);
  const runtime = createNostrService(parsed.value);
  const nhash = bech32.encode(
    "nhash",
    bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32)])),
    200,
  );
  const publication = finalizeEvent({
    kind: 17091,
    created_at: 1,
    content: "",
    tags: [["htree", `htree://${nhash}`]],
  }, secret);
  try {
    assertEquals(runtime.store.add(publication), null);
    assertEquals(runtime.store.hasEvent(publication.id), false);
    assertEquals(
      runtime.addAcceptedPublication(publication).id,
      publication.id,
    );
    assertEquals(runtime.store.hasEvent(publication.id), true);
  } finally {
    runtime.close();
  }
});

Deno.test("empty publisher stream creates no metadata or relay subscription", () => {
  const parsed = parseConfig({
    databasePath: "/tmp/nixstr-empty-publishers.sqlite",
  });
  assert(parsed.ok);
  let metadataCalls = 0;
  let subscriptionCalls = 0;
  const service = {
    followUserMetadata() {
      metadataCalls++;
    },
    relaySetFor() {
      throw new Error("relaySetFor must not be called for no publishers");
    },
    pool: {
      subscription() {
        subscriptionCalls++;
        throw new Error("subscription must not be called for no publishers");
      },
    },
  };
  const stream = createPublicationEventStream(
    parsed.value,
    service as unknown as Parameters<typeof createPublicationEventStream>[1],
  );
  try {
    assertEquals(metadataCalls, 0);
    assertEquals(subscriptionCalls, 0);
  } finally {
    stream.close();
  }
});
