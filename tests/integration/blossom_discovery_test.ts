import { assertEquals } from "@std/assert";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";

const secret = generateSecretKey();
const publisher = getPublicKey(secret);
const nhash = bech32.encode(
  "nhash",
  bech32.toWords(Uint8Array.from([0, 32, ...new Uint8Array(32).fill(7)])),
  200,
);

function publication(): RawPublication {
  return finalizeEvent({
    kind: 17091,
    created_at: 90,
    content: "",
    tags: [["htree", `htree://${nhash}`]],
  }, secret);
}
function servers(
  createdAt: number,
  tags: string[][],
  key = secret,
): RawPublication {
  return finalizeEvent({
    kind: 10063,
    created_at: createdAt,
    content: "",
    tags,
  }, key);
}

Deno.test("BUD-03 server list is authenticated, ordered, reactive, and immutable", async () => {
  const path = await Deno.makeTempFile({ suffix: ".sqlite" });
  try {
    const events = new Subject<RawPublication>();
    const repository = new StateRepository(path);
    const selector = startPublicationSelection({
      events,
      repository,
      publisherPubkeys: [publisher],
      identities: [`17091:${publisher}:`],
      now: () => 100,
    });
    events.next(publication());
    events.next(servers(91, [
      ["server", "https://one.example"],
      ["server", "ftp://bad.example"],
      ["server", "https://two.example/path"],
      ["server", "https://bad.example/?query=yes"],
      ["server", "https://user:pass@bad.example"],
      ["server", "https://three.example", "extra"],
    ]));
    const captured = selector.current();
    assertEquals(captured?.bud03Servers, [
      "https://one.example",
      "https://two.example/path",
    ]);
    events.next(servers(90, [["server", "https://stale.example"]]));
    assertEquals(selector.current()?.bud03Servers, captured?.bud03Servers);
    events.next(
      servers(92, [["server", "https://new.example"]], generateSecretKey()),
    );
    assertEquals(selector.current()?.bud03Servers, captured?.bud03Servers);
    events.next(servers(93, [["server", "https://fresh.example"]]));
    assertEquals(selector.current()?.bud03Servers, ["https://fresh.example"]);
    assertEquals(captured?.bud03Servers, [
      "https://one.example",
      "https://two.example/path",
    ]);
    selector.dispose();
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});
