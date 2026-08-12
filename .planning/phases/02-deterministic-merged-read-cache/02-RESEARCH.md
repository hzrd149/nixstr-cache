# Phase 2: Deterministic Merged Read Cache - Research

**Researched:** 2026-08-12
**Domain:** Reactive multi-identity cache selection, semantic Narinfo merging, winner-pinned NAR routing, verified Blossom read/write-through
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Treat the ordered configured cache-identity list as the sole priority source; relay arrival order, event timestamp across different identities, and lookup latency never change publisher priority.
- Accept raw identities only in canonical `17091:<pubkey>:` or `37091:<pubkey>:<exact-d>` form. Preserve exact named-cache `d` values and reject duplicates during configuration validation.
- Maintain one independently freshness-checked selected root per configured identity, then expose an immutable ordered snapshot of all currently available identities through an Applesauce reactive model.
- Expiration or withdrawal of one identity removes only that layer and does not roll another identity backward.
- Resolve the requested `.narinfo` against every available layer in priority order using one request-captured merged snapshot.
- Compare parsed non-signature semantic fields canonically. Records that agree contribute a stable union of syntactically valid `Sig` lines while preserving the highest-priority record's scalar field encoding/order.
- Deduplicate identical signature lines byte-for-byte and append lower-priority unique signatures in stable publisher and record order.
- On any semantic disagreement, serve the complete highest-priority record unchanged and emit one structured conflict diagnostic containing the store-path hash, winning/losing identities, and differing field names; do not leak record contents or silently merge.
- Use a typed diagnostic sink at the merged-index/HTTP boundary rather than ad-hoc console strings so tests and future operator surfaces can consume the same event.
- Emit at most one diagnostic per losing record per request; include stable machine-readable codes and identity/event references.
- Conflict warnings are non-fatal for reads because deterministic priority already chooses the safe result; resolver/hash/transport failures retain their existing typed HTTP mappings.
- NAR retrieval follows the Narinfo winner's snapshot and URL/hash metadata, preventing metadata from one publisher from selecting bytes from another.
- Model the local cache as an explicitly operator-configured origin with local-service allowance; it is tried before remote sources for reads but never trusted by location alone.
- Every local hit is streamed and hash-verified through the same immutable blob boundary before use. Corrupt local bytes are discarded/ignored and remote resolution continues.
- Populate the local cache only after remote bytes have passed address verification and content-hash verification; upload with streaming/backpressure and preserve retryable failures as diagnostics.
- Phase 2 adds no public write route and no signer dependency. The local service is an optimization, never an authority or availability prerequisite.

### the agent's Discretion
- Exact internal type/module names, provided they preserve the identity-layer, immutable-snapshot, typed-diagnostic, and verified-blob boundaries above.
- Whether duplicate Narinfo probing is sequential or bounded-concurrent, provided output ordering and resource ceilings remain deterministic and explicit.
- Local cache upload retry timing within Phase 2, provided failed uploads remain observable and do not fail a successfully verified read.

### Deferred Ideas (OUT OF SCOPE)
- HTTP PUT authorization and streamed Nix upload ingestion are Phase 3.
- Hashtree mutation, replica availability gates, event signing, publication debounce/retry, and relay acknowledgements are Phase 4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROT-01 | Ordered whitelist of exact kind 17091/37091 identities | Canonical identity parser, ordered config type, exact relay filters, per-identity reactive projection |
| TREE-06 | Local Blossom read/write-through receives only verified immutable blobs | Configured-first read plan, unchanged verification boundary, post-verification file-backed uploader |
| READ-05 | Union signatures only for semantically equal Narinfo records | Complete non-`Sig` semantic projection, stable raw-line signature union, winner-preserving serializer |
| READ-06 | Serve priority winner and report semantic conflicts | Typed diagnostic sink, field-name diff, one event per losing record, winner-pinned NAR route |
</phase_requirements>

## Summary

Phase 2 should generalize, not replace, the Phase 1 walking slice. The durable admission sequence (`validate -> authorize exact identity -> repository.accept -> EventStore.add`) is already correct; only the reactive view is wrong for this phase because `CacheSelectionModel` globally sorts all authorized publications and returns one event. Replace its scalar result with an immutable array produced by mapping the configured identity array in order and independently selecting the current valid event for each identity. `[VERIFIED: codebase inspection of src/nostr/selection.ts and src/persistence/state_repository.ts]`

