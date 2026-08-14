import { assertEquals } from "@std/assert";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import { BudgetExceeded, VerifiedAbsent } from "../../src/hashtree/reader.ts";
import type { SelectedPublication } from "../../src/nostr/selection.ts";
import { createApp, startApp } from "../../src/app.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import { Subject } from "rxjs";
import type { RawPublication } from "../../src/protocol/publication.ts";
import { createConsoleDiagnosticSink } from "../../src/operations/diagnostics.ts";

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

Deno.test("metadata bound|GET/HEAD: route classes preserve metadata and stream NAR", async () => {
  let finalGets = 0;
  const accessLogs: string[] = [];
  const selected = snapshot("old");
  const handler = createNixHttpHandler({
    decodedMetadataBytes: encoder.encode(narinfo).length,
    selection: { current: () => [selected] },
    operationalDiagnostics: createConsoleDiagnosticSink({
      write: (line) => accessLogs.push(line),
      now: () => 0,
    }),
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
  const narinfoLogs = accessLogs.filter((line) => line.includes(".narinfo"));
  assertEquals(narinfoLogs.length, 2);
  assertEquals(
    /^1970-01-01T00:00:00\.000Z INFO {2}GET \/0123456789abcdfghijklmnpqrsvwxyz\.narinfo -> 200 duration=\d+ms$/
      .test(narinfoLogs[0]),
    true,
  );
  assertEquals(
    /^1970-01-01T00:00:00\.000Z INFO {2}HEAD \/0123456789abcdfghijklmnpqrsvwxyz\.narinfo -> 200 duration=\d+ms$/
      .test(narinfoLogs[1]),
    true,
  );
});

Deno.test("GET access logging is immediate while transport completion drives cancellation", async () => {
  const completed = Promise.withResolvers<void>();
  const accessLogs: string[] = [];
  let signal: AbortSignal | undefined;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => [snapshot("x")] },
    operationalDiagnostics: createConsoleDiagnosticSink({
      write: (line) => accessLogs.push(line),
      now: () => 0,
    }),
    resolverFor: () => ({
      resolve: (_root, _path, _method, _budget, requestSignal) => {
        signal = requestSignal;
        return Promise.resolve({
          hash: "x",
          size: 3,
          type: 0,
          body: new Blob([encoder.encode("nar")]).stream(),
        });
      },
    }),
  });

  const response = await handler(
    new Request("http://cache/nar/demo.nar"),
    { completed: completed.promise },
  );
  assertEquals(accessLogs.length, 1);
  assertEquals(
    /^1970-01-01T00:00:00\.000Z INFO {2}GET \/nar\/demo\.nar -> 200 duration=\d+ms$/
      .test(accessLogs[0]),
    true,
  );
  assertEquals(await response.text(), "nar");
  assertEquals(signal?.aborted, false);

  completed.reject(new Error("client disconnected"));
  await Promise.resolve();
  assertEquals(signal?.aborted, true);
  assertEquals(accessLogs.length, 1);
});

Deno.test("http cache request captures one immutable selection before awaits", async () => {
  let current = snapshot("old");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const seen: string[] = [];
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => [current] },
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
      decodedMetadataBytes: 4096,
      selection: { current: () => available ? [snapshot("x")] : [] },
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

Deno.test("metadata bound|GET/HEAD: descriptor over limit rejects before body read", async () => {
  let cancelled = false;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 8,
    selection: { current: () => [snapshot("x")] },
    resolverFor: () => ({
      resolve: () =>
        Promise.resolve({
          hash: "x",
          size: 9,
          type: 0,
          body: new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        }),
    }),
  });
  const result = await handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  assertEquals(result.status, 502);
  assertEquals(cancelled, true);
});

