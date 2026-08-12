import { assertEquals } from "@std/assert";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import {
  RawPublication,
  validatePublication,
} from "../../src/protocol/publication.ts";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { DatabaseSync } from "node:sqlite";

const secret = generateSecretKey();
const publisher = getPublicKey(secret);
const authorization = {
  publisherPubkeys: [publisher],
  identities: [`17091:${publisher}:`],
};
const root = new Uint8Array(32).fill(4);
const nhash = bech32.encode(
  "nhash",
  bech32.toWords(Uint8Array.from([0, 32, ...root])),
  200,
);
const key = `cache:${btoa(String.fromCharCode(...new Uint8Array(32)))}`;

function event(
  createdAt: number,
  options: { signed?: boolean; expires?: number; content?: string } = {},
): RawPublication {
  const tags = [["htree", `htree://${nhash}`]];
  if (options.signed !== false) tags.push(["nixSigKey", key]);
  if (options.expires !== undefined) {
    tags.push(["expiration", String(options.expires)]);
  }
  return finalizeEvent({
    kind: 17091,
    created_at: createdAt,
    content: options.content ?? "",
    tags,
  }, secret);
}

async function tempDb(): Promise<string> {
  return await Deno.makeTempFile({ suffix: ".sqlite" });
}

Deno.test("selection commits before emission, survives restart, and rejects stale candidates", async () => {
  const path = await tempDb();
  try {
    const events = new Subject<RawPublication>();
    const repository = new StateRepository(path);
    const selector = startPublicationSelection({
      ...authorization,
      events,
      repository,
      now: () => 100,
    });
    const emissions: string[] = [];
    selector.selected$.subscribe((selected) =>
      selected && emissions.push(selected.event.id)
    );
    const newest = event(90, { content: "new" });
    events.next(newest);
    assertEquals(
      repository.loadSelection(selector.identity!)?.event.id,
      newest.id,
    );
    assertEquals(emissions, [newest.id]);
    events.next(event(89, { content: "old" }));
    assertEquals(selector.current()?.event.id, newest.id);
    selector.dispose();
    repository.close();

    const restartedRepository = new StateRepository(path);
    const restarted = startPublicationSelection({
      ...authorization,
      events: new Subject<RawPublication>(),
      repository: restartedRepository,
      identities: [`17091:${newest.pubkey}:`],
      now: () => 100,
    });
    assertEquals(restarted.current()?.event.id, newest.id);
    restarted.dispose();
    restartedRepository.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("equal timestamps use lowest event id and never roll back after restart", async () => {
  const path = await tempDb();
  try {
    const repository = new StateRepository(path);
    const a = validatePublication(event(90, { content: "a" }), 100);
    const b = validatePublication(event(90, { content: "b" }), 100);
    if (!a.ok || !b.ok) throw new Error("fixture invalid");
    const winner = a.value.event.id < b.value.event.id ? a.value : b.value;
    const loser = winner === a.value ? b.value : a.value;
    assertEquals(repository.accept(loser).accepted, true);
    assertEquals(repository.accept(winner).accepted, true);
    assertEquals(repository.accept(loser).accepted, false);
    assertEquals(
      repository.loadSelection(`17091:${winner.event.pubkey}:`)?.event.id,
      winner.event.id,
    );
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("expiry clears availability without selecting older state", async () => {
  const path = await tempDb();
  try {
    let now = 100;
    let expiryCallback: (() => void) | undefined;
    const events = new Subject<RawPublication>();
    const repository = new StateRepository(path);
    const selector = startPublicationSelection({
      ...authorization,
      events,
      repository,
      now: () => now,
      schedule: (callback) => {
        expiryCallback = callback;
        return 1;
      },
      cancelSchedule: () => {},
    });
    const expiring = event(90, { expires: 110 });
    events.next(expiring);
    assertEquals(selector.current()?.event.id, expiring.id);
    now = 110;
    expiryCallback?.();
    assertEquals(selector.current(), undefined);
    events.next(event(89));
    assertEquals(selector.current(), undefined);
    repository.close();
    selector.dispose();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("signed history requires durable explicit unsigned consent", async () => {
  const path = await tempDb();
  try {
    const repository = new StateRepository(path);
    const signed = validatePublication(event(90), 100);
    const unsigned = validatePublication(event(91, { signed: false }), 100);
    if (!signed.ok || !unsigned.ok) throw new Error("fixture invalid");
    const identity = `17091:${signed.value.event.pubkey}:`;
    assertEquals(repository.accept(signed.value).accepted, true);
    assertEquals(
      repository.accept(unsigned.value).reason,
      "downgrade-consent-required",
    );
    repository.setUnsignedConsent(identity, true);
    assertEquals(repository.accept(unsigned.value).accepted, true);
    repository.close();
    const restarted = new StateRepository(path);
    assertEquals(restarted.loadPolicy(identity).unsignedConsent, true);
    assertEquals(restarted.loadPolicy(identity).signedHistory, true);
    restarted.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("transaction failure cannot emit an uncommitted selection", async () => {
  const path = await tempDb();
  try {
    const events = new Subject<RawPublication>();
    const repository = new StateRepository(path, {
      beforeCommit: () => {
        throw new Error("injected");
      },
    });
    const errors: unknown[] = [];
    const selector = startPublicationSelection({
      ...authorization,
      events,
      repository,
      now: () => 100,
      onError: (error) => errors.push(error),
    });
    events.next(event(90));
    assertEquals(selector.current(), undefined);
    assertEquals(errors.length, 1);
    selector.dispose();
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("unauthorized publisher and raw identity reject before persistence", async () => {
  const path = await tempDb();
  try {
    const repository = new StateRepository(path);
    const events = new Subject<RawPublication>();
    const reasons: string[] = [];
    const selector = startPublicationSelection({
      ...authorization,
      events,
      repository,
      now: () => 100,
      onReject: (_event, reason) => reasons.push(reason),
    });
    const foreign = finalizeEvent({
      kind: 17091,
      created_at: 90,
      content: "",
      tags: [["htree", `htree://${nhash}`]],
    }, generateSecretKey());
    events.next(foreign);
    const named = finalizeEvent({
      kind: 37091,
      created_at: 91,
      content: "",
      tags: [["d", "other"], ["htree", `htree://${nhash}`]],
    }, secret);
    events.next(named);
    assertEquals(reasons, ["unauthorized-publisher", "unauthorized-identity"]);
    assertEquals(repository.loadSelections(), []);
    selector.dispose();
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("corrupt stored selections are cleared in isolation without policy loss", async () => {
  const path = await tempDb();
  try {
    let repository = new StateRepository(path);
    const valid = validatePublication(event(90), 100);
    if (!valid.ok) throw new Error("fixture invalid");
    assertEquals(repository.accept(valid.value).accepted, true);
    const validIdentity = `17091:${valid.value.event.pubkey}:`;
    repository.setUnsignedConsent(validIdentity, true);
    repository.close();

    const db = new DatabaseSync(path);
    db.prepare(`
      INSERT INTO identity_state
        (identity, event_json, created_at, event_id, signed_history, unsigned_consent)
      VALUES (?, ?, ?, ?, 1, 1)
    `).run("17091:" + "b".repeat(64) + ":", "{bad", 88, "bad");
    db.close();

    repository = new StateRepository(path);
    const corrupt: string[] = [];
    const restored = repository.loadSelections(({ identity }) =>
      corrupt.push(identity)
    );
    assertEquals(restored.map((item) => item.identity), [validIdentity]);
    assertEquals(corrupt, [`17091:${"b".repeat(64)}:`]);
    assertEquals(repository.loadPolicy(validIdentity), {
      signedHistory: true,
      unsignedConsent: true,
    });
    assertEquals(repository.loadPolicy(corrupt[0]), {
      signedHistory: true,
      unsignedConsent: true,
    });
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});
