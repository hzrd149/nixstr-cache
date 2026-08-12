import { assert, assertEquals } from "@std/assert";
import { bech32 } from "@scure/base";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import { WriteRepository } from "../../src/persistence/write_repository.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";
import { PublicationCoordinator } from "../../src/write/publication_coordinator.ts";
import { LocalRelayCache } from "../../src/nostr/local_relay_cache.ts";

Deno.test("restart repairs replicas and relays without rolling back committed root", async () => {
  const root = await Deno.makeTempDir({ prefix: "publication-recovery-" });
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  await Deno.writeFile(`${root}/key`, secret, { mode: 0o600 });
  await Deno.writeTextFile(`${root}/blob`, "x");
  let now = 100;
  let secondReplica = false;
  let secondRelay = false;
  const open = () =>
    new WriteRepository(`${root}/write.sqlite`, `${root}/spool`, {
      perBodyBytes: 1024,
      aggregateBytes: 8192,
    });
  let write = open();
  const nhash = bech32.encode(
    "nhash",
    bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32).fill(1)])),
    200,
  );
  write.recordPending({ id: 1, token: 1, generation: 1, entryCount: 0 }, {
    batchId: 1,
    generation: 1,
    rootHex: "11".repeat(32),
    nhash,
    blobCount: 1,
    totalBytes: 1,
  }, [{ hash: "22".repeat(32), size: 1, path: `${root}/blob` }]);
  const signer = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, pubkey, identifier: "" },
    },
    localKeyPath: `${root}/key`,
  });
  await signer.start();
  const state = new StateRepository(`${root}/state.sqlite`);
  const selection = startPublicationSelection({
    events: new Subject(),
    repository: state,
    publisherPubkeys: [pubkey],
    identities: [`17091:${pubkey}:`],
    now: () => now,
  });
  const make = () =>
    new PublicationCoordinator({
      repository: write,
      signer,
      selector: selection,
      identity: { kind: 17091, pubkey, identifier: "" },
      blossomServers: ["http://127.0.0.1:9001", "http://127.0.0.1:9002"],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447", "ws://127.0.0.1:7448"],
      lifetimeSeconds: 3600,
      now: () => now,
      replica: {
        prove: (server) =>
          Promise.resolve(server.endsWith("9001") || secondReplica),
      },
      publishRelays: (_event, relays) =>
        Promise.resolve(relays.map((relay) => ({
          relay,
          ok: relay.endsWith("7447") || secondRelay,
        }))),
      retry: {
        baseSeconds: 10,
        maxSeconds: 60,
        maxAttempts: 5,
        concurrency: 2,
        jitter: () => 0,
      },
      refreshLeadSeconds: 600,
    });
  try {
    await make().tick();
    const committed = write.publicationSaga()!;
    assert(committed.committed && committed.admitted && committed.signedEvent);
    const eventId = committed.signedEvent.id;
    assertEquals(
      write.endpointWork().filter((row) => row.status === "retry").length,
      2,
    );
    write.close();
    write = open();
    now = 109;
    await make().tick();
    assertEquals(write.publicationSaga()?.signedEvent?.id, eventId);
    assertEquals(
      write.endpointWork().filter((row) => row.status === "retry").length,
      2,
    );
    secondReplica = secondRelay = true;
    now = 110;
    await make().tick();
    assertEquals(write.publicationSaga()?.signedEvent?.id, eventId);
    assertEquals(
      write.endpointWork().every((row) => row.status === "complete"),
      true,
    );
    assertEquals(selection.current()[0]?.event.id, eventId);
    now = 3_100;
    await make().tick();
    const refreshed = write.publicationSaga()!;
    assert(refreshed.committed && refreshed.admitted);
    assert(refreshed.signedEvent && refreshed.signedEvent.id !== eventId);
    assertEquals(refreshed.candidate.rootHex, committed.candidate.rootHex);
    assertEquals(
      write.publicationHistory().map((item) => item.signedEvent?.id),
      [eventId],
    );
  } finally {
    selection.dispose();
    state.close();
    write.close();
    await signer.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("local relay forwards only admitted and exact locally signed events", async () => {
  const sent: string[] = [];
  const cache = new LocalRelayCache(
    "ws://127.0.0.1:7447",
    (_relay, event) => {
      sent.push(event.id);
      return Promise.resolve(true);
    },
  );
  const invalid = { id: "0".repeat(64) } as never;
  assertEquals(await cache.acceptObserved(invalid), false);
  assertEquals(sent, []);
  const root = await Deno.makeTempDir({ prefix: "local-relay-event-" });
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  await Deno.writeFile(`${root}/key`, secret, { mode: 0o600 });
  const signer = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, pubkey, identifier: "" },
    },
    localKeyPath: `${root}/key`,
  });
  await signer.start();
  try {
    const nhash = bech32.encode(
      "nhash",
      bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32).fill(1)])),
      200,
    );
    const event = await signer.signEvent({
      kind: 17091,
      created_at: 100,
      tags: [["htree", `htree://${nhash}`], ["expiration", "200"]],
      content: "",
    });
    assertEquals(await cache.acceptObserved(event as never), true);
    assertEquals(await cache.publishSigned(event as never), true);
    assertEquals(sent, [event.id, event.id]);
  } finally {
    await signer.close();
    await Deno.remove(root, { recursive: true });
  }
});
