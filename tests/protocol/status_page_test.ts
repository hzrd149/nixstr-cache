import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  escapeHtml,
  formatBytes,
  renderStatusPage,
} from "../../src/operations/status_page.ts";
import type {
  StatusCacheView,
  StatusSnapshot,
} from "../../src/operations/status.ts";
import { secretCorpus } from "../support/secret_corpus.ts";

function cache(overrides: Partial<StatusCacheView> = {}): StatusCacheView {
  return {
    priority: 1,
    kind: 17091,
    pubkey: "a".repeat(64),
    identity: `17091:${"a".repeat(64)}:`,
    nhash: "nhash1" + "023456789acdefghjklmnpqrstuvwxyz".slice(0, 20),
    keyCount: 0,
    keyNames: [],
    updatedAt: 1_000,
    expired: false,
    writable: false,
    blossomServers: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    timestamp: "2026-08-14T00:00:00.000Z",
    overall: {
      level: "ok",
      summary: "Serving 1 cache. Writes ready.",
      reasons: [],
    },
    read: { status: "ok", caches: [cache()], overlayEntries: 0 },
    storage: {
      available: true,
      readyBytes: 1_024,
      reservedBytes: 0,
      capacityBytes: 4_096,
      usedPercent: 25,
      tombstones: 0,
    },
    write: {
      status: "ready",
      reasons: [],
      signerStatus: "ready",
      signerDetail: "abcdef…",
      destinations: 1,
      relays: 1,
      acceptingUploads: true,
    },
    setup: {
      substituter: "http://127.0.0.1:8787",
      trustedPublicKeys: [],
    },
    ...overrides,
  };
}

Deno.test("output begins with the doctype and contains the meta-refresh directive", () => {
  const html = renderStatusPage(snapshot());
  assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  assertStringIncludes(html, '<meta http-equiv="refresh" content="10">');
});

Deno.test("structural safety: no script element, event handlers, href, or src", () => {
  const html = renderStatusPage(snapshot());
  assertEquals(/<script/i.test(html), false);
  assertEquals(/\son[a-z]+\s*=/i.test(html), false);
  assertEquals(html.includes("href="), false);
  assertEquals(html.includes("src="), false);
});

Deno.test("cache name and key name markup payloads render entity-escaped", () => {
  const html = renderStatusPage(snapshot({
    read: {
      status: "ok",
      caches: [cache({ name: '"><script>alert(1)</script>' })],
      overlayEntries: 0,
    },
    setup: {
      substituter: "http://127.0.0.1:8787",
      trustedPublicKeys: [`a&b<c>"d'e:${"A".repeat(43)}=`],
    },
  }));
  assertEquals(html.includes("<script>alert(1)</script>"), false);
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, "a&amp;b&lt;c&gt;&quot;d&#39;e");
});

Deno.test("secret corpus does not leak through the unrendered blossomServers field", () => {
  for (const secret of secretCorpus) {
    const html = renderStatusPage(snapshot({
      read: {
        status: "ok",
        caches: [cache({ blossomServers: [secret] })],
        overlayEntries: 0,
      },
    }));
    assertEquals(html.includes(secret), false);
  }
});

Deno.test("free-form fields never leak the blanket secret-shaped markers", () => {
  // secretCorpus[0] and [2] literally contain the blanket markers ("Bearer "
  // and "nbunksec1") as substrings, so they are placed in fields the
  // renderer never surfaces (blossomServers, write.reasons); every other
  // corpus string is marker-free and exercises a genuinely rendered field.
  const hostile = snapshot({
    overall: {
      level: "degraded",
      summary: secretCorpus[3],
      reasons: [secretCorpus[1]],
    },
    read: {
      status: "ok",
      caches: [
        cache({
          name: secretCorpus[3],
          identity: secretCorpus[7],
          blossomServers: [secretCorpus[0], secretCorpus[2]],
        }),
      ],
      overlayEntries: 0,
    },
    write: {
      status: "blocked",
      reasons: [secretCorpus[4]],
      signerStatus: "ready",
      signerDetail: secretCorpus[6],
      destinations: 1,
      relays: 1,
      acceptingUploads: false,
    },
    setup: {
      substituter: "http://127.0.0.1:8787",
      trustedPublicKeys: [`${secretCorpus[8]}:${"A".repeat(43)}=`],
    },
  });
  const html = renderStatusPage(hostile);
  assertEquals(html.includes(secretCorpus[0]), false);
  assertEquals(html.includes(secretCorpus[2]), false);
  for (
    const marker of [
      "nsec1",
      "nbunksec1",
      "ncryptsec1",
      "bunker://",
      "Bearer ",
      "Cookie:",
    ]
  ) {
    assertEquals(html.includes(marker), false);
  }
  assertEquals(/<script/i.test(html), false);
});