The main new domain object should be a merged Narinfo resolution result containing the priority winner, its exact publication snapshot, the parsed winner record, and the emitted response text. Semantic equality must cover every recognized non-`Sig` field, including optional-field presence and values; the current `NarInfo` type drops `Deriver`, `System`, and `CA`, so comparing only its exposed required properties would incorrectly merge conflicts. There is one planning-blocking upstream-input conflict: Phase 2 context requires byte-identical signature deduplication, while normative `NIP.md` requires concatenating **all** `Sig` occurrences and preserving occurrence order. The planner must not implement deduplication until the project owner resolves or amends this conflict; the protocol-safe default is stable concatenation without deduplication. `[VERIFIED: NIP.md lines 529-544, AGENTS.md, Phase 2 CONTEXT.md, and src/protocol/narinfo.ts]`

Winner pinning needs explicit state across the client's Narinfo and subsequent NAR HTTP requests: the winner's `URL` is returned unchanged, so the later `/nar/...` request otherwise has no identity in its path. Add a bounded route registry keyed by normalized winner URL/path that stores the exact `SelectedPublication` and event id when Narinfo is served; the NAR handler consumes that pinned publication instead of re-running priority lookup. Local Blossom caching should remain below this layer: prepend it to every source plan, keep the existing SHA-256 spool verification unchanged, and asynchronously upload a fresh stream opened from the verified spool before disposal. `[VERIFIED: codebase inspection of src/nix/http_handler.ts, src/hashtree/reader.ts, and src/blossom/blob_fetcher.ts]`

**Primary recommendation:** Resolve the signature-deduplication conflict first, then implement an ordered `MergedSelectionSnapshot`, a pure Narinfo compare/merge module, a bounded winner-route registry, and a post-verification `BlobCacheSink`; keep all four behind the existing request snapshot and `VerifiedBlob` boundaries.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ordered exact identity validation | API / Backend | — | Startup config establishes trust and priority before network side effects. |
| Reactive selected-root array | API / Backend | Database / Storage | EventStore projects durably admitted publications; SQLite remains freshness authority. |
| Narinfo semantic merge/conflict | API / Backend | — | This is gateway protocol logic over bounded authenticated metadata. |
| Winner-pinned NAR routing | API / Backend | Database / Storage | HTTP routing owns lookup; a bounded in-memory registry carries the prior winning snapshot. |
| Local Blossom read/write-through | API / Backend | Database / Storage | Network client verifies and streams immutable blobs to an external local service. |

All tier assignments follow the existing single-process daemon architecture. `[VERIFIED: AGENTS.md and src/runtime/daemon.ts]`

## Project Constraints (from AGENTS.md)

