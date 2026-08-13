import { assert, assertEquals, assertMatch } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { createPublicationFixture } from "../fixtures/publication.ts";

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

async function waitUntil<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  description: string,
): Promise<T> {
  for (let attempt = 0; attempt < 1200; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function removeNixStoreRoot(path: string): Promise<void> {
  try {
    for await (const entry of Deno.readDir(path)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) await removeNixStoreRoot(child);
      else await Deno.chmod(child, 0o600).catch(() => {});
    }
    await Deno.chmod(path, 0o700).catch(() => {});
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

Deno.test("stock Nix uploads through production and substitutes from the newly published root", async () => {
  assertMatch(
    (await command(["nix", "--version"])).stdout,
    /^nix \(Nix\) 2\.(?:34\.7|35\.1)$/,
  );
  const root = await Deno.makeTempDir({ prefix: "nixstr-publish-e2e-" });
  await Deno.chmod(root, 0o700);
  const fixture = await createPublicationFixture();
  let child: Deno.ChildProcess | undefined;
  try {
    const source = `${root}/source`;
    const destination = `${root}/destination`;
    const input = `${root}/input`;
    const nixSecret = `${root}/nix-secret`;
    const nixPublic = `${root}/nix-public`;
    const nostrKey = generateSecretKey();
    const nostrPubkey = getPublicKey(nostrKey);
    await Deno.mkdir(input);
    await Deno.writeTextFile(`${input}/payload`, "published by nixstr-cache\n");
    await Deno.writeFile(`${root}/nostr-key`, nostrKey, { mode: 0o600 });
    nostrKey.fill(0);
    await command([
      "nix-store",
      "--generate-binary-cache-key",
      "nixstr-publish-1",
      nixSecret,
      nixPublic,
    ]);
    await Deno.chmod(nixSecret, 0o600);
    const nixPublicText = (await Deno.readTextFile(nixPublic)).trim();
    const storePath = (await command([
      "nix",
      "store",
      "add",
      "--store",
      `local?root=${source}`,
      input,
    ])).stdout;
    const storeHash = /^\/nix\/store\/([0-9a-z]{32})-/.exec(storePath)?.[1];
    assert(storeHash);

    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const daemonPort = (listener.addr as Deno.NetAddr).port;
    listener.close();
    child = new Deno.Command(Deno.execPath(), {
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
        NIXSTR_CACHES: `17091:${nostrPubkey}:`,
        NIXSTR_RELAY_URLS: fixture.relayUrl,
        NIXSTR_PREFERRED_BLOSSOM_URL: fixture.blossomUrl,
        NIXSTR_DATABASE_PATH: `${root}/state.sqlite`,
        NIXSTR_SPOOL_DIRECTORY: `${root}/spool`,
        NIXSTR_WRITABLE_ENABLED: "true",
        NIXSTR_WRITABLE_TYPE: "root",
        NIXSTR_WRITABLE_SIGNER_TYPE: "local",
        NIXSTR_WRITABLE_SIGNER_PATH: `${root}/nostr-key`,
        NIXSTR_WRITABLE_STAGING_DIRECTORY: `${root}/staging`,
        NIXSTR_WRITABLE_PUBLICATION_NIX_SIG_KEYS: nixPublicText,
      },
    }).spawn();
    await waitUntil(
      () =>
        fetch(`http://127.0.0.1:${daemonPort}/health`).then((r) => r.json())
          .catch(() => undefined),
      (health) => Boolean(health && health.write?.status === "ready"),
      "production daemon write readiness",
    );

    await command([
      "nix",
      "copy",
      "--from",
      `local?root=${source}`,
      "--to",
      `http://127.0.0.1:${daemonPort}`,
      storePath,
    ]);
    const event = await fixture.waitForPublication(20_000);
    assertEquals(event.pubkey, nostrPubkey);
    const rootTag = event.tags.find((tag) => tag[0] === "htree")?.[1];
    assertMatch(rootTag ?? "", /^htree:\/\/nhash1/);
    assert(
      fixture.blobCount > 0,
      "publication must upload immutable tree blobs",
    );
    const secondInput = `${root}/second-input`;
    await Deno.mkdir(secondInput);
    await Deno.writeTextFile(`${secondInput}/payload`, "second generation\n");
    const secondStorePath = (await command([
      "nix",
      "store",
      "add",
      "--store",
      `local?root=${source}`,
      secondInput,
    ])).stdout;
    await command([
      "nix",
      "copy",
      "--from",
      `local?root=${source}`,
      "--to",
      `http://127.0.0.1:${daemonPort}`,
      secondStorePath,
    ]);
    const secondEvent = await waitUntil(
      () => fixture.publishedEvents[1],
      (value) => value !== undefined,
      "second publication",
    );
    assert(secondEvent);
    assert(secondEvent.created_at > event.created_at);
    const secondRoot = secondEvent.tags.find((tag) => tag[0] === "htree")?.[1];
    assert(secondRoot && secondRoot !== rootTag);

    await removeNixStoreRoot(source);
    await Deno.remove(input, { recursive: true });
    await Deno.remove(secondInput, { recursive: true });
    assertEquals(
      await command([
        "nix",
        "path-info",
        "--store",
        `local?root=${destination}`,
        storePath,
      ]).catch(() => undefined),
      undefined,
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
      nixPublicText,
      "--option",
      "fallback",
      "false",
      "--option",
      "require-sigs",
      "true",
    ]);
    assertEquals(
      await Deno.readTextFile(`${destination}${storePath}/payload`),
      "published by nixstr-cache\n",
    );
    await command([
      "nix-store",
      "--store",
      `local?root=${destination}`,
      "--realise",
      secondStorePath,
      "--option",
      "substituters",
      `http://127.0.0.1:${daemonPort}`,
      "--option",
      "trusted-public-keys",
      nixPublicText,
      "--option",
      "fallback",
      "false",
      "--option",
      "require-sigs",
      "true",
    ]);
    assertEquals(
      await Deno.readTextFile(`${destination}${secondStorePath}/payload`),
      "second generation\n",
    );
  } finally {
    if (child) {
      try {
        child.kill("SIGTERM");
        await child.status;
      } catch { /* stopped */ }
    }
    await fixture.close();
    await removeNixStoreRoot(root).catch(() => {});
  }
});
