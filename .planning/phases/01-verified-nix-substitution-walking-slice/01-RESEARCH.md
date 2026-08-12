# Phase 1: Verified Nix Substitution Walking Slice - Research

**Researched:** 2026-08-12  
**Domain:** Deno/TypeScript gateway from verified Nostr cache publications through plaintext Blossom Hashtrees to the stock Nix HTTP binary-cache protocol  
**Confidence:** MEDIUM-HIGH — released runtime and Nix behavior are official and current; the Hashtree wire format is pinned to still-open proposal revisions. [VERIFIED: codebase grep] [CITED: https://github.com/hzrd149/blossom/pulls]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Publication Selection and Recovery
- **D-01:** Once a selected publication expires or otherwise becomes ineligible, stop serving it until a fresh eligible publication is selected.
- **D-02:** After restart, a persisted verified root may remain selected when relays expose only older events. Never replace it with an older relay candidate.
- **D-03:** Resolve availability per request. Missing blobs fail only the affected path and do not invalidate the selected root or unrelated paths.
- **D-04:** A newer event that passes publication validation remains selected if a later path is corrupt, incomplete, or unreachable. Fail the affected read; do not automatically roll back to an earlier root.

### Upstream Source Behavior
- **D-05:** Candidate order is: the operator-configured cache Blossom server, valid event `blossom` tags in tag order, then the publisher's BUD-03 list. Deduplicate identical URLs.
- **D-06:** One fetched-blob hash mismatch quarantines the entire source server. Quarantine persists across restarts and requires explicit operator release.
- **D-07:** Only a cryptographic hash mismatch triggers quarantine. Timeouts, HTTP failures, 404 responses, truncation, oversized responses, and redirect-policy failures remain ordinary source-attempt failures.
- **D-08:** Phase 1 may use the configured cache Blossom server as a preferred read source, but writing verified upstream blobs back to it remains Phase 2 scope.

### HTTP Cache Semantics
- **D-09:** Return `404` only when the verified tree proves the requested path is absent. Use an appropriate gateway failure or timeout status when upstream transport, availability, or integrity prevents resolution.
- **D-10:** `HEAD` proves that the Hashtree path exists but does not fetch or hash-verify the final content blob. It confirms indexed presence, not current end-to-end retrievability.
- **D-11:** Capture the selected publication snapshot at the beginning of each GET or HEAD request and use it through completion, even if reactive selection changes in flight.
- **D-12:** Correct the current signature-filtering rule: pass every syntactically valid `.narinfo` `Sig` line unchanged. `nixSigKey` identifies publisher-endorsed signatures but does not authorize deleting other signatures; stock Nix applies its configured key-trust policy. Malformed signature fields remain subject to strict `.narinfo` parsing. — **Reversibility:** one-way — this changes the public gateway contract and requires coordinated amendments to `NIP.md` and requirement `READ-04` before planning.

### Configuration and Safety Limits
- **D-13:** Missing or invalid required configuration fails startup, reports all discovered validation errors together, and binds no HTTP listener.
- **D-14:** Every resource and traversal bound has a conservative default. Operators may tighten limits or raise them only to compiled hard ceilings; limits cannot be disabled.
- **D-15:** Ignore event-provided and BUD-03-discovered sources that resolve to local, private, or reserved addresses.
- **D-16:** Only environment-based operator configuration may define the preferred cache Blossom server, whether local or remote. Setting that environment variable is itself authorization to access the configured server's resolved address; no second private-network opt-in is required.

### the agent's Discretion
- Choose exact HTTP status codes within the gateway-error versus timeout distinction in D-09, preserving stock Nix compatibility.
- Choose configuration variable names, conservative default values, and compiled hard ceilings during research and planning.
- Choose the operator command or configuration mechanism that explicitly releases a quarantined server.

### Deferred Ideas (OUT OF SCOPE)
- Writing verified fetched blobs into the configured local Blossom server is part of Phase 2's read/write-through cache capability.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROT-02 | Accept only fully valid, unexpired publications and report rejection. | Validation pipeline, strict tag/`nhash` codec, and candidate-rejection taxonomy below. [VERIFIED: codebase grep] |
| PROT-03 | Select the latest valid event per raw identity through Applesauce reactive casts. | Verified ingress before store admission and pure reactive selection pattern below. [CITED: https://applesauce.build/introduction/getting-started.html] |
| PROT-04 | Persist greatest accepted timestamp and tie-break state. | Transactional anti-rollback repository and restart ordering below. [VERIFIED: codebase grep] |
| PROT-05 | Require explicit consent for signed-to-unsigned downgrade. | Durable identity policy state and startup configuration below. [VERIFIED: codebase grep] |
| PROT-06 | Reject BUD-15 roots; accept strict plaintext BUD-18 roots. | Strict TLV profile and pinned BUD-18 fixtures below. [CITED: https://github.com/hzrd149/blossom/pull/107] |
| TREE-01 | Discover ordered Blossom sources. | Normalized source plan: configured source, event tags, then kind `10063`. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/03.md] |
| TREE-02 | Hash-verify every fetched blob before use. | Verify-to-temp-file-before-consume pipeline below. [VERIFIED: codebase grep] |
| TREE-03 | Enforce URL, DNS, redirect, and attempt limits. | One SafeFetcher boundary plus mandatory address-binding spike below. [CITED: https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/] |
| TREE-04 | Resolve BUD-16/17/18 lazily under traversal limits. | Iterative path walker, request-local budget ledger, and pinned proposal rules below. [CITED: https://github.com/hzrd149/blossom/pulls] |
| TREE-05 | Preserve backpressure and bounded memory. | Web Streams plus bounded file spooling below. [CITED: https://docs.deno.com/api/web/fetch/] |
| READ-01 | GET/HEAD `nix-cache-info`. | Fixed route behavior and response contract below. [CITED: https://nix.dev/manual/nix/2.35/protocols/binary-cache/] |
| READ-02 | GET/HEAD `.narinfo` and referenced NAR paths. | Route grammar, strict record parser, and snapshot resolver below. [CITED: https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html] |
| READ-03 | Use one immutable root snapshot per request. | Snapshot-at-handler-entry pattern below. [VERIFIED: codebase grep] |
| READ-04 | Current requirement says strip unauthorized signatures. | **Blocked contract:** D-12 says preserve all syntactically valid `Sig` lines; reconcile REQUIREMENTS.md, ROADMAP.md, and NIP.md before planning. [VERIFIED: codebase grep] |
| READ-07 | Real Nix substitutes an uncached store path. | Pinned Nix 2.34.7 end-to-end fixture design below. [VERIFIED: local environment probe] |
| OPER-01 | Start from validated configuration. | Parse-all-errors-before-side-effects composition root below. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Plan this phase as one vertical path with sharply separated control and data planes: validated relay events flow through Applesauce/RxJS into a durable selected-publication snapshot, while each Nix HTTP request captures that snapshot and lazily resolves one tree path through a hardened, streaming Blossom client. [CITED: https://applesauce.build/introduction/getting-started.html] [VERIFIED: codebase grep] Bytes must never enter a decoder or response directly from the network: stream each candidate into a bounded temporary file while incrementally hashing, discard failures, atomically mark verified content, and only then parse or stream it onward. [VERIFIED: codebase grep]

The planner must begin with two Wave 0 gates. First, reconcile D-12 with the opposite normative text in `NIP.md`, `READ-04`, and Roadmap success criterion 2; implementation cannot satisfy both contracts. [VERIFIED: codebase grep] Second, prove an outbound transport that connects to the exact DNS-approved address while preserving HTTP `Host` and HTTPS SNI/certificate validation; URL validation followed by ordinary `fetch()` leaves a DNS time-of-check/time-of-use gap, and the checked Deno Fetch documentation does not expose a resolver/address-pinning hook. [CITED: https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/] [CITED: https://docs.deno.com/api/web/fetch/] This is a security spike, not optional polish.

The BUD-16/17/18 proposals are still open; pin their exact 2026-08-12 head SHAs and copy their vectors into project fixtures before writing codecs. [VERIFIED: GitHub API] Phase 1 should read only plaintext roots, should implement `t=1`, `t=2`, and `t=3`, and should reject encryption keys and unknown types. [CITED: https://github.com/hzrd149/blossom/pull/105] [CITED: https://github.com/hzrd149/blossom/pull/106] [VERIFIED: codebase grep]

**Primary recommendation:** Build five sequential seams—strict protocol codecs, durable selection, address-bound verified blob transport, bounded Hashtree lookup, and stock-Nix HTTP serving—then close the phase only with a real Nix 2.34.7 substitution test. [VERIFIED: local environment probe]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Publication subscription/selection | API / Backend | Database / Storage | Relay events are control-plane input; durable watermarks enforce restart safety. [VERIFIED: codebase grep] |
| Publication/tag/`nhash` validation | API / Backend | — | Trust decisions must complete before candidates enter selected state. [VERIFIED: codebase grep] |
| Quarantine and downgrade consent | Database / Storage | API / Backend | Both policies must survive restart and be transactionally consulted. [VERIFIED: codebase grep] |
| Blossom fetch and verification | API / Backend | Database / Storage | Network policy and hashing are backend concerns; temporary files bound memory. [CITED: https://docs.deno.com/api/web/fetch/] |
| Hashtree path resolution | API / Backend | — | The request-local walker interprets authenticated manifests under a shared budget. [CITED: https://github.com/hzrd149/blossom/pull/106] |
| Nix HTTP GET/HEAD | API / Backend | — | `Deno.serve` exposes the stock binary-cache surface and streams verified bodies. [CITED: https://docs.deno.com/api/deno/http-server/] |

## Project Constraints (from AGENTS.md)

- Treat `NIP.md` as normative and never weaken its MUST/MUST NOT rules, except that D-12 explicitly requires the signature-rule documents to be amended before planning. [VERIFIED: codebase grep]
- Stay on Deno/TypeScript and use Applesauce reactive stores, casts, and observable composition for cache state. [VERIFIED: codebase grep]
- Use Web Streams with backpressure; do not whole-buffer files or datasets. [VERIFIED: codebase grep]
- Bound manifest bytes, depth, links, visited nodes, decoded bytes, redirects, attempts, and decompressed output. [VERIFIED: codebase grep]
- Re-check publisher URL SSRF policy after DNS resolution and at every redirect; an environment-configured local source is explicitly authorized. [VERIFIED: codebase grep]
- Verify Nostr events and every content hash; reject BUD-15 in v1. [VERIFIED: codebase grep]
- Persist freshness state, honor expiration, and prevent silent rollback or signed-to-unsigned downgrade. [VERIFIED: codebase grep]
- Serve stock Nix semantics and keep the daemon a single-user modular monolith. [VERIFIED: codebase grep]
- Before repository edits, use the GSD execution workflow; this research file is the artifact of the already-started plan-phase workflow. [VERIFIED: codebase grep]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Deno | project target `2.9.5`; host `2.9.4` | Runtime, HTTP, Web Streams, temp files, permissions | Existing runtime; `Response` accepts a `ReadableStream<Uint8Array>`. Upgrade the host/CI to the pinned patch before verification. [CITED: https://docs.deno.com/api/web/fetch/] [VERIFIED: local environment probe] |
| TypeScript | Deno-bundled `6.0.3` | Strict domain and state types | Host compiler version is verified; use branded validated types to prevent raw event/blob use. [VERIFIED: local environment probe] |
| `applesauce-core` | `6.2.0` | `EventStore`, event helpers, custom reactive model/cast boundary | Official docs show reactive store updates; package exists at this version, but legitimacy seam returns SUS because package metadata has no repository. [CITED: https://applesauce.build/] [VERIFIED: npm registry] |
| `applesauce-relay` | `6.2.1` | Relay subscriptions/pooling as Observables | Official examples pipe relay events into `EventStore`; legitimacy seam returns SUS. [CITED: https://applesauce.build/introduction/getting-started.html] [VERIFIED: npm registry] |
| RxJS | `7.8.2` | Control-plane composition, teardown, snapshot publication | Registry and legitimacy checks return current/OK; do not use it for byte streams. [VERIFIED: npm registry] |
| Web Streams API | built into Deno | Backpressured fetch, verification, file, and response bodies | Deno's Fetch `BodyInit` includes readable and async iterable byte streams. [CITED: https://docs.deno.com/api/web/fetch/] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `applesauce-loaders` | `6.2.0` | Load kind `10063` server lists into the same event store | Use for BUD-03 lookup only; legitimacy seam returns SUS. [CITED: https://applesauce.build/] [VERIFIED: npm registry] |
| `@db/sqlite` | JSR `0.13.0` | Durable watermarks, selected event, signed-history bit, consent, quarantine | Use a tiny domain repository with explicit transactions; note its FFI/native-library permissions in deployment. [CITED: https://jsr.io/@db/sqlite] |
| `@noble/hashes` | `2.3.0` | Incremental SHA-256 | Import `sha256` from the v2 `.js` subpath and feed `Uint8Array` chunks; legitimacy seam flags this new patch SUS. [CITED: https://github.com/paulmillr/noble-hashes] [VERIFIED: npm registry] |
| `@scure/base` | `2.3.0` | Low-level Bech32 for strict `nhash` TLV | Use only after checking HRP/checksum/canonical re-encoding; legitimacy seam flags this new patch SUS. [VERIFIED: npm registry] |
| `@msgpack/msgpack` | `3.1.3` | Decode bounded BUD-16/17 MessagePack manifests | Use a library decoder behind a strict schema validator; legitimacy seam returns OK. [VERIFIED: npm registry] [CITED: https://github.com/msgpack/msgpack-javascript] |
| `fast-check` | `4.9.0` | Property tests for path/TLV/manifest/budget/chunk boundaries | Use alongside fixed upstream vectors; legitimacy seam returns OK. [VERIFIED: npm registry] |
| `@std/assert` | `1.0.19` target | Deno test assertions | Keep exact patch in imports/lockfile rather than current floating `@1`. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Domain SQLite repository | JSON journal | Simpler bootstrap but makes multi-field watermark/consent/quarantine updates and crash recovery easier to get wrong; do not use. [ASSUMED] |
| `@msgpack/msgpack` plus schema checks | Hand-written MessagePack decoder | Avoids a dependency but adds non-canonical integer, allocation, and malformed-input hazards; do not hand-roll. [ASSUMED] |
| Address-bound custom outbound transport | Plain global `fetch` after `Deno.resolveDns` | Simpler, but permits a second DNS resolution and TOCTOU; acceptable only if the Wave 0 spike proves the actual connection is pinned. [CITED: https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/] |

**Installation:** [VERIFIED: npm registry] [CITED: https://jsr.io/@db/sqlite]

```bash
deno add npm:applesauce-core@6.2.0 npm:applesauce-relay@6.2.1 \
  npm:applesauce-loaders@6.2.0 npm:rxjs@7.8.2 \
  npm:@noble/hashes@2.3.0 npm:@scure/base@2.3.0 \
  npm:@msgpack/msgpack@3.1.3 jsr:@db/sqlite@0.13.0 \
  npm:fast-check@4.9.0 jsr:@std/assert@1.0.19
```

## Package Legitimacy Audit

| Package | Registry | Age / downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------------|-------------|---------|-------------|
| `applesauce-core` | npm | first signal 2026-06-26; 2,073/wk | missing in npm metadata | SUS | Required by locked stack; planner adds human verification checkpoint. [VERIFIED: package-legitimacy seam] |
| `applesauce-relay` | npm | first signal 2026-06-29; 1,612/wk | missing in npm metadata | SUS | Required; human verification checkpoint. [VERIFIED: package-legitimacy seam] |
| `applesauce-loaders` | npm | first signal 2026-06-26; 826/wk | missing in npm metadata | SUS | Keep only if BUD-03 loader materially reduces code; human verification checkpoint. [VERIFIED: package-legitimacy seam] |
| `rxjs` | npm | published patch 2025-02-22; ~100M/wk | `ReactiveX/rxjs` | OK | Approved. [VERIFIED: package-legitimacy seam] |
| `@noble/hashes` | npm | patch published 2026-08-06; ~70.8M/wk | `paulmillr/noble-hashes` | SUS (too new) | Required; checkpoint or pin previously audited `2.2.x` after compatibility check. [VERIFIED: package-legitimacy seam] |
| `@scure/base` | npm | patch published 2026-08-08; ~9.3M/wk | `paulmillr/scure-base` | SUS (too new) | Human verification checkpoint. [VERIFIED: package-legitimacy seam] |
| `@msgpack/msgpack` | npm | patch published 2025-12-26; ~4.4M/wk | `msgpack/msgpack-javascript` | OK | Approved. [VERIFIED: package-legitimacy seam] |
| `fast-check` | npm | patch published 2026-07-08; ~30.4M/wk | `dubzzz/fast-check` | OK | Approved. [VERIFIED: package-legitimacy seam] |
| `@db/sqlite` | JSR | `0.13.0`, published ~8 months ago; ~2.4K/wk | `denodrivers/sqlite3` | N/A (seam supports npm/PyPI/crates only) | Approved from official JSR, but explicitly review FFI/full-access implications. [CITED: https://jsr.io/@db/sqlite] |

**Packages removed due to SLOP verdict:** npm `@db/sqlite` was removed; it does not exist on npm because the intended dependency is `jsr:@db/sqlite@0.13.0`. [VERIFIED: package-legitimacy seam]  
**Packages flagged as suspicious (SUS):** `applesauce-core`, `applesauce-relay`, `applesauce-loaders`, `@noble/hashes`, and `@scure/base`; the planner must insert `checkpoint:human-verify` before installation. [VERIFIED: package-legitimacy seam]  
No checked npm package reports a `postinstall` script. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
configured relays ──Nostr events──> signature + NIP validator ──valid only──> Applesauce EventStore
                                                                  │                    │
                                                                  │ reject log         v
                                                                  │          reactive identity selector
                                                                  │                    │ transaction
                                                                  │                    v
                                                                  └──────> SQLite policy state
                                                                          watermark / tie / signed / consent
                                                                                     │
Nix GET/HEAD ──> route + capture selected snapshot ──> bounded Hashtree path walker  │
                                                             │ expected hashes        │
                                                             v                        │
                                                    ordered source planner <───────────┘
                                                             │
                                      configured source → event tags → BUD-03
                                                             │
                                                             v
                                                 address-bound SafeFetcher
                                                DNS/IP + redirect + timeout
                                                             │ stream
                                                             v
                                           temp file + incremental SHA-256
                                             │ match                 │ mismatch
                                             v                       v
                                      verified file/decoder    discard + quarantine source
                                             │
                              manifest ───────┴────── final content
                                │                         │
                         continue traversal       stream Response to Nix
```

The diagram's verify-before-decode split is mandatory because a signed publisher controls both graph shape and source URLs, while Blossom servers control returned bytes. [VERIFIED: codebase grep]

### Recommended Project Structure

```text
src/
├── config/          # environment parsing, aggregate validation, hard ceilings
├── nostr/           # relay subscriptions, publication validator, reactive selector
├── protocol/        # cache identity, nhash TLV, MessagePack schema, narinfo parser
├── persistence/     # watermark/downgrade/quarantine SQLite repository
├── network/         # URL policy, IP classification, address-bound HTTP transport
├── blossom/         # source plan, fetch attempts, verify-to-temp-file
├── hashtree/        # iterative bounded path lookup and file chunk stream
├── nix/             # nix-cache-info, narinfo policy, HTTP routes/status mapping
└── app.ts           # validate → open state → subscribe → bind server composition
tests/
├── fixtures/        # pinned BUD/NIP/narinfo vectors
├── protocol/        # hostile parser/property cases
├── integration/     # fake relay, hostile Blossom, restart persistence
└── e2e/             # real Nix substitution
```

This structure follows the repository's researched modular-monolith boundary and keeps the sole outbound network implementation auditable. [VERIFIED: codebase grep]

### Pattern 1: Validate Before Store Admission

**What:** Verify NIP-01 `id`/`sig`, clock skew, expiration, raw identity, exact tag multiplicity, strict base64, and strict `nhash` TLV before calling `EventStore.add`. [VERIFIED: codebase grep]  
**When to use:** Every kind `17091`, `37091`, and auxiliary kind `10063` ingestion path. [VERIFIED: codebase grep]

```typescript
// Source: https://applesauce.build/introduction/getting-started.html
relayEvents$.pipe(
  map((event) => validatePublication(event, clock.now())),
  tap((result) => result.ok ? store.add(result.value.event) : rejectionLog(result.error)),
  filter((result): result is ValidPublicationResult => result.ok),
).subscribe((result) => selector.accept(result.value));
```

The selector must compare `(created_at, event.id)` using the adopted NIP-01 ordering and commit the event plus watermark/tie state atomically before publishing the new in-memory snapshot. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] [VERIFIED: codebase grep]

### Pattern 2: Verify-to-Spool, Then Consume

**What:** Stream a response body into a uniquely created temporary file and incremental SHA-256 state with byte/deadline limits; close, compare in constant representation, then expose a new file stream only on success. [CITED: https://github.com/paulmillr/noble-hashes]  
**When to use:** Every manifest, raw file blob, and file chunk. [VERIFIED: codebase grep]

```typescript
// Source: https://github.com/paulmillr/noble-hashes
import { sha256 } from "@noble/hashes/sha2.js";

const hash = sha256.create();
for await (const chunk of response.body!) {
  budget.consumeTransfer(chunk.byteLength);
  hash.update(chunk);
  await tempFile.write(chunk);
}
const actual = hash.digest();
if (!equalBytes(actual, expected.bytes)) throw new HashMismatch(source);
```

Do not tee unverified network bytes to the client: a hash is known only after the final byte, so forwarding while hashing violates TREE-02. [VERIFIED: codebase grep]

### Pattern 3: Request-Local Budget Ledger and Iterative Walker

**What:** Carry one mutable ledger for manifest bytes, decoded bytes, depth, links, unique hashes, redirects, attempts, and wall time through the whole request; use explicit stack frames and a visited-hash map. [CITED: https://github.com/hzrd149/blossom/pull/106]  
**When to use:** Every `.narinfo`, NAR, and HEAD path resolution. [VERIFIED: codebase grep]

For `t=2`, validate the complete manifest schema and unique exact UTF-8 names before choosing a link. [CITED: https://github.com/hzrd149/blossom/pull/105] For `t=3`, validate unnamed links, link types, positive `count`, ordered/non-overlapping `first`/`last`, and descend only into the candidate range. [CITED: https://github.com/hzrd149/blossom/pull/106] For `t=1`, preserve manifest order and require each emitted chunk length to equal its declared `s`. [CITED: https://github.com/hzrd149/blossom/pull/106]

### Pattern 4: Snapshot-at-Request-Entry

**What:** Read the immutable selected-publication object exactly once in the handler and pass it explicitly through lookup, source planning, narinfo handling, and NAR streaming. [VERIFIED: codebase grep]  
**When to use:** All GET and HEAD routes, including `nix-cache-info` for a consistent availability decision. [VERIFIED: codebase grep]

### Pattern 5: Parse-All Configuration Before Side Effects

**What:** Read environment values into a raw object, validate every field and cross-field invariant, return all diagnostics, then and only then open SQLite, relay sockets, or the HTTP listener. [VERIFIED: codebase grep]  
**When to use:** Daemon startup and the quarantine-release subcommand. [VERIFIED: codebase grep]

### Recommended Conservative Defaults and Hard Ceilings

These concrete values are planning recommendations, not protocol facts, and should be confirmed against the pinned real cache fixture. [ASSUMED]

| Limit | Default | Hard ceiling | Reason |
|------|---------|--------------|--------|
| manifest wire bytes | 4 MiB | 32 MiB | Canonical 174-link manifests should normally be far smaller. [ASSUMED] |
| decoded metadata bytes per manifest | 1 MiB | 8 MiB | Prevent metadata maps from dominating allocations. [ASSUMED] |
| traversal depth | 32 | 128 | BUD-17 fanout is shallow under canonical 174-way branching. [ASSUMED] |
| links per node | 174 | 1,024 | Default matches BUD-17 canonical `max_links`; ceiling permits non-canonical reads without unbounded fanout. [CITED: https://github.com/hzrd149/blossom/pull/106] [ASSUMED] |
| unique manifest nodes/request | 2,048 | 16,384 | Bounds shared-DAG amplification. [ASSUMED] |
| total decoded manifest bytes/request | 64 MiB | 512 MiB | Bounds aggregate parser work. [ASSUMED] |
| source attempts/blob | 10 | 32 | Default is NIP.md's recommendation. [VERIFIED: codebase grep] |
| redirect depth/attempt | 3 | 8 | Enough for CDN indirection while limiting pivots. [ASSUMED] |
| connect / idle / total request timeout | 5s / 30s / 5m | 30s / 5m / 30m | Split timeouts distinguish dead connections from large active streams. [ASSUMED] |
| concurrent upstream fetches | 8 | 64 | Bounds descriptors and bandwidth for a local daemon. [ASSUMED] |

Do not apply a small total byte ceiling to final NAR bodies; bound them by the authenticated link sizes and `.narinfo` `FileSize`, with a compiled maximum large enough for real Nix artifacts. [CITED: https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html] [ASSUMED]

### HTTP Status Mapping

| Condition | Status | Contract |
|-----------|--------|----------|
| Verified path absent | `404` | Only a completed authenticated lookup proves absence. [VERIFIED: codebase grep] |
| No eligible selected publication | `503` | Read service is currently unavailable, not a proven cache miss. [ASSUMED] |
| All sources timeout / request deadline | `504` | Distinguishes upstream timeout from absence. [ASSUMED] |
| Hash mismatch, policy rejection, malformed authenticated node, exhausted non-timeout sources | `502` | Upstream/gateway integrity failure; never translate to `404`. [ASSUMED] |
| Unsupported method | `405` with `Allow: GET, HEAD` | Phase 1 is read-only. [ASSUMED] |

### Anti-Patterns to Avoid

- **Decode while hashing:** parsing bytes before the final digest makes hostile, unauthenticated input active. [VERIFIED: codebase grep]
- **Recursive DAG traversal:** obscures aggregate budgets and risks call-stack failure; use explicit frames. [CITED: https://github.com/hzrd149/blossom/pull/106]
- **A preflight DNS lookup plus normal `fetch`:** creates an address-validation/connection TOCTOU gap. [CITED: https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/]
- **Treating a failed path as a bad publication:** contradicts D-03/D-04 and causes unsafe automatic rollback. [VERIFIED: codebase grep]
- **Returning 404 for transport failure:** causes Nix to treat temporary/corrupt upstream state as a genuine cache miss. [VERIFIED: codebase grep]
- **Using current store contents as the watermark:** relay/event-store cleanup must not erase anti-rollback or signed-history state. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nostr signature verification | secp256k1/Schnorr verifier | Applesauce/its vetted Nostr primitive | Event serialization and signature rules are security-critical. [CITED: https://applesauce.build/] |
| SHA-256 streaming | custom hash | `@noble/hashes` incremental API | Correct incremental hashing is already tested and audited upstream. [CITED: https://github.com/paulmillr/noble-hashes] |
| MessagePack binary decoding | byte-level general decoder | `@msgpack/msgpack`, followed by project schema validation | Wire decoding and protocol validation are separate concerns. [CITED: https://github.com/msgpack/msgpack-javascript] |
| Reactive relay lifecycle | polling/reconnect/dedup loop | Applesauce relay/store plus RxJS teardown | Official stack already exposes reactive subscriptions. [CITED: https://applesauce.build/introduction/getting-started.html] |
| Transaction journal format | ad-hoc JSON rewrites | SQLite transaction in a narrow repository | Multiple durable policy facts must advance together. [ASSUMED] |
| URL parsing | regex | standards `URL` plus strict scheme/userinfo/port/address policy | Regex validation misses parser and encoding edge cases. [CITED: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html] |

**Key insight:** project-own the narrow NIP/Hashtree/Nix schemas and policy, but delegate general cryptography, MessagePack decoding, reactive plumbing, and transactions to maintained primitives. [ASSUMED]

## Common Pitfalls

### Pitfall 1: Planning Against Contradictory Signature Rules
**What goes wrong:** The implementation either strips signatures per current `NIP.md`/READ-04 or preserves them per locked D-12, so one acceptance contract necessarily fails. [VERIFIED: codebase grep]  
**How to avoid:** Make document reconciliation the first blocking task, with one amended rule copied consistently into `NIP.md`, REQUIREMENTS, ROADMAP, fixtures, and tests. [VERIFIED: codebase grep]  
**Warning signs:** A plan mentions “authorized signature filtering” after citing D-12. [VERIFIED: codebase grep]

### Pitfall 2: DNS Rebinding Survives URL Validation
**What goes wrong:** A public hostname resolves safely during validation and to loopback/private space during connection, or a redirect pivots there. [CITED: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html]  
**How to avoid:** Resolve all answers, reject any forbidden answer for publisher sources, connect to an approved address without re-resolution, preserve hostname for Host/SNI/cert checks, and repeat for every redirect. [CITED: https://owasp.org/APTS/standard/6_Manipulation_Resistance/Implementation_Guide.html]  
**Warning signs:** Production network code calls global `fetch(url)` after `resolveDns`. [CITED: https://docs.deno.com/api/web/fetch/]

### Pitfall 3: HEAD Accidentally Fetches the Final Blob
**What goes wrong:** HEAD becomes expensive and its result implies retrievability D-10 explicitly disclaims. [VERIFIED: codebase grep]  
**How to avoid:** Walk and verify manifests through the final directory link, validate link metadata, but do not fetch the final raw blob or file chunks; return headers derivable from authenticated link/record metadata. [VERIFIED: codebase grep]  
**Warning signs:** HEAD and GET share a helper that eagerly opens the resolved content stream. [ASSUMED]

### Pitfall 4: “Streaming” Still Buffers a Whole Blob
**What goes wrong:** `arrayBuffer()`, `bytes()`, `Blob`, `Response.clone()`, or an unbounded transform queues the entire NAR/manifest. [CITED: https://docs.deno.com/api/web/fetch/]  
**How to avoid:** Use one reader, fixed-size chunks, awaited file writes, bounded stream high-water marks, and reopen verified files for parsing/serving. [ASSUMED]  
**Warning signs:** memory rises linearly with NAR size or tests never use a multi-gigabyte sparse/streaming fixture. [ASSUMED]

### Pitfall 5: Limits Are Individually Present but Not Aggregate
**What goes wrong:** Many small legal manifests, retries, shared subtrees, or redirects multiply into unbounded work. [CITED: https://github.com/hzrd149/blossom/pull/106]  
**How to avoid:** One ledger owns all request work, counts unique node hashes before fetch, and is checked before allocation/network operations. [ASSUMED]  
**Warning signs:** Each helper creates its own counter or retry budget. [ASSUMED]

### Pitfall 6: Persistence and Reactive State Race
**What goes wrong:** The process emits a newer snapshot before its watermark is durable, then crashes and accepts an older root. [VERIFIED: codebase grep]  
**How to avoid:** Commit candidate event, `(created_at,id)` watermark, and signed-history transition in one transaction; publish the immutable snapshot only after commit. [ASSUMED]  
**Warning signs:** `subject.next()` precedes repository commit. [ASSUMED]

### Pitfall 7: Quarantine Scope or Trigger Drifts
**What goes wrong:** ordinary 404/timeouts quarantine healthy servers, or a real hash mismatch is forgotten after restart. [VERIFIED: codebase grep]  
**How to avoid:** Use typed failure classes; only `HashMismatch` writes the canonical origin to durable quarantine. [ASSUMED]  
**Warning signs:** one generic catch block updates quarantine. [ASSUMED]

### Pitfall 8: Draft BUD Churn Breaks Interoperability
**What goes wrong:** implementation follows a moving branch or an older fanout draft and produces different hashes/path behavior. [CITED: https://github.com/hzrd149/blossom/pulls]  
**How to avoid:** Pin BUD-16 `1b2f140…`, BUD-17 `1848f77…`, and BUD-18 `018f3e3…`; record these in fixture metadata and fail tests if vectors drift. [VERIFIED: GitHub API]  
**Warning signs:** documentation links use only branch names or `master`. [VERIFIED: GitHub API]

## Code Examples

### Strict Plaintext `nhash` Profile

```typescript
// Source: https://github.com/hzrd149/blossom/pull/107 plus stricter project NIP.md
function decodePlaintextRoot(value: string): RootHash {
  const decoded = bech32.decode(value, NHASH_MAX_LENGTH);
  if (decoded.prefix !== "nhash") throw new ProtocolError("wrong HRP");
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  const records = decodeExactTlv(bytes); // rejects truncation and trailing bytes
  const roots = records.filter((r) => r.type === 0);
  const keys = records.filter((r) => r.type === 5);
  if (roots.length !== 1 || roots[0].value.length !== 32) throw new ProtocolError("root");
  if (keys.length !== 0) throw new UnsupportedError("BUD-15 root");
  if (records.some((r) => r.type !== 0)) throw new ProtocolError("unknown TLV");
  if (!isCanonicalBech32(value, decoded)) throw new ProtocolError("noncanonical");
  return RootHash.fromBytes(roots[0].value);
}
```

The project profile rejects BUD-18's legacy bare 32-byte payload and every extension type, even though the proposal is more permissive. [VERIFIED: codebase grep] [CITED: https://github.com/hzrd149/blossom/pull/107]

### Manual Redirect Loop Skeleton

```typescript
// Source: https://docs.deno.com/api/web/fetch/ and OWASP SSRF guidance
for (let hop = 0; hop <= limits.redirects; hop++) {
  const target = await policy.resolveAndApprove(url, sourceTrust);
  const response = await transport.fetchPinned(target, {
    redirect: "manual",
    signal: deadline.signal,
  });
  if (!isRedirect(response.status)) return response;
  url = policy.resolveLocation(url, requiredLocation(response));
}
throw new RedirectLimitExceeded();
```

`fetchPinned` is intentionally an unresolved implementation seam until the Wave 0 Deno transport spike proves address binding with correct TLS hostname verification. [CITED: https://docs.deno.com/api/web/fetch/] [ASSUMED]

### Snapshot-Preserving Handler

```typescript
// Source: project D-11
async function handle(req: Request, state: AppState): Promise<Response> {
  const snapshot = state.selection.current();
  if (!snapshot) return new Response("cache unavailable", { status: 503 });
  return req.method === "HEAD"
    ? await resolveHead(req, snapshot)
    : await resolveGet(req, snapshot, req.signal);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BUD-17 fanout encoded as named `_chunk_<start>` `t=2` directories | New writers use unnamed `t=3` fanout with `count/first/last`; readers may accept old draft nodes | Current pinned PR head checked 2026-08-12 | Phase 1 should implement current `t=3`; accepting the compatibility form is optional and increases test scope. [CITED: https://github.com/hzrd149/blossom/pull/106] |
| BUD-18 legacy bare 32-byte `nhash` | TLV with required type 0 and optional type 5 | Current proposal | Project NIP deliberately rejects legacy form and all unknown types. [CITED: https://github.com/hzrd149/blossom/pull/107] [VERIFIED: codebase grep] |
| Nix metadata uncompressed | Nix 2.32 added transparent `.narinfo`/`.ls`/log `Content-Encoding` support | Nix 2.32 | Phase 1 may serve uncompressed metadata; do not assume newer metadata compression is required. [CITED: https://nix.dev/manual/nix/2.34/release-notes/rl-2.32] |

**Deprecated/outdated:** The upstream BUD compatibility form for named `_chunk_` fanout is read-only legacy behavior; never emit it in later writer phases. [CITED: https://github.com/hzrd149/blossom/pull/106]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended numeric defaults/ceilings are suitable for real caches. | Architecture Patterns | Valid caches may be rejected or hostile workloads may receive excessive resources; calibrate with fixtures and Nix E2E. |
| A2 | SQLite is preferable to a JSON journal for the small policy state. | Standard Stack | FFI permissions/deployment complexity may outweigh transaction benefits; spike opening, migration, and crash recovery. |
| A3 | Suggested 502/503/504 mapping makes stock Nix retry/fallback behavior sufficiently diagnosable. | HTTP Status Mapping | Nix may cache or classify errors unexpectedly; verify with the pinned CLI. |
| A4 | The address-bound transport can be implemented cleanly in Deno while retaining Host/SNI validation. | Code Examples | TREE-03 is blocked if the spike cannot close DNS TOCTOU. |
| A5 | `@msgpack/msgpack` can be safely bounded by wire-size ceilings plus post-decode schema/allocation checks. | Standard Stack | Decoder may allocate excessively from malicious length prefixes; add adversarial memory tests or select a streaming/limited decoder. |

## Open Questions

1. **Which signature contract is authoritative after D-12?**
   - What we know: D-12 is locked and explicitly says to amend `NIP.md` and READ-04; those amendments have not happened. [VERIFIED: codebase grep]
   - Recommendation: block plan generation until all three artifacts and success criteria say the same thing. [VERIFIED: codebase grep]

2. **How will Deno pin the actual outbound address?**
   - What we know: manual redirect and AbortSignal exist; checked high-level Fetch docs do not document custom DNS/address binding. [CITED: https://docs.deno.com/api/web/fetch/]
   - Recommendation: Wave 0 prototype against controlled rebinding DNS and HTTPS; if high-level Fetch cannot pin, implement a narrow `Deno.connect`/TLS HTTP transport or enforce a network proxy boundary. [ASSUMED]

3. **What selected-publication freshness lifetime applies?**
   - What we know: NIP recommends 15 minutes for gateways; D-01 says stop once ineligible, but CONTEXT does not lock the configured staleness period. [VERIFIED: codebase grep]
   - Recommendation: default to 15 minutes with a bounded operator setting, and test that expiration clears serving without rolling back. [ASSUMED]

4. **Does Phase 1 accept unsigned caches?**
   - What we know: NIP permits them subject to local policy and downgrade consent; a real stock Nix client then needs a trusted substituter policy. [VERIFIED: codebase grep] [CITED: https://nix.dev/manual/nix/2.34/store/types/http-binary-cache-store]
   - Recommendation: use a signed cache for the READ-07 gate; include explicit `allowUnsigned` configuration defaulting false if unsigned support remains in scope. [ASSUMED]

5. **Should the reader accept BUD-17's older compatibility fanout?**
   - What we know: the pinned proposal permits it but does not require it. [CITED: https://github.com/hzrd149/blossom/pull/106]
   - Recommendation: reject it in Phase 1 unless the chosen real cache fixture needs it; strict current-format support reduces ambiguity. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Deno | all implementation/tests | ✓, patch mismatch | `2.9.4` host vs `2.9.5` target | Upgrade/pin toolchain before phase gate. [VERIFIED: local environment probe] |
| Nix CLI | READ-07 E2E | ✓ | `2.34.7` | Pin this as initial supported E2E version; optionally add 2.35 later. [VERIFIED: local environment probe] |
| Git | pinned fixtures/versioning | ✓ | `2.53.0` | — [VERIFIED: local environment probe] |
| curl | fixture/debug probing | ✓ | `8.18.0` | Deno fixture client. [VERIFIED: local environment probe] |
| OpenSSL | local TLS hostile fixtures | ✓ | `3.5.5` | Deno certificate tooling or committed test CA. [VERIFIED: local environment probe] |
| SQLite native library for `@db/sqlite` | durable state | not yet exercised | — | Wave 0 dependency/permission spike. [CITED: https://jsr.io/@db/sqlite] |

**Missing dependencies with no fallback:** none currently, but exact Deno `2.9.5` is not installed and must be corrected for a reproducible gate. [VERIFIED: local environment probe]  
**Missing dependencies with fallback:** SQLite native/FFI behavior has not been proven; a deliberate spike must precede schema tasks. [CITED: https://jsr.io/@db/sqlite]

## Validation Architecture

`workflow.nyquist_validation` is explicitly `false`, so the standard Validation Architecture section is intentionally skipped. [VERIFIED: codebase grep] Phase 1 still requires executable verification because READ-07 and the security controls are phase acceptance criteria. [VERIFIED: codebase grep]

Prescriptive verification layers: [ASSUMED]

1. Fixed protocol vectors for all NIP validation failures, exact identities, BUD-18 TLV, pinned BUD-16/17 manifests, and strict `.narinfo` syntax. [CITED: https://github.com/hzrd149/blossom/pulls]
2. Property tests for arbitrary chunk boundaries, malformed MessagePack/TLV lengths, duplicate names/tags, budget off-by-one boundaries, and URL/IP representations. [ASSUMED]
3. In-process relay and hostile Blossom fixtures covering redirect-to-private, DNS rebinding, mixed DNS answers, timeout, truncation, oversize, hash mismatch/quarantine persistence, retry order, and shared-DAG amplification. [ASSUMED]
4. Restart tests proving older/tied candidates cannot replace a committed selection and signed-to-unsigned changes require durable consent. [VERIFIED: codebase grep]
5. Real `nix 2.34.7` E2E: create/copy a signed fixture path to the published tree, delete it from a separate test store, configure only the daemon substituter/key, run `nix copy` or `nix build --substitute`, and verify no other substituter satisfies the path. [VERIFIED: local environment probe] [ASSUMED]
6. Streaming memory test with a generated large NAR/blob and a deliberately slow sink; assert memory remains within a fixed envelope and cancellation removes temporary files. [ASSUMED]

Quick developer gate should become `deno fmt --check && deno lint && deno check main.ts && deno test` and the full gate should add permission-scoped integration plus Nix E2E tasks. [ASSUMED]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Verify every Nostr event signature before eligibility; configured raw publisher pubkey is the trust anchor. [VERIFIED: codebase grep] |
| V3 Session Management | no | Phase 1 has no user session or write authorization. [VERIFIED: codebase grep] |
| V4 Access Control | yes | Environment whitelist controls publishers; source trust distinguishes configured private-capable URL from publisher URLs. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Strict value objects/codecs for events, tags, URLs, TLV, MessagePack, paths, headers, and `.narinfo`. [VERIFIED: codebase grep] |
| V6 Cryptography | yes | Applesauce Nostr verification and incremental SHA-256; never hand-roll primitives. [CITED: https://applesauce.build/] [CITED: https://github.com/paulmillr/noble-hashes] |
| V8 Data Protection | yes | Durable policy DB and temp files need owner-only permissions; logs must not expose future key material or unsafe publisher content. [ASSUMED] |
| V12 Files and Resources | yes | Unique temp files, byte ceilings, cleanup on abort, no path materialization from untrusted names. [ASSUMED] |
| V13 API and Web Service | yes | Method allowlist, strict route grammar, safe statuses, request cancellation, bounded work. [ASSUMED] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged/invalid Nostr publication | Spoofing | Signature/id verification before store admission. [VERIFIED: codebase grep] |
| Stale relay rollback or tie manipulation | Tampering | Durable `(created_at,id)` watermark and atomic snapshot publication. [VERIFIED: codebase grep] |
| Signed-to-unsigned downgrade | Tampering | Persist signed history and explicit consent. [VERIFIED: codebase grep] |
| Blossom hash substitution | Tampering | Full-blob SHA-256 before decode/serve; durable source quarantine on mismatch. [VERIFIED: codebase grep] |
| SSRF/DNS rebinding/redirect pivot | Elevation / Information disclosure | Exact address classification and binding, manual redirects, per-hop revalidation. [CITED: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html] |
| Manifest/DAG amplification | Denial of service | Wire/decoded/node/depth/link budgets and visited-hash deduplication. [CITED: https://github.com/hzrd149/blossom/pull/106] |
| Slow or infinite body | Denial of service | connect/idle/total deadlines, byte limits, abort propagation, awaited backpressure. [ASSUMED] |
| Unicode/path ambiguity | Tampering | split path before segment decode; exact UTF-8 name comparison; reject slash/NUL/dot segments/duplicates. [CITED: https://github.com/hzrd149/blossom/pull/105] |
| Temporary-file disclosure/collision | Information disclosure / Tampering | OS-created unique files, restrictive permissions, atomic lifecycle, cleanup. [ASSUMED] |

## Sources

### Primary (HIGH confidence)
- Project `NIP.md`, `AGENTS.md`, CONTEXT, REQUIREMENTS, ROADMAP, STATE, and current code/config — normative project contract and repository facts. [VERIFIED: codebase grep]
- [BUD-01](https://github.com/hzrd149/blossom/blob/master/buds/01.md) and [BUD-03](https://github.com/hzrd149/blossom/blob/master/buds/03.md) — official merged Blossom retrieval/server-list text. [CITED: official repository]
- [BUD-16 PR 105](https://github.com/hzrd149/blossom/pull/105) at `1b2f140b0d3fd06a907b159d7628e1d007588da3`, [BUD-17 PR 106](https://github.com/hzrd149/blossom/pull/106) at `1848f77c4a25b70d10a3963d66ba1c8aba1e4f2c`, and [BUD-18 PR 107](https://github.com/hzrd149/blossom/pull/107) at `018f3e32227cf8fd1fba8dff2d39d6e3370d2d52` — exact proposal revisions and vectors fetched via GitHub API/raw content. [VERIFIED: GitHub API]
- [Nix binary cache](https://nix.dev/manual/nix/2.35/protocols/binary-cache/), [narinfo](https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html), and [HTTP store](https://nix.dev/manual/nix/2.34/store/types/http-binary-cache-store) — official stock-client protocol. [CITED: official docs]
- [Deno HTTP server](https://docs.deno.com/api/deno/http-server/) and [Fetch](https://docs.deno.com/api/web/fetch/) — official runtime API. [CITED: official docs]
- [Applesauce docs](https://applesauce.build/introduction/getting-started.html) — official EventStore/RelayPool reactive pattern. [CITED: official docs]
- [OWASP SSRF guidance](https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/) — redirects, DNS rebinding, and TOCTOU risks. [CITED: official security guidance]

### Secondary (MEDIUM confidence)
- npm registry and GSD package-legitimacy seam — versions, publish dates, downloads, repository metadata, postinstall, and SUS/OK/SLOP verdicts. [VERIFIED: npm registry]
- [JSR `@db/sqlite`](https://jsr.io/@db/sqlite) — version/API/FFI permission requirements. [CITED: official registry docs]

### Tertiary (LOW confidence)
- Numeric default/ceiling recommendations and exact gateway status choices are marked `[ASSUMED]` pending hostile fixtures and real-Nix validation.

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM-HIGH — versions and official APIs verified, but five npm packages are SUS under the legitimacy gate and SQLite FFI is not exercised. [VERIFIED: package-legitimacy seam]
- Architecture: HIGH — it follows locked project decisions and official streaming/reactive interfaces. [VERIFIED: codebase grep] [CITED: https://docs.deno.com/api/web/fetch/]
- Hashtree codec: MEDIUM — exact primary proposal heads are pinned but remain open and can change. [VERIFIED: GitHub API]
- Network safety: MEDIUM — threat and required property are clear, but the Deno address-binding implementation remains an explicit spike. [CITED: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html]
- Nix compatibility: MEDIUM-HIGH — protocol docs and local CLI are verified, but end-to-end behavior must be proven against the actual daemon. [CITED: https://nix.dev/manual/nix/2.35/protocols/binary-cache/] [VERIFIED: local environment probe]

**Research date:** 2026-08-12  
**Valid until:** 2026-08-19 for BUD/Applesauce/package versions; 2026-09-11 for stable architecture and Nix/Deno protocol findings. [ASSUMED]