- `NIP.md` is normative; implementation cannot weaken any MUST/MUST NOT. `[VERIFIED: AGENTS.md]`
- Stay on Deno/TypeScript and Applesauce reactive stores/casts/Observable composition. Use Web Streams, not RxJS, for bytes. `[VERIFIED: AGENTS.md]`
- Never buffer whole files/datasets; preserve backpressure and explicit transfer, traversal, and decoded-byte limits. `[VERIFIED: AGENTS.md]`
- Revalidate SSRF after DNS resolution and every redirect; operator-configured local services may be explicitly allowed. `[VERIFIED: AGENTS.md]`
- Verify events and content hashes before use; preserve per-identity freshness and signed-to-unsigned protection. `[VERIFIED: AGENTS.md]`
- Stock Nix HTTP behavior stays compatible; public PUT remains unavailable in this phase. `[VERIFIED: AGENTS.md and Phase 2 CONTEXT.md]`
- Start edits through a GSD workflow; this research is running under `$gsd-plan-phase --research-phase`. `[VERIFIED: AGENTS.md and orchestration context]`
- No project-specific skills are present. `[VERIFIED: AGENTS.md project-skill section and filesystem inventory]`

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Deno | installed `2.9.4` | Runtime, HTTP, filesystem and Web Streams | Existing project runtime; no new runtime needed. `[VERIFIED: deno --version]` |
| TypeScript | Deno-bundled `6.0.3` | Immutable domain types and discriminated diagnostics | Already used throughout strict project sources. `[VERIFIED: deno --version and codebase]` |
| `applesauce-core` | locked `6.2.0` | EventStore and custom reactive merged-selection model | Existing installed API shares custom models with `ReplaySubject(1)` and terminates them on store disposal. `[VERIFIED: installed package source and deno.lock]` |
| RxJS | locked `7.8.2` | Compose selected publications and refresh/expiry signals | Existing control-plane dependency; byte streams must remain Web Streams. `[VERIFIED: deno.json and deno.lock]` |
| Web Streams | Deno built-in | Backpressured verified reads and local-cache uploads | Existing `VerifiedBlob.open()` yields independent file streams. `[VERIFIED: src/blossom/blob_fetcher.ts]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@noble/hashes` | locked `2.3.0` | Incremental SHA-256 | Keep inside `BlobFetcher`; do not hash again in merger/uploader. `[VERIFIED: deno.json and src/blossom/blob_fetcher.ts]` |
| Deno test + `@std/assert` | Deno built-in / `1.0.19` | Protocol and integration regression tests | Extend existing focused suites. `[VERIFIED: deno.json]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One custom merged EventStore model | One `replaceable()` subscription per identity plus external `combineLatest` | Exact per-identity subscriptions are viable, but the existing custom model already centralizes expiry refresh and BUD-03 projection; generalizing it minimizes lifecycle seams. `[VERIFIED: installed Applesauce API and codebase]` |
| Sequential Narinfo probing | Bounded concurrent probing | Concurrent probing can reduce latency but complicates shared request-budget accounting and cancellation. Begin sequentially; priority order and small bounded metadata make behavior easiest to prove. `[ASSUMED]` |
| Bounded route registry | Rewrite winner `URL` to encode identity | URL rewriting violates the locked requirement to preserve the winner's scalar representation and changes signed metadata semantics. `[VERIFIED: Phase 2 CONTEXT.md]` |

**Installation:** None. Phase 2 needs no new external package. `[VERIFIED: existing dependency graph covers all required primitives]`

## Package Legitimacy Audit

Not applicable: no external packages should be installed in this phase. `[VERIFIED: recommended design]`

## Architecture Patterns

### System Architecture Diagram

```text
relay events
    -> validate + exact-identity authorize
    -> durable per-identity accept
    -> EventStore admission
    -> ordered immutable MergedSelectionSnapshot
                         |
stock Nix GET/HEAD ------+
    -> capture snapshot once
    -> .narinfo? probe every layer in configured order
         -> parse bounded metadata
         -> compare complete non-Sig semantics
         -> compatible: winner raw scalars + stable Sig union
         -> conflict: winner unchanged + typed diagnostic
         -> register winner URL -> exact publication snapshot
    -> NAR? route registry lookup
         -> exact winner publication resolver
    -> Hashtree resolver
         -> local configured Blossom first
         -> publisher sources on miss/corruption
         -> verified spool boundary
              -> response stream
              -> best-effort local PUT /upload stream
```

Every transition above already exists except the ordered snapshot, multi-layer Narinfo operation, route registry, and cache sink. `[VERIFIED: codebase mapping]`

### Recommended Project Structure

```text
src/
├── config/config.ts                 # ordered exact identities + local Blossom config
├── nostr/selection.ts               # immutable ordered merged selection model
├── protocol/narinfo.ts              # complete semantic projection and raw Sig merge
├── nix/merged_cache.ts              # multi-layer probe, conflict types, route registry
├── nix/http_handler.ts              # stock-Nix routing and request snapshot orchestration
├── blossom/blob_fetcher.ts          # unchanged verify-first boundary + cache hook
├── blossom/cache_sink.ts            # streamed BUD-02 local upload adapter
└── runtime/daemon.ts                # exact relay filters and production composition
tests/
├── protocol/narinfo_test.ts
├── integration/merged_cache_test.ts
├── integration/publication_selection_test.ts
├── integration/hostile_blossom_test.ts
└── e2e/nix_substitution_test.ts
```

### Pattern 1: Ordered Per-Identity Reactive Projection

**What:** Retain all durably admitted history in EventStore, but derive exactly one current non-expired selection for each configured identity and return the results in configuration order. `[VERIFIED: existing model and locked decisions]`

**When to use:** Every read request captures the array once before any await.

```typescript
// Source: installed applesauce-core@6.2.0 custom Model API
export type MergedSelectionSnapshot = readonly SelectedPublication[];

