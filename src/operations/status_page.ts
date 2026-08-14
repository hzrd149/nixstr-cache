import type { StatusSnapshot } from "./status.ts";

// A total, deterministic function of its argument: no Date.now(), no Deno.*,
// no configuration. The same snapshot in must produce a byte-identical
// string out.

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPE_MAP[character]);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unit++;
  }
  return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

// Frozen and never interpolated — a fixed ~60-line stylesheet. `deno fmt`
// reflows long template literals, so the HTML body itself is built as
// arrays of short strings joined with "\n" (see diagnostics.ts's
// writable-identity-mismatch banner for the precedent).
const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #5a5a5a;
  --border: #d0d0d0;
  --card-bg: #f6f6f6;
  --ok: #1a7f37;
  --degraded: #9a6700;
  --down: #cf222e;
  --accent: #1a7f37;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #9198a1;
    --border: #30363d;
    --card-bg: #161b22;
    --ok: #3fb950;
    --degraded: #d29922;
    --down: #f85149;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.5rem;
  max-width: 64rem;
  margin-inline: auto;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
h1 { font-size: 1.4rem; margin: 0 0 0.35rem 0; }
h2 { font-size: 1.05rem; margin: 0 0 0.5rem 0; }
section {
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--card-bg);
}
section.degraded, section.blocked, section.repairing {
  border-left-color: var(--degraded);
}
section.down { border-left-color: var(--down); }
.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  background: var(--ok);
}
.badge.degraded, .badge.blocked, .badge.repairing {
  background: var(--degraded);
}
.badge.down { background: var(--down); }
.badge.disabled { background: var(--muted); }
pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.75rem;
  overflow-x: auto;
  user-select: all;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-all;
}
table { width: 100%; border-collapse: collapse; }
th, td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
.muted { color: var(--muted); }
.small { font-size: 0.8rem; }
.bar {
  height: 0.75rem;
  border-radius: 4px;
  background: var(--border);
  overflow: hidden;
}
.bar > span { display: block; height: 100%; background: var(--accent); }
@media (max-width: 40rem) {
  body { padding: 0.75rem; }
  table, thead, tbody, tr { display: block; }
  th { display: none; }
  td { border-bottom: none; padding: 0.15rem 0; }
}
`;

function sectionClass(level: string): string {
  return level === "ok" ? "" : ` ${level}`;
}

function headerSection(snapshot: StatusSnapshot): string[] {
  const level = snapshot.overall.level;
  return [
    "<header>",
    `<h1>nixstr-cache <span class="badge${
      sectionClass(level)
    }">${level.toUpperCase()}</span></h1>`,
    `<p>${escapeHtml(snapshot.overall.summary)}</p>`,
    `<p class="muted">${
      escapeHtml(snapshot.timestamp)
    } - this page refreshes every 10 seconds</p>`,
    "</header>",
  ];
}

function reasonsSection(snapshot: StatusSnapshot): string[] {
  const lines = [
    `<section class="reasons${sectionClass(snapshot.overall.level)}">`,
    "<ul>",
  ];
  for (const reason of snapshot.overall.reasons) {
    lines.push(`<li>${escapeHtml(reason)}</li>`);
  }
  lines.push("</ul>", "</section>");
  return lines;
}

function setupSection(snapshot: StatusSnapshot): string[] {
  const substituter = escapeHtml(snapshot.setup.substituter);
  const keys = snapshot.setup.trustedPublicKeys;
  const nixConfKeysLine = keys.length > 0
    ? `extra-trusted-public-keys = ${keys.map(escapeHtml).join(" ")}`
    : "# no cache keys known yet";
  const nixSettingsKeysLine = keys.length > 0
    ? `  extra-trusted-public-keys = [ ${
      keys.map((key) => `"${escapeHtml(key)}"`).join(" ")
    } ];`
    : "  # no cache keys known yet";
  return [
    "<section>",
    "<h2>Use this cache</h2>",
    "<p><code>/etc/nix/nix.conf</code> (additive - keeps cache.nixos.org):</p>",
    `<pre>extra-substituters = ${substituter}\n${nixConfKeysLine}</pre>`,
    "<p>NixOS equivalent (<code>configuration.nix</code>):</p>",
    `<pre>nix.settings = {\n  extra-substituters = [ "${substituter}" ];\n${nixSettingsKeysLine}\n};</pre>`,
    '<p class="muted">Nix still verifies every configured binary-cache signature. The Nostr signature authenticates the publisher and Hashtree root; it does not replace Nix\'s own trust configuration.</p>',
    "</section>",
  ];
}

