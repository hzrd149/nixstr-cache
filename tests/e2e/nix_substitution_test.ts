import { assert, assertEquals, assertMatch } from "@std/assert";
import { encode } from "@msgpack/msgpack";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

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

Deno.test("stock Nix substitutes cold and reuses the shared store after restart", async () => {
  assertMatch(
    (await command(["nix", "--version"])).stdout,
    /^nix \(Nix\) 2\.(?:34\.7|35\.1)$/,
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

    let blossomGets = 0, relayRequests = 0, remoteOnline = true;
    const blossomPaths: string[] = [];
    blossom = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
      blossomGets++;
      const pathname = new URL(request.url).pathname;
      blossomPaths.push(`${request.method} ${pathname}`);
      if (!remoteOnline) return new Response(null, { status: 503 });
      const body = blobs.get(pathname.slice(1));
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
    const makeEvent = () =>
      finalizeEvent({
        kind: 17091,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["htree", `htree://${nhash}`],
          ["nixSigKey", publicText.trim()],
          ["blossom", blossomUrl],
        ],
      }, generateSecretKey());
    const event = makeEvent();
    const secondEvent = makeEvent();
    relay = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response(null, { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onmessage = (message) => {
        relayRequests++;
        const frame = JSON.parse(String(message.data));
        if (frame[0] !== "REQ") return;
        socket.send(JSON.stringify(["EVENT", frame[1], event]));
        socket.send(JSON.stringify(["EVENT", frame[1], secondEvent]));
        socket.send(JSON.stringify(["EOSE", frame[1]]));
      };
      return response;
    });
    const relayAddress = relay.addr as Deno.NetAddr;
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const daemonPort = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const startDaemon = async () => {
      const process = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-env",
          "--allow-net=127.0.0.1",
          `--allow-read=${root},${Deno.cwd()}`,
          `--allow-write=${root}`,
          `${Deno.cwd()}/main.ts`,
        ],
        stdout: "null",
        stderr: "inherit",
        env: {
          NIXSTR_BIND_HOST: "127.0.0.1",
          NIXSTR_BIND_PORT: String(daemonPort),
          NIXSTR_CACHES: `17091:${event.pubkey}:,17091:${secondEvent.pubkey}:`,
          NIXSTR_EXTRA_RELAYS: `ws://127.0.0.1:${relayAddress.port}`,
          NIXSTR_EXTRA_SERVERS: blossomUrl,
          NIXSTR_DATABASE_PATH: `${root}/state.sqlite`,
          NIXSTR_SPOOL_DIRECTORY: spool,
        },
      }).spawn();
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          if (
            (await fetch(
              `http://127.0.0.1:${daemonPort}/${storeHash}.narinfo`,
            )).ok
          ) return process;
        } catch { /* starting */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      try {
        process.kill("SIGTERM");
      } catch { /* already stopped */ }
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
    const coldBlossomGets = blossomGets;
    remoteOnline = false;
    child.kill("SIGTERM");
    assertEquals((await child.status).success, true);
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
    assertMatch(blossomPaths.join("\n"), /GET \/[0-9a-f]{64}/);
    assertEquals(
      blossomGets,
      coldBlossomGets,
      "warm substitutions must use the shared store without remote requests",
    );
    assert(
      relayRequests >= 2,
      "daemon restart must restore through relay admission",
    );
    assert(blossomGets >= 4, "first substitution must traverse remote Blossom");
    child.kill("SIGTERM");
    assertEquals((await child.status).success, true);
    child = undefined;
    assertEquals(await Array.fromAsync(Deno.readDir(spool)), []);
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
