import { assert, assertEquals, assertMatch } from "@std/assert";
import { encode } from "@msgpack/msgpack";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { Subject } from "rxjs";
import { BlobFetcher } from "../../src/blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../../src/blossom/source_plan.ts";
import { PathResolver } from "../../src/hashtree/reader.ts";
import {
  AddressPolicy,
  PinnedTransport,
  SafeFetcher,
} from "../../src/network/safe_fetcher.ts";
import { createNixHttpHandler } from "../../src/nix/http_handler.ts";
import { startPublicationSelection } from "../../src/nostr/selection.ts";
import { StateRepository } from "../../src/persistence/state_repository.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";

interface DaemonFixture {
  event: RawPublication;
  relayUrl: string;
  blossomUrl: string;
  database: string;
  spool: string;
  port: number;
  accessLog: string;
}

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => sha256(bytes).toHex();
const bytes32 = (value: string) => Uint8Array.fromHex(value);

async function command(args: string[], options: Deno.CommandOptions = {}) {
  const output = await new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "piped",
    stderr: "piped",
    ...options,
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (!output.success) throw new Error(`${args.join(" ")} failed: ${stderr}`);
  return { stdout, stderr };
}

async function daemon(fixturePath: string): Promise<void> {
  const fixture = JSON.parse(
    await Deno.readTextFile(fixturePath),
  ) as DaemonFixture;
  const repository = new StateRepository(fixture.database);
  const events = new Subject<RawPublication>();
  const selector = startPublicationSelection({ events, repository });
  const socket = new WebSocket(fixture.relayUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      socket.send(JSON.stringify(["REQ", "nixstr-e2e", { kinds: [17091] }]));
    };
    socket.onmessage = (message) => {
      const frame = JSON.parse(String(message.data));
      if (frame[0] === "EVENT") {
        events.next(frame[2]);
        resolve();
      }
    };
    socket.onerror = () => reject(new Error("relay connection failed"));
  });
  const fetcher = new SafeFetcher(
    new AddressPolicy(async () => ["127.0.0.1"], fixture.blossomUrl),
    new PinnedTransport(),
    { maxRedirects: 3, connectTimeoutMs: 2_000, totalTimeoutMs: 30_000 },
  );
  const blobs = new BlobFetcher({
    fetcher,
    quarantine: repository,
    spoolDirectory: fixture.spool,
  });
  const sources = buildSourcePlan({ configured: fixture.blossomUrl });
  const handler = createNixHttpHandler({
    selection: selector,
    resolverFor: () => {
      const resolver = new PathResolver(blobs, sources, {
        maxWireBytes: 4 * 1024 * 1024,
        maxDecodedBytes: 1024 * 1024,
        maxLinks: 174,
      });
      return {
        async resolve(...args: Parameters<PathResolver["resolve"]>) {
          try {
            return await resolver.resolve(...args);
          } catch (error) {
            console.error(error);
            throw error;
          }
        },
      };
    },
  });
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: fixture.port },
    async (request) => {
      await Deno.writeTextFile(
        fixture.accessLog,
        `${request.method} ${new URL(request.url).pathname}\n`,
        { append: true },
      );
      return await handler(request);
    },
  );
  const stop = () => server.shutdown();
  Deno.addSignalListener("SIGTERM", stop);
  await server.finished;
  socket.close();
  selector.dispose();
  repository.close();
}