export function MergedSelectionModel(options: ModelOptions): Model<MergedSelectionSnapshot> {
  return (store) => combineLatest([
    store.timeline([{ kinds: [17091, 37091] }], true),
    store.timeline([{ kinds: [10063] }]),
    options.refresh$.pipe(startWith(undefined)),
  ]).pipe(map(([events, servers]) => Object.freeze(
    options.orderedIdentities.flatMap((identity) => {
      const selected = selectCurrentForExactIdentity(events, identity, options.now());
      return selected ? [attachBud03(selected, servers)] : [];
    }),
  )));
}
```

Use `includeOldVersion: true` or retain the current store setting because expiry must remove only that identity and must never reveal an older root. Repository watermarks remain authoritative. `[VERIFIED: installed TimelineModel behavior and Phase 1 selection tests]`

### Pattern 2: Pure Semantic Comparison, Winner-Preserving Serialization

**What:** Parse each bounded record into both raw lines and a complete canonical non-signature map. Equality compares keys and values; differences return sorted field names. Signature concatenation preserves each `rawLine` byte-for-byte. `[VERIFIED: NIP.md lines 538-544]`

```typescript
// Source: project NIP.md and official Nix narinfo field documentation
interface NarInfoSemantics {
  readonly fields: ReadonlyMap<NarInfoField, string | number | readonly string[]>;
}
interface NarInfoConflictDiagnostic {
  readonly code: "narinfo_semantic_conflict";
  readonly storePathHash: string;
  readonly winner: PublicationRef;
  readonly loser: PublicationRef;
  readonly differingFields: readonly NarInfoField[];
}
```

The merger must preserve the full winner raw record unchanged on conflict. On agreement, the protocol-safe behavior is to append every lower-priority `Sig: ...` occurrence at the winner's signature section/end without rebuilding scalar lines; byte-identical deduplication remains gated by the normative conflict above. `[VERIFIED: NIP.md and authority precedence]`

### Pattern 3: Winner Route Registry

**What:** Record `normalizeNarUrl(winner.record.url) -> { publication, eventId, expiresAt }` when serving merged Narinfo. A later NAR request uses that exact publication snapshot. Bound entries by count and TTL, overwrite deterministically, and remove expired entries. `[ASSUMED]`

**When to use:** Any NAR path that came from a served Narinfo. A missing route may fall back to ordinary ordered lookup for direct/manual NAR requests, but must never override an existing pin. `[ASSUMED]`

### Pattern 4: Verify Then Fan Out From File

**What:** `BlobFetcher` first completes the existing SHA-256-verified owner-only spool. Only then may separate `blob.open()` streams feed parsing/serving and a local cache uploader. Do not `tee()` the hostile network response before verification. `[VERIFIED: src/blossom/blob_fetcher.ts and Phase 2 CONTEXT.md]`

The cache upload must own a lease/reference on the spool until its stream completes; current resolver cleanup disposes the file immediately after manifest parsing or response EOF, so an untracked fire-and-forget upload races deletion. Add reference-counted leases or make the sink consume a distinct retained file handle under a supervised background task. `[VERIFIED: src/hashtree/reader.ts cleanup paths]`

### Anti-Patterns to Avoid

- **Global newest event:** sorting all identities by `created_at` destroys configured priority. Map configured identities first. `[VERIFIED: current bug in src/nostr/selection.ts relative to locked decision]`
- **Compare only signature fingerprint:** the Nix signing fingerprint omits `URL`, compression/download hash/size and optional fields; it is not semantic record equality. `[VERIFIED: src/protocol/narinfo.ts]`
- **Rebuild winner Narinfo from typed fields:** this loses original scalar order/encoding and optional fields. Preserve raw lines. `[VERIFIED: locked decision]`
- **Resolve NAR across all layers:** this permits bytes from a different publisher than the Narinfo winner. Use the route pin. `[VERIFIED: locked decision]`
- **Trust configured-local bytes:** configured trust changes network reachability only; SHA-256 verification still applies. `[VERIFIED: NIP.md lines 452-488]`
- **Upload before verification:** never stream hostile remote bytes directly into the local cache. `[VERIFIED: locked decision]`
- **Add public PUT:** local BUD-02 egress is internal and does not authorize inbound Nix PUT. `[VERIFIED: phase boundary]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive model sharing/lifecycle | Custom observer registry | `EventStore.model` + RxJS | Installed Applesauce memoizes, replays, and disposes models. `[VERIFIED: installed applesauce-core source]` |
| Blob integrity | A second cache-specific hasher | Existing `BlobFetcher`/`VerifiedBlob` | It already enforces streaming SHA-256, sizes, cleanup, quarantine, and attempts. `[VERIFIED: codebase]` |
| SSRF exception | Special raw `fetch()` for localhost | Existing `SafeFetcher` configured-origin allowance | It pins DNS and revalidates redirects. `[VERIFIED: codebase and Phase 1 verification]` |
| Narinfo trust filtering | Signature selection by publisher keys | Preserve all syntactically valid signatures; classify endorsements separately | NIP requires pass-through and leaves Nix trust policy to the client. `[VERIFIED: NIP.md lines 520-544]` |
| Local upload protocol | Custom path keyed by hash | BUD-02 `PUT /upload` with `Content-Length` and `X-SHA-256` | Standard endpoint returns 200 for existing or 201 for stored content. `[CITED: https://github.com/hzrd149/blossom/blob/master/buds/02.md]` |

