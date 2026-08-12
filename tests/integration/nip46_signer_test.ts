import { assert, assertEquals } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { Subject } from "rxjs";
import type { RawConfig } from "../../src/config/config.ts";
import type { RawPublication } from "../../src/protocol/publication.ts";
import { launchDaemon } from "../../src/runtime/daemon.ts";
import {
  createNostrConnectFixture,
  type NostrConnectOutcome,
} from "../fixtures/nostr_connect.ts";

const deadline = 4_000;

async function waitForPutStatus(
  put: () => Response | Promise<Response>,
  status: number,
  timeoutMs: number,
) {
  const started = performance.now();
  while (true) {
    const response = await put();
    if (response.status === status) return response;
    if (performance.now() - started >= timeoutMs) {
      throw new Error(`timed out waiting for PUT status ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function scenario(
  kind: 17091 | 37091,
  outcome: NostrConnectOutcome,
) {
  const root = await Deno.makeTempDir({ prefix: "nixstr-nip46-" });
  const expectedOwner = getPublicKey(generateSecretKey());
  const fixture = await createNostrConnectFixture({
    outcome,
    returnedOwner: outcome === "mismatch"
      ? getPublicKey(generateSecretKey())
      : expectedOwner,
  });
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
      publisherPubkeys: expectedOwner,
      relayUrls: fixture.relayUrl,
      databasePath: `${root}/state.sqlite`,
      spoolDirectory: `${root}/spool`,
      signerMode: "nip46",
      writableIdentity: kind === 17091
        ? `17091:${expectedOwner}:`
        : `37091:${expectedOwner}:named`,
      nip46SessionPath: sessionPath,
      stagingDirectory: `${root}/staging`,
      preferredBlossomUrl: "http://127.0.0.1:9",
    };
    const daemon = launchDaemon(raw, {
      createEventStream: () => ({
        events: new Subject<RawPublication>(),
        dispose() {},
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
      assertEquals((await waitForPutStatus(put, 200, deadline)).status, 200);
      assertEquals(fixture.facts.methods, ["connect", "get_public_key"]);
      assertEquals(fixture.facts.permissions, [
        `get_public_key,sign_event:${kind}`,
      ]);
    } else {
      await fixture.waitForSocketClose(deadline);
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

Deno.test("production NIP-46 enables default and named owners after exact authorization", async () => {
  await scenario(17091, "success");
  await scenario(37091, "success");
});

Deno.test("production NIP-46 fails closed for mismatch denial and connection failure", async () => {
  await scenario(17091, "mismatch");
  await scenario(17091, "denied");
  await scenario(17091, "failed");
});