Deno.test("metadata bound|GET/HEAD: streamed overflow cancels before parsing", async () => {
  let cancelled = false;
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 8,
    selection: { current: () => [snapshot("x")] },
    resolverFor: () => ({
      resolve: () =>
        Promise.resolve({
          hash: "x",
          size: 8,
          type: 0,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("12345"));
              controller.enqueue(encoder.encode("6789"));
            },
            cancel() {
              cancelled = true;
            },
          }),
        }),
    }),
  });
  const result = await handler(
    new Request("http://cache/0123456789abcdfghijklmnpqrsvwxyz.narinfo"),
  );
  assertEquals(result.status, 502);
  assertEquals(cancelled, true);
});

Deno.test("startup|shutdown invalid startup has no durable or network side effects", async () => {
  const calls: string[] = [];
  const result = await createApp(
    { caches: "bad", extraRelays: "bad" },
    {
      openRepository: () => {
        calls.push("db");
        throw new Error("unexpected");
      },
      createSelection: () => {
        calls.push("relay");
        throw new Error("unexpected");
      },
      createHandler: () => {
        calls.push("handler");
        throw new Error("unexpected");
      },
    },
  );
  assertEquals(result.ok, false);
  assertEquals(calls, []);
});

Deno.test("handler close is idempotent and rejects later lease acquisition", async () => {
  const handler = createNixHttpHandler({
    decodedMetadataBytes: 4096,
    selection: { current: () => [] },
    resolverFor: () => ({ resolve: () => Promise.reject(new Error("unused")) }),
  });
  handler.close();
  handler.close();
  assertEquals(
    (await handler(new Request("http://cache/nix-cache-info"))).status,
    503,
  );
});

Deno.test("startup|shutdown restores before binding and releases lifecycle resources", async () => {
  const calls: string[] = [];
  const app = await createApp({
    caches: "a".repeat(64),
    extraRelays: "wss://relay.example",
    databasePath: "/tmp/nixstr-test.sqlite",
  }, {
    openRepository: () => ({ close: () => calls.push("db-close") }),
    createSelection: () => ({ dispose: () => calls.push("selection-dispose") }),
    createHandler: () => {
      calls.push("handler-after-restore");
      return () => new Response("ok");
    },
  });
  if (!app.ok) throw new Error("expected valid app");
  const running = startApp(app.value, (_handler, options) => {
    calls.push(`bind:${options.hostname}:${options.port}`);
    return {
      shutdown: () => {
        calls.push("listener-close");
        return Promise.resolve();
      },
    };
  });
  assertEquals(calls, ["handler-after-restore", "bind:127.0.0.1:8787"]);
  await running.shutdown();
  assertEquals(calls, [
    "handler-after-restore",
    "bind:127.0.0.1:8787",
    "listener-close",
    "selection-dispose",
    "db-close",
  ]);
});

Deno.test("production launcher validates before side effects and closes after listener failure", async () => {
  const calls: string[] = [];
  const invalid = await launchDaemon(
    { caches: "bad", extraRelays: "bad" },
    {
      createEventStream: () => {
        calls.push("relay");
        return { events: new Subject<RawPublication>(), close() {} };
      },
      bind: () => {
        calls.push("bind");
        return { shutdown: () => Promise.resolve() };
      },
      signals: [],
    },
  );
  assertEquals(invalid.ok, false);
  assertEquals(calls, []);

  const root = await Deno.makeTempDir();
  try {
    const running = await launchDaemon({
      caches: "a".repeat(64),
      extraRelays: "ws://127.0.0.1:1",
      databasePath: `${root}/state.sqlite`,
    }, {
      createEventStream: () => {
        calls.push("relay");
        return {
          events: new Subject<RawPublication>(),
          close: () => calls.push("relay-close"),
        };
      },
      bind: () => {
        calls.push("bind");
        return {
          shutdown: () => {
            calls.push("listener-close");
            return Promise.reject(new Error("injected listener failure"));
          },
        };
      },
      signals: [],
    });
    if (!running.ok) throw new Error(running.diagnostics.join(", "));
    await running.shutdown().catch(() => {});
    await running.shutdown().catch(() => {});
    assertEquals(calls, ["relay", "bind", "listener-close", "relay-close"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