**Key insight:** Phase 2's hard correctness properties are boundary composition—ordered identity, complete metadata semantics, exact winner provenance, and verify-before-cache—not new cryptography or storage formats.

### Normative Conflict Gate

| Source | Requirement | Consequence |
|--------|-------------|-------------|
| `NIP.md` lines 538-544 | Compatible records MUST concatenate all `Sig` fields and preserve source/occurrence order. | Duplicate occurrences remain present. `[VERIFIED: NIP.md]` |
| `02-CONTEXT.md` | Deduplicate identical signature lines byte-for-byte. | Duplicate occurrences are removed. `[VERIFIED: Phase 2 CONTEXT.md]` |
| `AGENTS.md` | `NIP.md` is normative and implementation MUST NOT weaken it. | Planner needs an explicit corrected decision before locking merge behavior. `[VERIFIED: AGENTS.md]` |

Until corrected, tests should encode stable concatenation of every occurrence, not deduplication. `[VERIFIED: authority precedence]`

## Common Pitfalls

### Pitfall 1: `publisherPubkeys` Cannot Express Named Identity Priority
**What goes wrong:** Current config creates only `17091:<pubkey>:` identities and a set erases ordering intent. `[VERIFIED: src/config/config.ts]`
**How to avoid:** Add a dedicated ordered raw identity input, parse it into a typed `CacheIdentity`, derive publisher authors as a deduplicated secondary value, and reject exact duplicate identity strings before side effects.
**Warning signs:** Relay subscription contains only kind 17091, or selection options accept `ReadonlySet<string>` as the priority representation.

### Pitfall 2: Optional Narinfo Fields Disappear
**What goes wrong:** Current parser validates `Deriver`, `System`, and `CA` but does not retain them, so disagreement cannot be reported. `[VERIFIED: src/protocol/narinfo.ts]`
**How to avoid:** Retain every supported non-Sig field in the semantic projection and raw line representation; test optional absence versus empty/present values.
**Warning signs:** Equality is implemented over the current `NarInfo` interface alone.

