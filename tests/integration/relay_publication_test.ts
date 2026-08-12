import { assertEquals } from "@std/assert";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { LocalRelayCache } from "../../src/nostr/local_relay_cache.ts";
import { createControlledRelayFixture } from "../fixtures/publication.ts";

Deno.test("relay acknowledgement correlates exact event ids and rejects hostile frames", async () => {
  const event = finalizeEvent({
    kind: 17091,
    created_at: 1,
    content: "",
    tags: [],
  }, generateSecretKey());
  const fixture = await createControlledRelayFixture();
  try {
    for (const mode of ["false", "foreign", "absent"] as const) {
      fixture.control.mode = mode;
      assertEquals(await fixture.publish(event, 100), false, mode);
    }
    fixture.control.mode = "duplicate-true";
    assertEquals(await fixture.publish(event, 100), true);
    assertEquals(fixture.facts.eventIds.at(-1), event.id);
  } finally {
    await fixture.close();
  }
});

Deno.test("local relay forwards only verified observed and signed events without affecting configured counting", async () => {
  const event = finalizeEvent({
    kind: 17091,
    created_at: 1,
    content: "",
    tags: [],
  }, generateSecretKey());
  const sent: string[] = [];
  const local = new LocalRelayCache("ws://127.0.0.1:7447", (_relay, value) => {
    sent.push(value.id);
    return Promise.resolve(true);
  });
  assertEquals(await local.acceptObserved(event), true);
  assertEquals(await local.publishSigned(event), true);
  assertEquals(
    await local.acceptObserved({ id: "0".repeat(64) } as never),
    false,
  );
  assertEquals(sent, [event.id, event.id]);
});
