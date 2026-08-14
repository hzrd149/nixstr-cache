import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import type { RawConfig } from "../../src/config/config.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import { createSignerCapability } from "../../src/signer/capability.ts";
import { WriteRepository } from "../../src/persistence/write_repository.ts";
import {
  createNostrConnectFixture,
  type NostrConnectOutcome,
} from "../fixtures/nostr_connect.ts";

const deadline = 4_000;

async function scenario(
  kind: 17091 | 37091,
  outcome: NostrConnectOutcome,
) {
  const root = await Deno.makeTempDir({ prefix: "nixstr-nip46-" });
  let expectedOwner = getPublicKey(generateSecretKey());
  const fixture = await createNostrConnectFixture({
    outcome,
    returnedOwner: outcome === "mismatch"
      ? getPublicKey(generateSecretKey())
      : expectedOwner,
  });
  if (outcome === "success") expectedOwner = fixture.remoteOwner;
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  const diagnostics: unknown[][] = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...values) => diagnostics.push(values);
  console.error = (...values) => diagnostics.push(values);
  try {
    const sessionPath = `${root}/session`;
    await Deno.writeTextFile(sessionPath, fixture.nbunksec, { mode: 0o600 });
    const raw: RawConfig = {
      caches: expectedOwner,
      extraRelays: fixture.relayUrl,
      databasePath: `${root}/state.sqlite`,
      spoolDirectory: `${root}/spool`,
      writable: {
        enabled: true,
        type: kind === 17091 ? "root" : "named",
        ...(kind === 37091 ? { name: "named" } : {}),
        signer: { type: "nip46", path: sessionPath },
        staging: { directory: `${root}/staging` },
      },
    };
    const daemon = await launchDaemon(raw, {
      createEventStream: () => ({
        events: new Subject<RawPublication>(),
        close() {},
      }),
      bind: (bound) => {
        handler = bound;
        return { shutdown: () => Promise.resolve() };
      },
      signals: [],
    });
    assert(daemon.ok);
    assert(handler);
    const put = () =>
      handler!(
        new Request("http://cache/nar/probe.nar", {
          method: "PUT",
          body: "probe",
        }),
      );
    assertEquals((await put()).status, 405);

    await fixture.waitForRequests(1, deadline);
    if (outcome === "success" || outcome === "mismatch") {
      const started = performance.now();
      while (
        !JSON.stringify(diagnostics).includes("nip46 authorization required")
      ) {
        if (performance.now() - started >= deadline) {
          throw new Error(
            "timed out waiting for headless authorization callback",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await fixture.completeAuthorization();
    }
    if (
      outcome === "success" || outcome === "mismatch" ||
      outcome === "denied" || outcome === "failed"
    ) {
      await fixture.waitForRequests(2, deadline);
    }
    if (outcome === "success") {
      assertEquals(
        (await put()).status,
        405,
        "signer authorization alone must not bypass the BUD-03 destination gate",
      );
      assertEquals(fixture.facts.methods[0], "connect");
      assert(
        fixture.facts.methods.slice(1).every((method) =>
          method === "get_public_key"
        ),
      );
      assertEquals(fixture.facts.permissions, [
        `get_public_key,sign_event:${kind},sign_event:24242`,
      ]);
    } else {
      assertEquals((await put()).status, 405);
      assertEquals(await fixture.stagedFiles(`${root}/staging`), []);
    }

    await daemon.shutdown();
    await daemon.shutdown();
    await fixture.waitForSocketClose(deadline);
    const serialized = JSON.stringify(diagnostics);
    for (const secret of fixture.sensitiveValues) {
      assert(
        !serialized.includes(secret),
        "diagnostics must remain secret-safe",
      );
    }
  } finally {
    console.warn = warn;
    console.error = error;
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("production NIP-46 authorizes owners without bypassing BUD-03 readiness", async () => {
  await scenario(17091, "success");
  await scenario(37091, "success");
});

Deno.test("production NIP-46 fails closed for denial and connection failure", async () => {
  await scenario(17091, "denied");
  await scenario(17091, "failed");
});

Deno.test("inline nbunksec delegates publication through the owned NIP-46 capability", async () => {
  const root = await Deno.makeTempDir({ prefix: "nixstr-nip46-sign-" });
  const fixture = await createNostrConnectFixture({
    outcome: "success",
    returnedOwner: getPublicKey(generateSecretKey()),
  });
  const owner = fixture.remoteOwner;
  try {
    const capability = createSignerCapability({
      intent: {
        mode: "nbunksec",
        identity: { kind: 17091, identifier: "" },
        nbunksec: fixture.nbunksec,
      },
      createNip46Signer: async (session, permissionKind) => {
        const { RelayPool } = await import("applesauce-relay");
        const { NostrConnectSigner } = await import(
          "applesauce-signers/signers/nostr-connect-signer"
        );
        const pool = new RelayPool();
        const remote = await NostrConnectSigner.fromNbunksec(session, {
          permissions: NostrConnectSigner.buildSigningPermissions([
            permissionKind,
          ]),
          subscriptionMethod: (relays, filters) =>
            pool.subscription(relays, filters),
          publishMethod: (relays, event) => pool.publish(relays, event),
          onAuth: async () => {},
        });
        return {
          getPublicKey: () => remote.getPublicKey(),
          signEvent: (template) => remote.signEvent(template),
          async close() {
            await remote.close();
            pool.close();
          },
        };
      },
    });
    const starting = capability.start();
    await fixture.waitForRequests(1, deadline);
    await fixture.completeAuthorization();
    await starting;
    const event = await capability.signEvent({
      kind: 17091,
      created_at: 1,
      tags: [["x", "root"]],
      content: "",
    });
    assertEquals(event.pubkey, owner);
    assert(fixture.facts.methods.includes("sign_event"));
    await capability.close();
  } finally {
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("durable owner mismatch prints a prominent warning before closing nbunksec", async () => {
  const root = await Deno.makeTempDir({
    prefix: "nixstr-nip46-owner-mismatch-",
  });
  const fixture = await createNostrConnectFixture({
    outcome: "success",
    returnedOwner: getPublicKey(generateSecretKey()),
  });
  const databasePath = `${root}/state.sqlite`;
  const stagingDirectory = `${root}/staging`;
  const durablePubkey = getPublicKey(generateSecretKey());
  const repository = new WriteRepository(
    `${databasePath}.writes`,
    stagingDirectory,
    { perBodyBytes: 1024, aggregateBytes: 4096 },
  );
  repository.bindIdentity(`17091:${durablePubkey}:`);
  repository.close();
  const lines: string[] = [];
  const log = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  try {
    const daemon = await launchDaemon({
      caches: fixture.remoteOwner,
      extraRelays: fixture.relayUrl,
      databasePath,
      spoolDirectory: `${root}/spool`,
      writable: {
        enabled: true,
        type: "root",
        signer: { type: "nbunksec", nbunksec: fixture.nbunksec },
        staging: { directory: stagingDirectory },
      },
    }, {
      createEventStream: () => ({
        events: new Subject<RawPublication>(),
        close() {},
      }),
      bind: () => ({ shutdown: () => Promise.resolve() }),
      signals: [],
    });
    assert(daemon.ok);
    await fixture.waitForRequests(1, deadline);
    await fixture.completeAuthorization();
    const started = performance.now();
    let warning: string | undefined;
    while (!warning) {
      warning = lines.find((line) =>
        line.includes("WRITABLE CACHE OWNER MISMATCH")
      );
      if (performance.now() - started >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert(warning);
    assertStringIncludes(
      warning,
      `Configured signer: 17091:${fixture.remoteOwner}:`,
    );
    assertStringIncludes(warning, `Durable owner:     17091:${durablePubkey}:`);
    assertStringIncludes(warning, "WRITES HAVE BEEN DISABLED");
    await daemon.shutdown();
    await fixture.waitForSocketClose(deadline);
    await daemon.shutdown();
  } finally {
    console.log = log;
    await fixture.close();
    await Deno.remove(root, { recursive: true });
  }
});