### Pitfall 3: HEAD Cannot Know Merged Content Length Without Reading Metadata
**What goes wrong:** Existing HEAD traversal authenticates the final link without fetching content, but signature union can change response length and semantic conflict detection requires bodies. `[VERIFIED: src/nix/http_handler.ts and src/hashtree/reader.ts]`
**How to avoid:** For `.narinfo` HEAD, internally perform bounded GET-style metadata resolution/merge, then return no body with the exact merged `Content-Length`. Keep NAR HEAD on the current no-body path.
**Warning signs:** Narinfo HEAD returns the highest layer's authenticated link size without probing compatible lower records.

### Pitfall 4: Shared Budget Accidentally Becomes Per-Layer Unlimited
**What goes wrong:** Creating a fresh `RequestBudget` for every layer multiplies attempt and transfer ceilings by identity count. `[VERIFIED: existing budget construction and resource constraints]`
**How to avoid:** Capture one request budget/ledger and debit every layer probe; add an explicit maximum identity count in config or compiled policy.
**Warning signs:** `budgetFor()` occurs inside the per-layer loop.

### Pitfall 5: Fire-and-Forget Upload Races Spool Disposal
**What goes wrong:** `VerifiedBlob.dispose()` removes the only file while the uploader is still reading. `[VERIFIED: src/hashtree/reader.ts and src/blossom/blob_fetcher.ts]`
**How to avoid:** Introduce explicit leases/reference counting and supervise upload promises; emit typed failure diagnostics without rejecting the verified read.
**Warning signs:** `void cache.put(blob.open())` followed by immediate `blob.dispose()`.

### Pitfall 6: Local Corruption Quarantines the Only Optimization Permanently
**What goes wrong:** Existing hash mismatch quarantine persists by origin, so one corrupt local entry could suppress all local-cache reads until manual release. `[VERIFIED: src/blossom/blob_fetcher.ts and StateRepository quarantine behavior]`
**How to avoid:** Preserve fallback, emit a local-cache corruption diagnostic, and define scoped recovery/retry behavior. At minimum, remote read success must continue and repopulation should be able to repair the local hash. `[ASSUMED]`
**Warning signs:** local mismatch consumes the remaining source-attempt budget or prevents the remote sources from running.

## Code Examples

### Stable Signature Concatenation (Protocol-Safe Default)

```typescript
// Source: project Phase 2 CONTEXT.md
const appended: string[] = [];
for (const candidate of compatibleLosers) {
  for (const signature of candidate.record.signatures) {
    appended.push(signature.rawLine);
  }
}
return appendSignatureLines(winner.record.rawText, appended);
```

### BUD-02 Streamed Cache Population

```typescript
// Source: https://github.com/hzrd149/blossom/blob/master/buds/02.md
await fetch(new URL("upload", localOrigin), {
  method: "PUT",
  headers: {
    "content-type": "application/octet-stream",
    "content-length": String(blob.size),
    "x-sha-256": blob.hash,
  },
  body: blob.open(),
});
```

Production code must use the configured safe transport boundary, accept only 200/201, validate the bounded descriptor response, and hold a spool lease through request completion. `[VERIFIED: BUD-02 and project network constraints]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One globally selected publication | Ordered independently current identities | Phase 2 | Deterministic merged view independent of relay timing. `[VERIFIED: phase scope]` |
| Return one parsed Narinfo unchanged | Winner raw record plus compatible signature union | Phase 2 | Multiple publisher signatures remain available to stock Nix. `[VERIFIED: NIP.md]` |
| NAR lookup against current single root | Route to exact Narinfo winner snapshot | Phase 2 | Metadata and bytes cannot cross publisher provenance. `[VERIFIED: locked decision]` |
| Configured Blossom as preferred remote only | Optional verified read/write-through local service | Phase 2 | Reuses immutable blobs without becoming an authority. `[VERIFIED: phase scope]` |

**Deprecated/outdated:**
- `publisherPubkeys -> default identities` derivation is insufficient once named caches and explicit priority exist. `[VERIFIED: current config versus PROT-01]`
- The scalar `SelectionView.current(): SelectedPublication | undefined` should be replaced with an ordered snapshot view. `[VERIFIED: current HTTP interface versus phase decisions]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Sequential probing is the preferred first implementation. | Alternatives | Latency may be unacceptable with many identities; bounded concurrency may be needed. |
| A2 | A bounded in-memory winner route registry is the best way to pin later NAR requests while preserving raw `URL`. | Pattern 3 | Nix request behavior or concurrent clients may require a different correlation design. |
| A3 | Direct/manual NAR requests without a registered winner may fall back to ordinary priority lookup. | Pattern 3 | Could weaken strict provenance expectations; planner should lock behavior. |
| A4 | Local-corruption recovery should permit remote success to repair/retry the local origin despite origin quarantine. | Pitfall 6 | Existing quarantine policy may intentionally require manual release. |

