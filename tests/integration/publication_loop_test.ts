import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import { bech32 } from "@scure/base";
import { WriteRepository as BaseWriteRepository } from "../../src/persistence/write_repository.ts";
class WriteRepository extends BaseWriteRepository {
  constructor(...args: ConstructorParameters<typeof BaseWriteRepository>) {
    super(...args);
    this.bindIdentity(this.boundIdentity() ?? `17091:${"f".repeat(64)}:`);
  }
}
import { createSignerCapability } from "../../src/signer/capability.ts";
import {
  PublicationCoordinator,
  type ReplicaPublisher,
} from "../../src/write/publication_coordinator.ts";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { OperationalDiagnostic } from "../../src/operations/diagnostics.ts";

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
    entryCount: 0,
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
      identity: { kind: 17091, identifier: "" },
      signerPath: keyPath,
    },
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
  const diagnostics: OperationalDiagnostic[] = [];
  try {
    let now = 100;
    let signCalls = 0;
    const original = f.signer.signEvent.bind(f.signer);
    f.signer.signEvent = async (template) => {
      signCalls++;
      return await original(template);
    };
    const replica: ReplicaPublisher = {
      prove(_server, entry) {
        return Promise.resolve(entry.hash !== "33".repeat(32));
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
      now: () => now,
      replica,
      publishRelays: (
        _event,
      ) => Promise.resolve([{ relay: "ws://127.0.0.1:7447", ok: true }]),
      diagnostics: { emit: (item) => diagnostics.push(item) },
    });
    await coordinator.tick();
    assertEquals(signCalls, 0, "split/partial replicas must not sign");
    replica.prove = (server) => Promise.resolve(server.endsWith("9002"));
    now = 140;
    await coordinator.tick();
    assertEquals(signCalls, 1);
    const saga = f.write.publicationSaga();
    assert(saga?.signedEvent && saga.committed && saga.admitted);
    assertEquals(f.selection.current()[0]?.event.id, saga.signedEvent.id);
    assertEquals(saga.signedEvent.tags, [
      ["htree", `htree://${saga.candidate.nhash}`],
      ["blossom", "http://127.0.0.1:9001"],
      ["blossom", "http://127.0.0.1:9002"],
      ["expiration", "3740"],
    ]);
    replica.prove = () => Promise.resolve(true);
    await coordinator.tick();
    now = 220;
    await coordinator.tick();
    assertEquals(signCalls, 1, "restart/retry must reuse exact signed event");
    assertEquals(
      diagnostics.filter((item) => item.type === "batch_transition").map((
        item,
      ) => item.code),
      ["batch_claimed", "batch_resumed", "batch_resumed", "batch_resumed"],
    );
    assertEquals(
      diagnostics.filter((item) => item.type === "publication_stage").map((
        item,
      ) => item.code),
      [
        "replication_started",
        "replication_waiting",
        "replication_started",
        "replication_complete",
        "root_signing_started",
        "root_signing_complete",
        "relay_publication_started",
        "relay_publication_complete",
        "selection_admission_started",
        "selection_admission_complete",
      ],
    );
    const progress = diagnostics.filter((item) =>
      item.type === "publication_progress"
    );
    const final = progress.find((item) =>
      item.type === "publication_progress" && item.fullyPublished
    );
    assert(final?.type === "publication_progress", JSON.stringify(progress));
    assertEquals(final.replicaTotal, 2);
    assertEquals(final.replicaSucceeded, 2);
    assertEquals(final.relayTotal, 1);
    assertEquals(final.relaySucceeded, 1);
    assertEquals(final.fullyPublished, true);
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("initial replicas overlap and first completion cancels siblings", async () => {
  const f = await fixture();
  try {
    const diagnostics: OperationalDiagnostic[] = [];
    const started = new Set<string>();
    let bothStarted!: () => void;
    const overlap = new Promise<void>((resolve) => bothStarted = resolve);
    let siblingAborted = false;
    const original = f.signer.signEvent.bind(f.signer);
    f.signer.signEvent = async (template, signal) => {
      assertEquals(siblingAborted, true);
      return await original(template, signal);
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
      replica: {
        async prove(server, _entry, signal) {
          started.add(server);
          if (started.size === 2) bothStarted();
          await overlap;
          if (server.endsWith("9001")) return true;
          return await new Promise<boolean>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              siblingAborted = true;
              reject(signal.reason);
            }, { once: true });
          });
        },
      },
      publishRelays: (_event, relays) =>
        Promise.resolve(relays.map((relay) => ({ relay, ok: true }))),
      retry: {
        baseSeconds: 30,
        maxSeconds: 60,
        maxAttempts: 5,
        concurrency: 2,
        jitter: () => 0,
      },
      diagnostics: { emit: (item) => diagnostics.push(item) },
    });
    await coordinator.tick();
    assertEquals(started.size, 2);
    assertEquals(siblingAborted, true);
    assert(f.write.publicationSaga()?.committed);
    assertEquals(
      f.write.endpointWork().find((work) => work.target.endsWith("9002"))
        ?.status,
      "retry",
    );
    const progress = diagnostics.filter((item) =>
      item.type === "replica_progress"
    );
    assertEquals(
      progress.filter((item) => item.code === "replica_started").length,
      2,
    );
    assert(
      progress.some((item) =>
        item.type === "replica_progress" && item.completed === 1 &&
        item.total === 2
      ),
    );
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("initial replica workers honor the configured server ceiling", async () => {
  const f = await fixture();
  try {
    let active = 0;
    let maximum = 0;
    let firstPair!: () => void;
    const twoStarted = new Promise<void>((resolve) => firstPair = resolve);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => release = resolve);
    const started: string[] = [];
    const coordinator = new PublicationCoordinator({
      repository: f.write,
      signer: f.signer,
      selector: f.selection,
      identity: { kind: 17091, pubkey: f.pubkey, identifier: "" },
      blossomServers: [
        "http://127.0.0.1:9001",
        "http://127.0.0.1:9002",
        "http://127.0.0.1:9003",
      ],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447"],
      lifetimeSeconds: 3600,
      now: () => 100,
      replica: {
        async prove(server) {
          active++;
          maximum = Math.max(maximum, active);
          started.push(server);
          if (active === 2) firstPair();
          await gate;
          active--;
          return false;
        },
      },
      publishRelays: () => Promise.resolve([]),
      retry: {
        baseSeconds: 30,
        maxSeconds: 60,
        maxAttempts: 5,
        concurrency: 2,
        jitter: () => 0,
      },
    });
    const tick = coordinator.tick();
    await twoStarted;
    assertEquals(started.some((server) => server.endsWith("9003")), false);
    release();
    await tick;
    assertEquals(maximum, 2);
    assertEquals(started.some((server) => server.endsWith("9003")), true);
    assertEquals(f.write.publicationSaga()?.signedEvent, undefined);
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("incomplete initial replicas honor durable retry backoff", async () => {
  const f = await fixture();
  try {
    let now = 100;
    let calls = 0;
    const coordinator = new PublicationCoordinator({
      repository: f.write,
      signer: f.signer,
      selector: f.selection,
      identity: { kind: 17091, pubkey: f.pubkey, identifier: "" },
      blossomServers: ["http://127.0.0.1:9001", "http://127.0.0.1:9002"],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447"],
      lifetimeSeconds: 3600,
      now: () => now,
      replica: {
        prove: () => {
          calls++;
          return Promise.resolve(false);
        },
      },
      publishRelays: () => Promise.resolve([]),
      retry: {
        baseSeconds: 30,
        maxSeconds: 60,
        maxAttempts: 5,
        concurrency: 2,
        jitter: () => 0,
      },
    });
    await coordinator.tick();
    assertEquals(calls, 4);
    assertEquals(
      f.write.endpointWork().filter((work) => work.kind === "relay").length,
      0,
    );
    await coordinator.tick();
    assertEquals(calls, 4, "same-time wake must not repeat replica passes");
    now = 129;
    await coordinator.tick();
    assertEquals(calls, 4, "pre-backoff wake must remain idle");
    now = 130;
    await coordinator.tick();
    assertEquals(calls, 8, "due replica work retries exactly once");
    assertEquals(f.write.publicationSaga()?.signedEvent, undefined);
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("authorization failures are backoff-eligible and stage-visible", async () => {
  const f = await fixture();
  const diagnostics: OperationalDiagnostic[] = [];
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
      prepareReplicaAuthorization: () =>
        Promise.reject(new Error("remote detail must stay private")),
      replica: { prove: () => Promise.resolve(true) },
      publishRelays: () => Promise.resolve([]),
      diagnostics: { emit: (item) => diagnostics.push(item) },
      retry: {
        baseSeconds: 30,
        maxSeconds: 30,
        maxAttempts: 3,
        concurrency: 1,
        jitter: () => 0,
      },
    });
    await assertRejects(() => coordinator.tick());
    assertEquals(
      diagnostics.filter((item) => item.type !== "publication_progress").map((
        item,
      ) => item.code),
      [
        "batch_claimed",
        "authorization_started",
        "authorization_failed",
        "replica_unavailable",
      ],
    );
    assertEquals(
      f.write.endpointWork().find((item) => item.kind === "replica"),
      {
        batchId: 7,
        kind: "replica",
        target: "http://127.0.0.1:9001",
        status: "retry",
        attempts: 1,
        nextAttemptAt: 130,
        code: "unavailable",
      },
    );
    assertEquals(
      JSON.stringify(diagnostics).includes("remote detail must stay private"),
      false,
    );
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
      replica: { prove: () => Promise.resolve(true) },
      publishRelays: () =>
        Promise.resolve([{ relay: "ws://127.0.0.1:7447", ok: false }]),
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
    assertThrows(
      () => {
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

Deno.test("second generation rolls over an admitted saga with monotonic event time", async () => {
  const f = await fixture();
  try {
    let now = 100;
    const coordinator = new PublicationCoordinator({
      repository: f.write,
      signer: f.signer,
      selector: f.selection,
      identity: { kind: 17091, pubkey: f.pubkey, identifier: "" },
      blossomServers: ["http://127.0.0.1:9001"],
      nixSigKeys: [],
      publicationRelays: ["ws://127.0.0.1:7447"],
      lifetimeSeconds: 3600,
      now: () => now,
      replica: { prove: () => Promise.resolve(true) },
      publishRelays: () =>
        Promise.resolve([{ relay: "ws://127.0.0.1:7447", ok: true }]),
    });
    await coordinator.tick();
    const first = f.write.publicationSaga()!;
    const secondNhash = bech32.encode(
      "nhash",
      bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32).fill(4)])),
      200,
    );
    f.write.recordPending({ id: 8, token: 8, generation: 2, entryCount: 0 }, {
      batchId: 8,
      generation: 2,
      rootHex: "44".repeat(32),
      nhash: secondNhash,
      blobCount: 1,
      totalBytes: 1,
    }, [{ hash: "55".repeat(32), size: 1, path: `${f.root}/a` }]);
    now = 101;
    await coordinator.tick();
    const second = f.write.publicationSaga()!;
    assertEquals(second.candidate.generation, 2);
    assertEquals(second.candidate.rootHex, "44".repeat(32));
    assert(
      (second.signedEvent?.created_at ?? 0) > first.signedEvent!.created_at,
    );
    assertEquals(
      f.write.publicationHistory().some((item) => item.batchId === 7),
      true,
    );
    assertEquals(
      f.write.endpointWork().some((item) => item.batchId === first.batchId),
      false,
      "superseded publication work must not remain retryable",
    );
    await coordinator.close();
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("shutdown cancels hanging signer and rejects its late result", async () => {
  const f = await fixture();
  try {
    const original = f.signer.signEvent.bind(f.signer);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => release = resolve);
    f.signer.signEvent = async (template, signal) => {
      await blocked;
      signal?.throwIfAborted();
      return await original(template, signal);
    };
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
      operationTimeoutMs: 100,
      replica: { prove: () => Promise.resolve(true) },
      publishRelays: () => new Promise(() => {}),
    });
    const tick = coordinator.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.race([
      coordinator.close(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("shutdown did not abort signer")),
          250,
        )
      ),
    ]);
    await tick.catch(() => {});
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(f.write.publicationSaga()?.signedEvent, undefined);
    assertEquals(f.write.publicationSaga()?.committed, false);
  } finally {
    f.selection.dispose();
    f.state.close();
    f.write.close();
    await f.signer.close();
    await Deno.remove(f.root, { recursive: true });
  }
});
