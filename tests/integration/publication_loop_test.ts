import { assert, assertEquals, assertRejects } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import { bech32 } from "@scure/base";
import { WriteRepository } from "../../src/persistence/write_repository.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";
import {
  PublicationCoordinator,
  type ReplicaPublisher,
} from "../../src/write/publication_coordinator.ts";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";

async function fixture() {
  const root = await Deno.makeTempDir({ prefix: "publication-loop-" });
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const keyPath = `${root}/key`;
  await Deno.writeFile(keyPath, secret, { mode: 0o600 });
  const write = new WriteRepository(`${root}/write.sqlite`, `${root}/spool`, {
    perBodyBytes: 1024,
    aggregateBytes: 8192,
  });
  const batch = {
    id: 7,
    token: 7,
    generation: 1,
    entries: [],
  };
  const nhash = bech32.encode(
    "nhash",
    bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32).fill(1)])),
    200,
  );
  write.recordPending(batch, {
    batchId: 7,
    generation: 1,
    rootHex: "11".repeat(32),
    nhash,
    blobCount: 2,
    totalBytes: 2,
  }, [
    { hash: "22".repeat(32), size: 1, path: `${root}/a` },
    { hash: "33".repeat(32), size: 1, path: `${root}/b` },
  ]);
  await Deno.writeTextFile(`${root}/a`, "a");
  await Deno.writeTextFile(`${root}/b`, "b");
  const signer = createSignerCapability({
    intent: {
      mode: "local",
      identity: { kind: 17091, pubkey, identifier: "" },
    },
    localKeyPath: keyPath,
  });
  await signer.start();
  const state = new StateRepository(`${root}/state.sqlite`);
  const selection = startPublicationSelection({
    events: new Subject(),
    repository: state,
    publisherPubkeys: [pubkey],
    identities: [`17091:${pubkey}:`],
    now: () => 100,
  });
  return { root, pubkey, write, signer, state, selection };
}

Deno.test("one complete replica publishes exact event through normal admission", async () => {
  const f = await fixture();
  try {
    let signCalls = 0;
    const original = f.signer.signEvent.bind(f.signer);
    f.signer.signEvent = async (template) => {
      signCalls++;
      return await original(template);
    };
    const replica: ReplicaPublisher = {
      async prove(_server, entry) {
        return entry.hash !== "33".repeat(32);
      },
    };
    const coordinator = new PublicationCoordinator({
      repository: f.write,
      signer: f.signer,
      selector: f.selection,
      identity: { kind: 17091, pubkey: f.pubkey, identifier: "" },
      blossomServers: ["http://127.0.0.1:9001", "http://127.0.0.1:9002"],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447"],
      lifetimeSeconds: 3600,
      now: () => 100,
      replica,
      publishRelays: async (
        _event,
      ) => [{ relay: "ws://127.0.0.1:7447", ok: true }],
    });
    await coordinator.tick();
    assertEquals(signCalls, 0, "split/partial replicas must not sign");
    replica.prove = async (server) => server.endsWith("9002");
    await coordinator.tick();
    assertEquals(signCalls, 1);
    const saga = f.write.publicationSaga();
    assert(saga?.signedEvent && saga.committed && saga.admitted);
    assertEquals(f.selection.current()[0]?.event.id, saga.signedEvent.id);
    assertEquals(saga.signedEvent.tags, [
      ["htree", `htree://${saga.candidate.nhash}`],
      ["blossom", "http://127.0.0.1:9001"],
      ["blossom", "http://127.0.0.1:9002"],
      ["expiration", "3700"],
    ]);
    await coordinator.tick();
    assertEquals(signCalls, 1, "restart/retry must reuse exact signed event");
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("hostile signer and false relay fail before promotion", async () => {
  const f = await fixture();
  try {
    const coordinator = new PublicationCoordinator({
      repository: f.write,
      signer: f.signer,
      selector: f.selection,
      identity: { kind: 17091, pubkey: f.pubkey, identifier: "" },
      blossomServers: ["http://127.0.0.1:9001"],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447"],
      lifetimeSeconds: 3600,
      now: () => 100,
      replica: { prove: async () => true },
      publishRelays: async () => [{ relay: "ws://127.0.0.1:7447", ok: false }],
    });
    await coordinator.tick();
    assert(f.write.publicationSaga()?.signedEvent);
    assertEquals(f.write.publicationSaga()?.committed, false);
    assertEquals(f.selection.current(), []);
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("repository independently rejects a signed event that differs from its template", async () => {
  const f = await fixture();
  try {
    const saga = f.write.claimPublication(["http://127.0.0.1:9001"])!;
    for (const entry of f.write.publicationInventory(saga.batchId)) {
      f.write.recordBlobProof(
        saga.batchId,
        "http://127.0.0.1:9001",
        entry.hash,
      );
    }
    f.write.recordCompleteServer(saga.batchId, "http://127.0.0.1:9001");
    const template = { kind: 17091, created_at: 100, tags: [], content: "" };
    await assertRejects(
      async () => {
        f.write.recordSigned(saga.batchId, template, {
          id: "0".repeat(64),
          pubkey: f.pubkey,
          sig: "0".repeat(128),
          kind: 17091,
          created_at: 101,
          tags: [],
          content: "changed",
        });
      },
      Error,
      "signed event differs from template",
    );
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});