## Open Questions

1. **Must compatible signature occurrences be concatenated or deduplicated? (BLOCKING)**
   - What we know: Normative `NIP.md` requires concatenating all occurrences; locked context requires byte-identical deduplication. `[VERIFIED: NIP.md and Phase 2 CONTEXT.md]`
   - What's unclear: Whether the context intended to amend the protocol or accidentally contradicted it.
   - Recommendation: Preserve every occurrence per `NIP.md` unless the owner explicitly changes the normative document and fixtures. The planner should insert a decision checkpoint before implementing READ-05.

2. **How is authenticated local Blossom upload configured?**
   - What we know: BUD-02 allows a server to require BUD-11 authorization; current config has only `preferredBlossomUrl` and Phase 2 explicitly adds no signer dependency. `[CITED: https://github.com/hzrd149/blossom/blob/master/buds/02.md; VERIFIED: src/config/config.ts]`
   - What's unclear: Whether the target local service is guaranteed operator-configured for unauthenticated upload, or needs a static operator credential/header boundary.
   - Recommendation: Plan a narrow optional `BlobCacheSink` with an injectable authorization-header provider; default integration fixture can allow unauthenticated local PUT. Do not construct NIP-46/local publication signers in Phase 2. `[ASSUMED]`

3. **What is the exact winner-route eviction policy?**
   - What we know: NAR retrieval must follow the served Narinfo winner, and raw winner URL must be preserved. `[VERIFIED: Phase 2 CONTEXT.md]`
   - What's unclear: Entry count and TTL are not decided.
   - Recommendation: Make both constructor-required bounded values, test deterministic eviction, and keep the stored snapshot immutable. `[ASSUMED]`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Deno | Build/test/runtime | ✓ | 2.9.4 | — |
| Nix CLI | Stock-client E2E | ✓ | 2.35.1 | Existing fixture tests for quick runs |
| Git | Commit research | ✓ | 2.53.0 | — |
| SQLite CLI | Manual DB inspection | ✗ | — | `node:sqlite` repository/tests; CLI not required |

All availability values were probed locally. `[VERIFIED: command output]`

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** SQLite CLI is absent but not required by implementation or tests.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Deno test 2.9.4 + `@std/assert` 1.0.19 |
| Config file | `deno.json` |
| Quick run command | `deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/merged_cache_test.ts` |
| Full suite command | `deno task verify` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROT-01 | Parse ordered default/named exact identities, reject duplicates, preserve raw `d`, filter relay events, independently expire layers | integration | `deno test --allow-read --allow-write tests/integration/operator_config_test.ts tests/integration/publication_selection_test.ts` | Partial; Wave 0 additions required |
| READ-05 | Complete semantic equality and stable byte-line signature union; HEAD length accurate | protocol + integration | `deno test tests/protocol/narinfo_test.ts && deno test --allow-read --allow-write tests/integration/merged_cache_test.ts` | Narinfo test exists; merged test missing |
| READ-06 | Winner unchanged on every differing field; one redacted typed diagnostic per loser; NAR uses winner snapshot | integration | `deno test --allow-read --allow-write tests/integration/merged_cache_test.ts` | Missing — Wave 0 |
| TREE-06 | Local first, corrupt fallback, verified-only streamed PUT, retry diagnostic, no public PUT | integration | `deno test --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/hostile_blossom_test.ts tests/integration/http_cache_test.ts` | Existing fixtures need cases |
| READ-05/06/TREE-06 | Stock Nix substitutes merged winner and local cache is reused | E2E | `deno task test:nix-e2e` | Exists; extend fixture |