Deno.test("rendering the same snapshot twice yields identical strings", () => {
  const input = snapshot();
  assertEquals(renderStatusPage(input), renderStatusPage(input));
});

Deno.test("degraded, blocked, repairing, and disabled variants render their uppercase badge word", () => {
  assertStringIncludes(
    renderStatusPage(
      snapshot({ overall: { level: "degraded", summary: "x", reasons: [] } }),
    ),
    ">DEGRADED<",
  );
  assertStringIncludes(
    renderStatusPage(
      snapshot({ overall: { level: "down", summary: "x", reasons: [] } }),
    ),
    ">DOWN<",
  );
  assertStringIncludes(
    renderStatusPage(snapshot({
      write: {
        status: "blocked",
        reasons: ["no_publication_relay"],
        signerStatus: "ready",
        signerDetail: "",
        destinations: 0,
        relays: 0,
        acceptingUploads: false,
      },
    })),
    ">BLOCKED<",
  );
  assertStringIncludes(
    renderStatusPage(snapshot({
      write: {
        status: "repairing",
        reasons: [],
        signerStatus: "ready",
        signerDetail: "",
        destinations: 1,
        relays: 1,
        acceptingUploads: true,
      },
    })),
    ">REPAIRING<",
  );
  const disabled = renderStatusPage(snapshot({
    write: {
      status: "disabled",
      reasons: ["write_disabled"],
      destinations: 0,
      relays: 0,
      acceptingUploads: false,
      signerDetail: "",
    },
  }));
  assertStringIncludes(disabled, ">DISABLED<");
  assertEquals(disabled.includes("uploads (PUT)"), false);
  assertEquals(disabled.includes("batch "), false);
});

Deno.test("empty-cache wording is present and the cache table markup is absent", () => {
  const html = renderStatusPage(snapshot({
    read: { status: "unavailable", caches: [], overlayEntries: 0 },
    write: {
      status: "disabled",
      reasons: ["write_disabled"],
      destinations: 0,
      relays: 0,
      acceptingUploads: false,
      signerDetail: "",
    },
  }));
  assertStringIncludes(html, "No caches are selected.");
  assertEquals(html.includes("<th>#</th>"), false);
});

Deno.test("formatBytes covers bytes, KB, MB, GB, TB, and zero", () => {
  assertEquals(formatBytes(0), "0 B");
  assertEquals(formatBytes(500), "500 B");
  assertEquals(formatBytes(2_048), "2.0 KB");
  assertEquals(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assertEquals(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  assertEquals(formatBytes(2 * 1024 * 1024 * 1024 * 1024), "2.0 TB");
});

Deno.test("the storage bar inline style is the only style attribute in the page", () => {
  const html = renderStatusPage(snapshot({
    storage: {
      available: true,
      readyBytes: 100,
      reservedBytes: 0,
      capacityBytes: 400,
      usedPercent: 25,
      tombstones: 0,
    },
  }));
  const matches = html.match(/style="[^"]*"/g) ?? [];
  assertEquals(matches.length, 1);
  assertEquals(/^style="width:\d{1,3}%"$/.test(matches[0] ?? ""), true);
});

Deno.test("escapeHtml handles the full reserved character set in one pass", () => {
  assertEquals(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});
