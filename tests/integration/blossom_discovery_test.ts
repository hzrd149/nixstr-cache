import { assertEquals } from "@std/assert";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import {
  type SelectedPublication,
  startPublicationSelection,
} from "../../src/nostr/selection.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { parseConfig } from "../../src/config/config.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";
import { createProductionDependencies } from "../../src/runtime/daemon.ts";

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
    assertEquals(captured[0]?.bud03Servers, [
      "https://one.example",
      "https://two.example/path",
    ]);
    events.next(servers(90, [["server", "https://stale.example"]]));
    assertEquals(
      selector.current()[0]?.bud03Servers,
      captured[0]?.bud03Servers,
    );
    events.next(
      servers(92, [["server", "https://new.example"]], generateSecretKey()),
    );
    assertEquals(
      selector.current()[0]?.bud03Servers,
      captured[0]?.bud03Servers,
    );
    events.next(servers(93, [["server", "https://fresh.example"]]));
    assertEquals(selector.current()[0]?.bud03Servers, [
      "https://fresh.example",
    ]);
    assertEquals(captured[0]?.bud03Servers, [
      "https://one.example",
      "https://two.example/path",
    ]);
    selector.dispose();
    repository.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("production BUD-03 wiring feeds configured, event, then server list sources", async () => {
  const root = await Deno.makeTempDir();
  const eventStream = new Subject<RawPublication>();
  let streamDisposed = 0;
  try {
    const parsed = parseConfig({
      caches: publisher,
      relayUrls: "ws://127.0.0.1:9000",
      preferredBlossomUrl: "http://127.0.0.1:8000",
      databasePath: `${root}/state.sqlite`,
      spoolDirectory: `${root}/spool`,
    });
    if (!parsed.ok) throw new Error("fixture config invalid");
    const dependencies = createProductionDependencies({
      createEventStream: () => ({
        events: eventStream,
        dispose: () => streamDisposed++,
      }),
    });
    const repository = dependencies.openRepository(
      parsed.value,
    ) as StateRepository;
    const selection = dependencies.createSelection(
      repository,
      parsed.value,
    ) as {
      current(): readonly SelectedPublication[];
      dispose(): void;
    };
    const published = finalizeEvent({
      kind: 17091,
      created_at: 90,
      content: "",
      tags: [
        ["htree", `htree://${nhash}`],
        ["blossom", "https://event.example"],
      ],
    }, secret);
    eventStream.next(published);
    eventStream.next(servers(91, [
      ["server", "https://bud.example"],
      ["server", "https://event.example"],
    ]));
    const snapshot = selection.current()[0];
    const plan = buildSourcePlan({
      configured: parsed.value.preferredBlossomUrl,
      event: snapshot.blossomServers,
      bud03: snapshot.bud03Servers,
    });
    assertEquals(
      plan.map((candidate) => [candidate.baseUrl, candidate.trust]),
      [
        ["http://127.0.0.1:8000", "configured"],
        ["https://event.example", "publisher"],
        ["https://bud.example", "publisher"],
      ],
    );
    eventStream.next(servers(92, [["server", "https://replacement.example"]]));
    assertEquals(snapshot.bud03Servers, [
      "https://bud.example",
      "https://event.example",
    ]);
    assertEquals(selection.current()[0]?.bud03Servers, [
      "https://replacement.example",
    ]);
    selection.dispose();
    selection.dispose();
    assertEquals(streamDisposed, 1);
    repository.close();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