### Sampling Rate
- **Per task commit:** Run the focused protocol/integration file changed by the task.
- **Per wave merge:** `deno task fmt && deno task lint && deno task check && deno task test:integration`
- **Phase gate:** `deno task verify` green before `$gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/integration/merged_cache_test.ts` — multi-layer agreement/conflict, request snapshot, winner route, HEAD behavior.
- [ ] Extend `tests/protocol/narinfo_test.ts` — optional fields, semantic projection, raw serialization, stable union.
- [ ] Extend `tests/integration/operator_config_test.ts` — ordered exact identities, duplicates, local cache URL/auth config, no-side-effect validation.
- [ ] Extend `tests/integration/publication_selection_test.ts` — independent freshness, expiry, withdrawal and immutable ordering.
- [ ] Extend hostile/local Blossom fixture — corrupt local fallback, only-verified PUT, backpressure/cancel, 200/201/error cases, spool lease cleanup.
- [ ] Extend E2E fixture — duplicate compatible Narinfo signatures and conflict winner with correct NAR bytes.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no for public read; conditional for local cache egress | Operator-supplied narrow credential/header provider; no signer construction in Phase 2. `[ASSUMED]` |
| V3 Session Management | no | No user session surface. `[VERIFIED: phase boundary]` |
| V4 Access Control | yes | Exact configured identity authorization before durable/EventStore admission. `[VERIFIED: existing selection boundary]` |
| V5 Input Validation | yes | Project-owned strict identity/Narinfo/URL/descriptor parsers and byte ceilings. `[VERIFIED: project architecture]` |
| V6 Cryptography | yes | Existing Nostr verification, incremental SHA-256, and Ed25519 endorsement classification; never hand-roll crypto. `[VERIFIED: codebase]` |

### Known Threat Patterns for Deno/HTTP/Reactive Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Priority manipulation by relay timing | Tampering | Configured identity array is sole order; immutable request snapshot. `[VERIFIED: locked decision]` |
| Cross-publisher metadata/NAR mix | Tampering | Bounded winner route registry storing exact selected publication/event. `[ASSUMED]` |
| Metadata conflict leaks hostile contents | Information Disclosure | Typed diagnostic includes only codes, identity/event refs and field names. `[VERIFIED: locked decision]` |
| Identity-count resource multiplication | Denial of Service | Bound configured identities; one shared request budget across probes. `[ASSUMED]` |
| Local service SSRF privilege expansion | SSRF / Elevation | Exact configured-origin allowance only; redirect checks remain enabled. `[VERIFIED: existing SafeFetcher policy]` |
| Cache poisoning | Tampering | Expose/populate only after exact SHA-256 verification. `[VERIFIED: NIP.md and VerifiedBlob boundary]` |
| Background upload file race/leak | Denial of Service | Explicit spool lease, cancellation, supervised task, bounded diagnostic. `[VERIFIED: current lifecycle risk]` |

## Sources

### Primary (HIGH confidence)
- Project `AGENTS.md`, `NIP.md`, Phase 2 `CONTEXT.md`, requirements, roadmap, Phase 1 verification/summaries, current source/tests — normative decisions and implementation evidence.
- Installed `applesauce-core@6.2.0` source/declarations and `deno.lock` — exact EventStore/model API and lifecycle.
- https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html — official Narinfo fields and repeatable signatures.
- https://github.com/hzrd149/blossom/blob/master/buds/01.md — official BUD-01 retrieval semantics.
- https://github.com/hzrd149/blossom/blob/master/buds/02.md — official BUD-02 upload semantics.

### Secondary (MEDIUM confidence)
- https://github.com/hzrd149/blossom-server — official implementation behavior used as an integration target.

### Tertiary (LOW confidence)
- None. Design judgments not established by sources are explicitly `[ASSUMED]` and listed above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked dependencies and exact installed source inspected.
- Architecture: HIGH — extends verified Phase 1 boundaries and locked Phase 2 decisions; the cross-request route registry remains an assumption needing planner confirmation.
- Pitfalls: HIGH — most arise directly from current types/lifecycles; local corruption recovery policy remains assumed.

**Research date:** 2026-08-12
**Valid until:** 2026-09-11 for codebase design; re-check Blossom drafts before implementation.