function cachesSection(snapshot: StatusSnapshot): string[] {
  const level = snapshot.read.status === "ok" ? "ok" : "degraded";
  const lines = [
    `<section class="caches${sectionClass(level)}">`,
    `<h2>Caches (${String(snapshot.read.caches.length)}) <span class="badge${
      sectionClass(level)
    }">${snapshot.read.status.toUpperCase()}</span></h2>`,
  ];
  if (snapshot.read.caches.length === 0) {
    lines.push(
      "<p>No caches are selected. The daemon is running but has nothing to serve — check that <code>caches</code> is configured and that a relay is reachable.</p>",
    );
  } else {
    lines.push(
      "<table>",
      "<thead><tr><th>#</th><th>name</th><th>root</th><th>keys</th><th>updated</th><th></th></tr></thead>",
      "<tbody>",
    );
    for (const cache of snapshot.read.caches) {
      const label = cache.name !== undefined
        ? escapeHtml(cache.name)
        : `${escapeHtml(cache.pubkey.slice(0, 8))}…`;
      const rootDisplay = cache.nhash
        ? `${escapeHtml(cache.nhash.slice(0, 12))}…`
        : "invalid";
      const updated = new Date(cache.updatedAt * 1_000).toISOString();
      const markers = [
        cache.writable ? '<span class="badge">WRITABLE</span>' : "",
        cache.expired ? '<span class="badge degraded">EXPIRED</span>' : "",
      ].join(" ");
      lines.push(
        "<tr>",
        `<td>${String(cache.priority)}</td>`,
        `<td>${label}<br><span class="muted small">${
          escapeHtml(cache.identity)
        }</span></td>`,
        `<td>${rootDisplay}</td>`,
        `<td>${String(cache.keyCount)}</td>`,
        `<td>${escapeHtml(updated)}</td>`,
        `<td>${markers}</td>`,
        "</tr>",
      );
    }
    lines.push("</tbody>", "</table>");
    if (snapshot.read.overlayEntries > 0) {
      lines.push(
        `<p class="muted">${
          String(snapshot.read.overlayEntries)
        } entries pending in the writable overlay</p>`,
      );
    }
  }
  lines.push("</section>");
  return lines;
}

function storageSection(snapshot: StatusSnapshot): string[] {
  const percent = String(snapshot.storage.usedPercent);
  return [
    "<section>",
    "<h2>Storage</h2>",
    `<div class="bar"><span style="width:${percent}%"></span></div>`,
    `<p>${formatBytes(snapshot.storage.readyBytes)} of ${
      formatBytes(snapshot.storage.capacityBytes)
    } (${percent}%)</p>`,
    `<p class="muted">ready ${
      formatBytes(snapshot.storage.readyBytes)
    } - reserved ${
      formatBytes(snapshot.storage.reservedBytes)
    } - undeleted blobs ${String(snapshot.storage.tombstones)}</p>`,
    "</section>",
  ];
}

function writesSection(snapshot: StatusSnapshot): string[] {
  const write = snapshot.write;
  const level = write.status === "ready" ? "ok" : write.status;
  const lines = [
    `<section class="writes${sectionClass(level)}">`,
    `<h2>Writes <span class="badge${
      sectionClass(level)
    }">${write.status.toUpperCase()}</span></h2>`,
  ];
  if (write.status === "disabled") {
    lines.push(
      '<p class="muted">Writes are disabled. This cache is read-only.</p>',
    );
    lines.push("</section>");
    return lines;
  }
  const signerDetailSuffix = write.signerDetail
    ? ` - ${escapeHtml(write.signerDetail)}`
    : "";
  lines.push(
    "<table>",
    "<tbody>",
    `<tr><td>signer</td><td>${
      escapeHtml(write.signerStatus ?? "disconnected")
    }${signerDetailSuffix}</td></tr>`,
    `<tr><td>uploads (PUT)</td><td>${
      write.acceptingUploads ? "accepted" : "refused"
    }</td></tr>`,
    `<tr><td>Blossom servers</td><td>${
      String(write.destinations)
    }</td><td>publication relays</td><td>${String(write.relays)}</td></tr>`,
    "</tbody>",
    "</table>",
  );
  if (write.publication) {
    const { batchId, replicas, relays } = write.publication;
    const replicaRetries = replicas.retries
      ? `, ${String(replicas.retries)} retries`
      : "";
    const relayRetries = relays.retries
      ? `, ${String(relays.retries)} retries`
      : "";
    lines.push(
      `<p>batch ${String(batchId)} - replicas ${String(replicas.succeeded)}/${
        String(replicas.total)
      } ok${replicaRetries} - relays ${String(relays.succeeded)}/${
        String(relays.total)
      } ok${relayRetries}</p>`,
    );
  }
  if (write.pending) {
    lines.push(
      `<p class="muted">staged ${String(write.pending.blobs)} blobs, ${
        formatBytes(write.pending.bytes)
      } waiting</p>`,
    );
  }
  lines.push("</section>");
  return lines;
}

function footerSection(): string[] {
  return [
    "<footer>",
    '<p class="muted">JSON status: /health - Nix probe: /nix-cache-info</p>',
    "</footer>",
  ];
}

export function renderStatusPage(snapshot: StatusSnapshot): string {
  const level = snapshot.overall.level;
  const titlePrefix = level === "ok" ? "" : `${level.toUpperCase()} - `;
  const lines: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="refresh" content="10">',
    `<title>${escapeHtml(titlePrefix)}nixstr-cache</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    ...headerSection(snapshot),
    ...(snapshot.overall.reasons.length > 0 ? reasonsSection(snapshot) : []),
    ...setupSection(snapshot),
    ...cachesSection(snapshot),
    ...(snapshot.storage.available ? storageSection(snapshot) : []),
    ...writesSection(snapshot),
    ...footerSection(),
    "</body>",
    "</html>",
  ];
  return lines.join("\n");
}
