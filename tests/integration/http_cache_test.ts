import { assertEquals } from "@std/assert";
import { Subject } from "rxjs";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import { BudgetExceeded, VerifiedAbsent } from "../../src/hashtree/reader.ts";
import type { SelectedPublication } from "../../src/nostr/selection.ts";

const encoder = new TextEncoder();
const narinfo = [
  "StorePath: /nix/store/0123456789abcdfghijklmnpqrsvwxyz-demo",
  "URL: nar/demo.nar",
  "Compression: none",
  "FileHash: sha256:0123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
  "FileSize: 3",
  "NarHash: sha256:0123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
  "NarSize: 3",
  "References: ",
  "Sig: other:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  "",
].join("\n");

function snapshot(id: string): SelectedPublication {
  return {
    event: {
      id,
      pubkey: "a".repeat(64),
      created_at: 1,
      kind: 17091,
      tags: [],
      content: "",
      sig: "",
    },
    identity: { kind: 17091, pubkey: "a".repeat(64) },
    root: { bytes: new Uint8Array(32), hex: id.padEnd(64, "0") },
    nixSigKeys: [],
    blossomServers: [],
  } as unknown as SelectedPublication;
}

Deno.test("http cache GET/HEAD route classes preserve metadata and stream NAR", async () => {
  let finalGets = 0;
  const selected = snapshot("old");
  const handler = createNixHttpHandler({
    selection: { current: () => selected },
    resolverFor: () => ({
      resolve: (_root, path, method) => {
        if (path.endsWith(".narinfo")) {
          const bytes = encoder.encode(narinfo);
          return Promise.resolve({
            hash: "1",
            size: bytes.length,
            type: 0,
            ...(method === "GET" ? { body: new Blob([bytes]).stream() } : {}),
          });
        }
        if (path === "nar/demo.nar") {
          if (method === "GET") finalGets++;
          return Promise.resolve({
            hash: "2",
            size: 3,
            type: 0,
            ...(method === "GET"
              ? { body: new Blob([encoder.encode("nar")]).stream() }
              : {}),
          });
        }
        return Promise.reject(new VerifiedAbsent(path));
      },
    }),
  });
  const info = await handler(new Request("http://cache/nix-cache-info"));
  assertEquals(info.status, 200);
  assertEquals(
    await info.text(),
    "StoreDir: /nix/store\nWantMassQuery: 1\nPriority: 40\n",
  );
  const metadata = await handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  assertEquals(await metadata.text(), narinfo);
  const headMetadata = await handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo", {
      method: "HEAD",
    }),
  );
  assertEquals(headMetadata.status, 200);
  assertEquals(await headMetadata.text(), "");
  const headNar = await handler(
    new Request("http://cache/nar/demo.nar", { method: "HEAD" }),
  );
  assertEquals(headNar.headers.get("content-length"), "3");
  assertEquals(finalGets, 0);
  assertEquals(
    await (await handler(new Request("http://cache/nar/demo.nar"))).text(),
    "nar",
  );
  assertEquals(finalGets, 1);
});

Deno.test("http cache request captures one immutable selection before awaits", async () => {
  let current = snapshot("old");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const seen: string[] = [];
  const handler = createNixHttpHandler({
    selection: { current: () => current },
    resolverFor: (selected) => ({
      async resolve() {
        seen.push(selected.event.id);
        await gate;
        const bytes = encoder.encode(
          narinfo.replace("demo", selected.event.id),
        );
        return {
          hash: "x",
          size: bytes.length,
          type: 0,
          body: new Blob([bytes]).stream(),
        };
      },
    }),
  });
  const first = handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  current = snapshot("new");
  const second = handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  release();
  assertEquals((await (await first).text()).includes("old"), true);
  assertEquals((await (await second).text()).includes("new"), true);
  assertEquals(seen, ["old", "new"]);
});

Deno.test("http cache maps methods, absence, availability, deadline and upstream errors", async () => {
  const make = (error?: Error, available = true) =>
    createNixHttpHandler({
      selection: { current: () => available ? snapshot("x") : undefined },
      resolverFor: () => ({
        resolve: () => Promise.reject(error ?? new Error("upstream")),
      }),
    });
  assertEquals(
    (await make()(new Request("http://cache/x", { method: "PUT" }))).status,
    405,
  );
  assertEquals(
    (await make()(new Request("http://cache/x", { method: "PUT" }))).headers
      .get("allow"),
    "GET, HEAD",
  );
  assertEquals(
    (await make(undefined, false)(
      new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
    ))
      .status,
    503,
  );
  assertEquals(
    (await make(new VerifiedAbsent("x"))(
      new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
    ))
      .status,
    404,
  );
  assertEquals(
    (await make(new BudgetExceeded("request deadline exceeded"))(
      new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
    )).status,
    504,
  );
  assertEquals(
    (await make()(
      new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
    )).status,
    502,
  );
  assertEquals(
    (await make()(new Request("http://cache/not-valid"))).status,
    404,
  );
});