if (import.meta.main && Deno.args[0] === "--daemon") {
  await daemon(Deno.args[1]);
} else {
  Deno.test("stock Nix 2.34.7 substitutes solely through the persisted Hashtree daemon", async () => {
    assertEquals(
      (await command(["nix", "--version"])).stdout,
      "nix (Nix) 2.34.7",
    );
    const root = await Deno.makeTempDir({ prefix: "nixstr-e2e-" });
    await Deno.chmod(root, 0o700);
    const source = `${root}/source`,
      cache = `${root}/cache`,
      input = `${root}/input`;
    const spool = `${root}/spool`,
      secret = `${root}/secret`,
      publicKey = `${root}/public`;
    await Promise.all(
      [input, spool].map((path) => Deno.mkdir(path, { recursive: true })),
    );
    await Deno.writeTextFile(
      `${input}/payload`,
      "nixstr-cache walking slice\n",
    );
    let relay: Deno.HttpServer | undefined,
      blossom: Deno.HttpServer | undefined;
    let child: Deno.ChildProcess | undefined;
    try {
      const storePath = (await command([
        "nix",
        "store",
        "add",
        "--store",
        `local?root=${source}`,
        input,
      ])).stdout;
      await command([
        "nix-store",
        "--generate-binary-cache-key",
        "nixstr-e2e-1",
        secret,
        publicKey,
      ]);
      await command([
        "nix",
        "copy",
        "--from",
        `local?root=${source}`,
        "--to",
        `file://${cache}?secret-key=${secret}`,
        storePath,
      ]);
      const storeHash = /^\/nix\/store\/([0-9a-z]{32})-/.exec(storePath)?.[1];
      assert(storeHash, "source store returned a canonical store path");
      const narinfo = await Deno.readFile(`${cache}/${storeHash}.narinfo`);
      const narUrl = /^URL: (.+)$/m.exec(new TextDecoder().decode(narinfo))
        ?.[1];
      assert(narUrl, "generated narinfo declares a NAR URL");
      const nar = await Deno.readFile(`${cache}/${narUrl}`);
      const blobs = new Map<string, Uint8Array>();
      blobs.set(hex(narinfo), narinfo);
      blobs.set(hex(nar), nar);
      const narDirectory = encode({
        t: 2,
        l: [{ h: bytes32(hex(nar)), n: narUrl.slice(4), s: nar.length, t: 0 }],
      });
      blobs.set(hex(narDirectory), narDirectory);
      const rootManifest = encode({
        t: 2,
        l: [
          {
            h: bytes32(hex(narDirectory)),
            n: "nar",
            s: narDirectory.length,
            t: 2,
          },
          {
            h: bytes32(hex(narinfo)),
            n: `${storeHash}.narinfo`,
            s: narinfo.length,
            t: 0,
          },
        ],
      });
      blobs.set(hex(rootManifest), rootManifest);

      let blossomGets = 0, relayRequests = 0;
      blossom = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
        blossomGets++;
        const body = blobs.get(new URL(request.url).pathname.slice(1));
        return body
          ? new Response(body.slice(), {
            headers: { "content-length": String(body.length) },
          })
          : new Response(null, { status: 404 });
      });
      const blossomAddress = blossom.addr as Deno.NetAddr;
      const blossomUrl = `http://127.0.0.1:${blossomAddress.port}`;
      const nhash = bech32.encode(
        "nhash",
        bech32.toWords(Uint8Array.from([0, 32, ...bytes32(hex(rootManifest))])),
        200,
      );
      const publicText = await Deno.readTextFile(publicKey);
      const event = finalizeEvent({
        kind: 17091,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["htree", `htree://${nhash}`],
          ["nixSigKey", publicText.trim()],
          ["blossom", blossomUrl],
        ],
      }, generateSecretKey());
      relay = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
        if (request.headers.get("upgrade") !== "websocket") {
          return new Response(null, { status: 426 });
        }
        const { socket, response } = Deno.upgradeWebSocket(request);
        socket.onmessage = () => {
          relayRequests++;
          socket.send(JSON.stringify(["EVENT", "nixstr-e2e", event]));
          socket.send(JSON.stringify(["EOSE", "nixstr-e2e"]));
        };
        return response;
      });
      const relayAddress = relay.addr as Deno.NetAddr;
      const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const daemonPort = (listener.addr as Deno.NetAddr).port;
      listener.close();
      const fixture: DaemonFixture = {
        event,
        relayUrl: `ws://127.0.0.1:${relayAddress.port}`,
        blossomUrl,
        database: `${root}/state.sqlite`,
        spool,
        port: daemonPort,
        accessLog: `${root}/access.log`,
      };
      const fixturePath = `${root}/fixture.json`;
      await Deno.writeTextFile(fixturePath, JSON.stringify(fixture));

      const startDaemon = async () => {
        const process = new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--allow-net=127.0.0.1",
            `--allow-read=${root},${Deno.cwd()}`,
            `--allow-write=${root}`,
            import.meta.filename!,
            "--daemon",
            fixturePath,
          ],
          stdout: "null",
          stderr: "inherit",
        }).spawn();
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            if (
              (await fetch(`http://127.0.0.1:${daemonPort}/nix-cache-info`)).ok
            ) return process;
          } catch { /* starting */ }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        process.kill("SIGTERM");
        throw new Error("daemon did not start");
      };
      child = await startDaemon();

      const substitute = async (name: string) => {
        const destination = `${root}/${name}`;
        const before = await command([
          "nix",
          "path-info",
          "--store",
          `local?root=${destination}`,
          storePath,
        ], { stderr: "piped" }).catch(() => undefined);
        assertEquals(
          before,
          undefined,
          "target must be absent before substitution",
        );
        await command([
          "nix-store",
          "--store",
          `local?root=${destination}`,
          "--realise",
          storePath,
          "--option",
          "substituters",
          `http://127.0.0.1:${daemonPort}`,
          "--option",
          "trusted-public-keys",
          publicText.trim(),
          "--option",
          "fallback",
          "false",
          "--option",
          "require-sigs",
          "true",
        ]);
        await command([
          "nix-store",
          "--store",
          `local?root=${destination}`,
          "--verify-path",
          storePath,
        ]);
        return await Deno.readTextFile(`${destination}${storePath}/payload`);
      };
      assertEquals(
        await substitute("destination-first"),
        "nixstr-cache walking slice\n",
      );
      child.kill("SIGTERM");
      await child.status;
      child = await startDaemon();
      assertEquals(
        await substitute("destination-repeat"),
        "nixstr-cache walking slice\n",
      );
      assertEquals(
        await Promise.all([
          substitute("destination-a"),
          substitute("destination-b"),
        ]),
        ["nixstr-cache walking slice\n", "nixstr-cache walking slice\n"],
      );
      const log = await Deno.readTextFile(fixture.accessLog);
      assertMatch(log, /GET \/nix-cache-info/);
      assertMatch(log, new RegExp(`GET /${storeHash}\\.narinfo`));
      assertMatch(log, /GET \/nar\//);
      assert(
        relayRequests >= 2,
        "daemon restart must restore through relay admission",
      );
      assert(
        blossomGets >= 12,
        "all isolated substitutions must traverse Blossom-backed Hashtrees",
      );
    } finally {
      if (child) {
        try {
          child.kill("SIGTERM");
          await child.status;
        } catch { /* stopped */ }
      }
      await relay?.shutdown();
      await blossom?.shutdown();
      await Deno.chmod(root, 0o700).catch(() => {});
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  });
}
