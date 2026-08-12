# Phase 3: Signer-Gated Writable Cache - Research

**Researched:** 2026-08-12
**Domain:** signer capability lifecycle, streamed Nix binary-cache ingestion, dependency-closed overlay state, and deterministic BUD-16/17/18 tree construction
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Signer Capability and Ownership
- Put Applesauce `ISigner` behind a daemon-owned lifecycle exposing disconnected, connecting, ready, and failed states without replaying key material.
- Support `NostrConnectSigner` with explicit pool methods/headless auth and `PrivateKeySigner` through a narrow protected-key provider; zero owned key buffers where practical and document process-memory exposure.
- Derive the signer pubkey before enabling writes and require it to exactly own the configured raw `17091` or `37091` identity.
- Keep HTTP PUT unavailable (`405` plus no advertised capability) unless signer ownership, writable identity, staging storage, and required future publication destinations are all ready.

### Streamed Upload and Durable Staging
- Accept only stock Nix binary-cache PUT paths required for `.narinfo` and referenced NAR content; reject unknown paths and unbounded metadata before side effects.
- Stream request bodies into owner-only temporary files while hashing and enforcing configured per-body and aggregate staging ceilings; never call whole-body helpers.
- Atomically promote verified complete staging files and store small metadata/state transactionally in SQLite; identical hash/content repeats return idempotent success.
- Conflicting content for the same immutable address fails closed and remains observable without replacing committed data.

### Eligibility and Signer Overlay
- Parse staged Narinfo strictly and make an object eligible only when its referenced NAR and every declared store-path reference resolve from the candidate overlay plus committed lower layers.
- Incomplete/cyclic/unresolved candidates remain staged but invisible; recompute affected eligibility reactively when dependencies arrive.
- Commit a dependency-closed overlay snapshot atomically and place it above every publisher layer in the merged read view.
- Readers capture immutable snapshots, so a batch build or later staging mutation cannot disturb in-flight reads.

### Batch Scheduling and Tree Construction
- Debounce from the first new eligible write with five seconds of quiet and cap sustained activity at sixty seconds; use one serialized batch worker and deterministic fake-clock tests.
- Freeze a dependency-closed set plus its base committed root before building; writes arriving after freeze belong to the next batch.
- Build canonical plaintext BUD-16/17/18 manifests with deterministic ordering and persistent copy-on-write reuse of unchanged verified blobs.
- Store the candidate root and reachable blob inventory durably as pending publication state, but do not expose it as committed or sign/publish it until Phase 4's completeness barrier succeeds.

### the agent's Discretion
- Exact staging schema and module names, provided transactions and immutable boundaries remain explicit.
- Whether eligibility recomputation uses a reverse dependency index or bounded rescans, provided memory/dataset use is bounded and behavior deterministic.
- Tree chunk sizing within the adopted pinned BUD fixtures and configured bounds.

### Deferred Ideas (OUT OF SCOPE)
- Blossom replication, completeness proofs, event signing/publication, retry queues, local relay write-through, and full upload→publish→substitute E2E are Phase 4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WRIT-01 | Configure exactly one writable `17091` or `37091` identity owned by the active signer. | Signer lifecycle performs `getPublicKey()` before ready and exact identity-pubkey comparison. |
| WRIT-02 | Connect NIP-46 or protected local signer behind one capability. | `ISigner` adapter, exact Applesauce 6.2.2 APIs, and protected-key-provider boundary. |
| WRIT-03 | Disable PUT without signer ownership or destinations. | Fail-closed readiness state machine and HTTP capability behavior. |
| WRIT-04 | Stream standard binary-cache PUTs into durable staging idempotently. | Stock Nix path/order evidence and staged-file transaction pattern. |
| WRIT-05 | Require `.narinfo`, its NAR, and all references to resolve. | Persistent dependency graph and fixed-point eligibility algorithm. |
| WRIT-06 | Read complete staged objects from a signer-first overlay only. | Immutable overlay snapshot and merged selection integration. |
| PUBL-01 | Freeze one serialized batch at 5s quiet or 60s sustained activity. | First-event deadline plus resettable quiet timer and single worker. |
| PUBL-02 | Build deterministic plaintext BUD-16/17/18 copy-on-write tree. | Pinned canonical encoding constants, bottom-up COW algorithm, and durable pending candidate. |
</phase_requirements>

## Summary

Phase 3 should be planned as three explicit durable boundaries: **staged bytes**, **committed signer overlay**, and **pending publication candidate**. A successful PUT only establishes staged immutable content. Eligibility commits a dependency-closed immutable overlay that readers may see. A batch build creates a separate pending root and reachable-blob inventory that readers must not see until Phase 4 proves availability and publishes it. Mixing these states would either expose incomplete objects or accidentally make an unreplicated root authoritative. [VERIFIED: `03-CONTEXT.md`, `NIP.md`, and Nix 2.35.1 source]

Stock Nix uploads the NAR path before its `.narinfo`, and its multi-path graph delays each `.narinfo` until that path's NAR and in-batch reference `.narinfo` uploads complete. The daemon must nevertheless tolerate either arrival order and restarts: both paths stage independently, while eligibility is derived transactionally from durable facts rather than request order. [VERIFIED: Nix 2.35.1 `binary-cache-store.cc`]

The signer is a control-plane capability, not the byte transport. `NostrConnectSigner.open()`, `connect()`/`waitForSigner()`, `getPublicKey()`, and `close()` provide the remote lifecycle; `PrivateKeySigner.fromKey()` and `getPublicKey()` provide the local implementation. Do not call `signEvent()` in this phase. [VERIFIED: installed `applesauce-signers@6.2.2` declarations and official README]

**Primary recommendation:** Plan signer readiness, staging/eligibility, immutable overlay, scheduler, and writer as separately testable modules joined by commit-before-emission transactions; persist the built root as `pending`, never as the committed read root. [VERIFIED: codebase transaction and snapshot patterns]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Signer connection and ownership | API / Backend | External NIP-46 relays | Daemon owns lifecycle and gates capability; signer only supplies identity/signature operations. |
| PUT admission and streaming | API / Backend | Database / Storage | HTTP validates routes/readiness; storage owns temp files, hashing, quotas, and atomic promotion. |
| Eligibility graph | API / Backend | Database / Storage | Domain logic computes closure from durable staged and lower-layer facts. |
| Signer overlay | API / Backend | Database / Storage | Resolver consumes an immutable snapshot; SQLite records its durable membership. |
| Batch timing | API / Backend | — | RxJS/control-plane signals trigger one serialized freeze/build worker. |
| Hashtree construction | Database / Storage | API / Backend | Writer builds immutable blobs and inventory from a frozen input snapshot. |
| Phase 4 publication | External Nostr/Blossom services | API / Backend | Explicitly out of scope here. |

[VERIFIED: current `src/runtime/daemon.ts`, `src/nix/http_handler.ts`, `src/persistence/state_repository.ts`]

## Project Constraints (from AGENTS.md)

- Treat `NIP.md` as normative; do not weaken its MUST/MUST NOT requirements. [VERIFIED: `AGENTS.md`]
- Keep Deno/TypeScript and Applesauce reactive store/observable composition. [VERIFIED: `AGENTS.md`]
- Byte paths must use Web Streams with backpressure; no whole-file or whole-dataset buffering. [VERIFIED: `AGENTS.md`]
- Bound all attacker-controlled resource dimensions and keep publisher/transport data untrusted until verified. [VERIFIED: `AGENTS.md`]
- PUT exists only with a connected signer that owns the configured identity. [VERIFIED: `AGENTS.md`]
- Preserve subsystem boundaries for a later shared gateway, while optimizing v1 for one local user. [VERIFIED: `AGENTS.md`]
- Use GSD workflow artifacts for edits; this research is produced within the requested phase-planning workflow. [VERIFIED: `AGENTS.md`]
- No project-specific skills exist. [VERIFIED: project skill discovery]

## Standard Stack

### Core

| Library/API | Version | Purpose | Prescriptive Use |
|-------------|---------|---------|------------------|
| Deno / TypeScript | installed `2.9.4` / `6.0.3` | HTTP, Web Streams, owner-only filesystem operations, tests | Use current repository runtime; note AGENTS' desired `2.9.5` pin mismatch in planning. [VERIFIED: local commands] |
| `applesauce-signers` | `6.2.2` | `ISigner`, NIP-46, local key signer | Add exact npm import; gate installation because legitimacy seam returned `SUS` solely for missing registry repository metadata. [VERIFIED: npm registry + official Applesauce repository/docs] |
| RxJS | `7.8.2` | readiness/eligibility signals and deterministic scheduling | Already pinned; inject a `SchedulerLike` or clock/timer seam. Never carry byte chunks in Observables. [VERIFIED: `deno.json`, installed RxJS source] |
| Web Streams | Deno built-in | request-body backpressure and incremental staging | Read `Request.body`; write chunks directly to a temp file while updating incremental SHA-256 and quota counters. [VERIFIED: current BlobFetcher pattern] |
| `node:sqlite` | Deno built-in compatibility | durable staging metadata, graph, overlay, batch, candidate inventory | Extend the existing `StateRepository` database or add a repository sharing the same database/transaction owner. [VERIFIED: current `StateRepository`] |
| `@msgpack/msgpack` | `3.1.3` | canonical BUD manifest bytes | Already pinned and used by strict decoder; add a project-owned canonical encoder verified against pinned vectors. [VERIFIED: `deno.json`, BUD fixtures] |
| `@noble/hashes` | `2.3.0` | incremental SHA-256 | Reuse streaming `sha256.create().update()` pattern for staged files and immutable blobs. [VERIFIED: `deno.json`, existing BlobFetcher] |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| Existing `parseNarInfo` | Strict bounded Narinfo semantic parsing | Only after metadata body is spooled within the metadata ceiling; materialize the bounded text, then parse. [VERIFIED: `src/protocol/narinfo.ts`] |
| Existing `MergedSelectionSnapshot` / resolver seams | Immutable reader capture and lower-layer resolution | Extend to a signer-first layer without mutating captured publisher arrays. [VERIFIED: Phase 2 code/tests] |
| Deno `FakeTime` or injected timer functions | deterministic 5s/60s scheduler tests | Prefer the repository's existing injected `schedule`/`cancelSchedule` pattern if avoiding another dependency. [VERIFIED: `src/nostr/selection.ts`] |

**Installation:**

```json
"applesauce-signers": "npm:applesauce-signers@6.2.2"
```

Package publish/version checks were run on 2026-08-12. `applesauce-signers@6.2.2` was published 2026-07-01; `rxjs@7.8.2` was published 2025-02-22. Neither declares a postinstall script. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `applesauce-signers@6.2.2` | npm | ~6 weeks | 1,001/week | Official `hzrd149/applesauce` monorepo, but missing from npm metadata | SUS | Flagged — planner must add `checkpoint:human-verify` before first import/install. |
| `rxjs@7.8.2` | npm | ~18 months | ~100M/week | `ReactiveX/rxjs` | OK | Approved; already installed. |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** `applesauce-signers` (the authoritative official monorepo and docs corroborate the package, but the mandatory seam flags absent registry repository metadata). [VERIFIED: package-legitimacy seam and official Applesauce README]

## Exact Signer APIs and Lifecycle

Define a project-owned interface narrower than `ISigner`:

```ts
type SignerState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "ready"; pubkey: string }
  | { status: "failed"; code: string };

interface SignerCapability {
  readonly state$: Observable<SignerState>;
  start(signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  // Phase 4 may add signPublication(template); do not expose the raw key.
}
```

[VERIFIED: `ISigner` common methods in installed Applesauce 6.2.2; state wrapper is project design]

For NIP-46, construct `NostrConnectSigner({ relays, signer: persistentClientSigner, remote?, connectSecret?, bunkerSecret?, subscriptionMethod, publishMethod, onAuth })`. Call `open()` before `connect()`/`waitForSigner()`, then `getPublicKey()`, compare the returned lowercase 64-hex pubkey exactly to `writeIntent.identity.pubkey`, and only then emit `ready`. `close()` is mandatory on failure and shutdown. `onAuth(url)` must log/emit a sanitized actionable status; never call the browser-default handler in the daemon. Request only `NostrConnectSigner.buildSigningPermissions([17091])` or `[37091]` for the configured kind. [VERIFIED: installed `nostr-connect-signer.d.ts` and official Applesauce README]

The NIP-46 client's `PrivateKeySigner` is itself secret session state. Persisting `nbunksec` persists the local client private key, so treat it with the same owner-only/key-provider boundary as a local signing key. Do not put `nbunksec`, bunker secrets, authorization URLs with secrets, or raw errors into replayed state/diagnostics. [VERIFIED: official Applesauce README and installed `Nbunksec` declaration]

For local signing, a `ProtectedKeyProvider` should return one owned `Uint8Array` for the narrow activation scope. Create `PrivateKeySigner.fromKey(key)`, immediately zero the provider-owned source buffer in `finally`, derive `getPublicKey()`, and retain/close the signer only for the enabled lifecycle. Applesauce copies/retains key material in its public `key` field, so zeroing the input is not complete process-memory isolation; document that limitation and do not claim hardware-grade protection. [VERIFIED: installed `private-key-signer.js/.d.ts`]

Readiness is the conjunction `signerReady && ownsIdentity && stagingWritable && destinationsConfigured`. A configured signer that is connecting, failed, mismatched, or lacks future destinations yields the exact same HTTP surface as disabled writes: non-GET/HEAD responses remain `405` and `Allow` must omit PUT. [VERIFIED: locked context and current handler]

## Architecture Patterns

### System Architecture Diagram

```text
environment/config
      |
      v
SignerLifecycle ---- getPublicKey ----> exact identity ownership?
      |                                      |
      | ready                                | no -> read-only HTTP (405)
      v                                      v
WriteReadiness <---- staging/destination readiness
      |
HTTP PUT (.narinfo or nar/*)
      |
route + size precheck -> owner-only temp -> stream + hash + quota
      |                                      |
      | failure -> delete temp/diagnostic    v
      +------------------------------> atomic staged blob + SQLite fact
                                               |
                                    eligibility fixed point
                                   / unresolved | eligible
                                  v             v
                             staged only   atomic signer overlay snapshot
                                                   |
                                        signer-first GET/HEAD view
                                                   |
                               5s quiet OR 60s max scheduler
                                                   |
                                 freeze overlay generation + base root
                                                   |
                                   deterministic COW BUD writer
                                                   |
                                  pending candidate + blob inventory
                                                   |
                                     Phase 4 completeness barrier
```

### Recommended Project Structure

```text
src/
├── signer/lifecycle.ts          # common state machine and ownership gate
├── signer/nip46.ts              # Applesauce pool methods + headless auth
├── signer/key_provider.ts       # protected local/session secret boundary
├── writable/staging.ts          # streamed temp/promote/quota repository
├── writable/eligibility.ts      # reverse dependency graph/fixed point
├── writable/overlay.ts          # immutable committed signer layer
├── writable/scheduler.ts        # 5s quiet / 60s max / serialized freeze
├── hashtree/writer.ts           # canonical plaintext COW builder
└── persistence/state_repository.ts # schema/transactions/pending candidate
tests/
├── integration/signer_lifecycle_test.ts
├── integration/writable_cache_test.ts
├── integration/writable_scheduler_test.ts
└── protocol/hashtree_writer_test.ts
```

### Pattern 1: Commit Before Reactive Emission

Every staging promotion, eligibility change, overlay generation, frozen batch, and pending candidate is written in one `BEGIN IMMEDIATE` transaction. Only after `COMMIT` does the repository emit an immutable value through RxJS. This extends the already-established publication-selection pattern and makes restart recovery equivalent to live state. [VERIFIED: current `StateRepository` and Phase 1/2 decisions]

### Pattern 2: Durable Reverse Dependency Index

Use a reverse index rather than rescanning the entire dataset: normalize each Narinfo reference to its full `/nix/store/<base>` key, persist `(candidate_store_path, reference_store_path)`, and enqueue dependents when a referenced path becomes resolvable. Eligibility is a monotone fixed point within an overlay generation: an object enters only if its Narinfo and exact NAR URL are staged/committed and all non-self references resolve from eligible candidate rows or a frozen lower-layer snapshot. Cycles without an already-resolved external anchor remain ineligible. [VERIFIED: Nix source closure graph and locked context; schema is recommended design]

### Pattern 3: Immutable Overlay Generations

Represent the signer layer as `{generation, entries}` and replace the whole frozen map/reference atomically. `selection.current()` should return `[signerLayer, ...publisherLayers]` captured once at request entry. Keep winner-pinned NAR routing: a Narinfo served from the signer layer pins its `URL` to that same immutable generation. [VERIFIED: current handler capture and `WinnerRouteRegistry`; extension is recommended design]

### Pattern 4: Two Timers From First Dirty Event

On transition clean→dirty, record `openedAt`, schedule `maxAt = openedAt + 60s`, and schedule/reset `quietAt = lastEligibleAt + 5s`. Fire at `min(quietAt, maxAt)`; clear both handles before enqueueing a freeze. A single promise chain or `concatMap` serializes freeze/build jobs. Events arriving after the durable freeze generation are assigned to the next window even while the worker runs. Do not implement only `debounceTime(5000)`, because sustained writes can postpone forever; do not merge independent debounce/audit streams without a generation guard, because both may fire the same batch. [VERIFIED: RxJS 7.8 timer/operator semantics; timing algorithm is project design]

### Pattern 5: Bottom-Up Content-Addressed Copy-on-Write

Freeze a sorted logical file map (`path -> verified blob/file manifest link`) plus base root. Chunk files at exactly 2,097,152 bytes, group at at most 174 links, encode child nodes before parents, and hash canonical bytes. Sort directory names by ascending UTF-8 bytes; encode root fields `l,t`, link fields `h,k,m,n,s,t`, and metadata keys bytewise, using shortest MessagePack integers and binary types for hashes. Reuse any base link whose logical subtree membership and resulting hash are unchanged; insert only new content-addressed blobs into inventory. [CITED: https://github.com/hzrd149/blossom/blob/1b2f140b0d3fd06a907b159d7628e1d007588da3/buds/16.md] [CITED: https://github.com/hzrd149/blossom/blob/1848f77c4a25b70d10a3963d66ba1c8aba1e4f2c/buds/17.md]

### Anti-Patterns to Avoid

- **Signer object as readiness:** `isConnected` alone does not prove the returned user pubkey owns the configured identity or that staging/destinations work. [VERIFIED: signer declarations and locked context]
- **Whole-body helpers:** `request.arrayBuffer()`, `text()`, `Blob`, and unbounded `Response` materialization violate the data-plane invariant. [VERIFIED: AGENTS.md]
- **Narinfo visibility as upload completion:** stock Nix's ordering is helpful but cannot replace durable dependency checks. [VERIFIED: Nix source]
- **Mutating the Phase 2 publisher snapshot:** prepend a separate immutable signer layer instead. [VERIFIED: current merged read architecture]
- **Publishing/building directly from live rows:** freeze a generation and base root first. [VERIFIED: locked context]
- **Marking pending root committed:** Phase 3 must leave it unpublished and invisible. [VERIFIED: phase boundary]

## Prescriptive Staging Schema

Use explicit tables (names may vary) with foreign keys and unique constraints: [VERIFIED: existing SQLite approach; exact schema is recommended design]

| Table | Required fields / invariant |
|-------|-----------------------------|
| `staged_blob` | `address PRIMARY KEY`, `relative_path UNIQUE`, `sha256`, `size`, `file_path UNIQUE`, `state`, timestamps; committed files only, never temp paths. |
| `staged_narinfo` | `store_path PRIMARY KEY`, `store_hash UNIQUE`, `nar_path`, exact parsed hashes/sizes, `raw_blob_address`, `eligibility_state`, diagnostic code. |
| `staged_reference` | `(store_path, reference_path) PRIMARY KEY`; reverse index on `reference_path`. |
| `overlay_generation` | monotonic `generation PRIMARY KEY`, frozen creation time/state. |
| `overlay_entry` | `(generation, cache_path) PRIMARY KEY`, blob/link address; immutable after generation commit. |
| `publication_batch` | `batch_id`, frozen generation, base root, state=`building|pending|failed`, opened/frozen timestamps. |
| `candidate_blob` | `(batch_id, sha256) PRIMARY KEY`, file path/size and `reused` flag. |
| `pending_candidate` | singleton per writable identity: batch id, root hash, canonical `nhash`, inventory count/bytes, state=`pending`; Phase 4 claims it. |

Temp files live under an owner-only staging directory, use unpredictable names, are opened create-new, flushed/synced before rename, and are renamed only within the same filesystem. Startup removes orphan temps but never committed hash-addressed files; aggregate quota is computed from durable committed/staged rows plus reserved in-flight bytes under one quota manager. [VERIFIED: current owner-only spool pattern; atomicity design follows Deno filesystem semantics]

For route validation, accept only `/<32-nix-base32>.narinfo` and the exact relative `URL` forms that strict Narinfo parsing permits and that stock Nix actually PUTs (normally `/nar/<nix32-sha256>.nar` with compression suffix). Reject query/fragment traversal, decoded separators, unknown metadata routes, and `.narinfo` whose store hash does not match the route. NAR promotion verifies actual bytes against the Narinfo's `FileHash` and `FileSize`; until the Narinfo arrives, the NAR remains a staged blob keyed by route/hash. [VERIFIED: Nix 2.35.1 source and current `parseNarInfo`; exact cross-check is recommended]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nostr signing primitives | Schnorr/event-ID code | Applesauce `ISigner` implementations | Required stack and exact event verification/signing contract. [VERIFIED: official Applesauce docs] |
| NIP-46 transport protocol | Custom request/response crypto | `NostrConnectSigner` with explicit relay methods | It already owns open/close, request correlation, auth, connect, and pubkey methods. [VERIFIED: installed declarations] |
| Byte hashing | Buffer-then-WebCrypto digest | incremental `@noble/hashes` | Existing bounded spool pattern already proves it. [VERIFIED: codebase] |
| Narinfo parser | Permissive line splitting | existing `parseNarInfo` plus route/hash checks | Existing codec rejects duplicates, malformed required fields, unsafe URL/reference forms. [VERIFIED: codebase] |
| Manifest serialization | Generic object encode with incidental key order | project canonical writer locked to BUD vectors | Root/link/metadata order and integer encoding determine hashes. [CITED: pinned BUD-16/17] |
| Publication in Phase 3 | Partial event builder/network calls | durable `pending_candidate` contract | Completeness and relay acknowledgement belong to Phase 4. [VERIFIED: phase context] |

## Common Pitfalls

### Pitfall 1: Secret Material Leaks Through Reactive State
**What goes wrong:** replay subjects, diagnostics, serialized errors, or `nbunksec` expose private client/local keys.  
**How to avoid:** state carries only status, sanitized code, and derived public key; key providers own zeroizable buffers; logs never include auth URLs or secret-bearing URIs.  
**Warning signs:** `PrivateKeySigner`, `key`, `nbunksec`, `bunkerSecret`, or raw exception objects appear in state rows/log calls. [VERIFIED: installed signer API]

### Pitfall 2: PUT Becomes Available Too Early
**What goes wrong:** a connected signer with wrong pubkey or missing destinations accepts irreversible staged work.  
**How to avoid:** compute one conjunctive readiness snapshot before routing; transition to read-only immediately on disconnect/failure.  
**Warning signs:** handler checks only `writeIntent.mode`, or advertises `Allow: PUT` before ownership. [VERIFIED: locked context]

### Pitfall 3: Quota Race
**What goes wrong:** concurrent Content-Length-valid requests collectively exceed aggregate staging capacity.  
**How to avoid:** reserve declared/maximum bytes atomically before file creation, debit actual chunks, release unused reservation on terminal state, and reject chunked bodies once the per-body cap is exceeded. [VERIFIED: AGENTS resource requirements; algorithm is project design]

### Pitfall 4: Filename Hash Is Trusted
**What goes wrong:** conflicting bytes replace immutable content or a Narinfo points to a mismatched NAR.  
**How to avoid:** compute digest during spool, compare canonical expected hashes/sizes, use create-new/compare-existing promotion, and surface conflict without replacement. [VERIFIED: locked context]

### Pitfall 5: Cyclic Closure Enters Overlay
**What goes wrong:** mutually-referencing staged Narinfos are treated as complete merely because both rows exist.  
**How to avoid:** seed fixed point only from objects whose references resolve in committed lower layers or already-eligible candidate objects; an unanchored SCC never enters. [VERIFIED: closure requirement; graph treatment is recommended]

### Pitfall 6: Duplicate Scheduler Fires
**What goes wrong:** quiet and max timers both enqueue the same generation or an old timer freezes new writes.  
**How to avoid:** persist/compare a monotonically increasing window token; atomically claim a dirty generation once; cancel both timers on claim. [VERIFIED: locked timing; generation guard is recommended]

### Pitfall 7: Noncanonical Writer Produces Unreadable Roots
**What goes wrong:** generic MessagePack map ordering, wrong chunk size, or >174 links changes hashes/violates pinned readers.  
**How to avoid:** golden encode/decode/hash tests for every pinned vector, boundary tests at chunk/link thresholds, and build-twice equality tests. [CITED: pinned BUD-16/17]

### Pitfall 8: Pending Candidate Is Mistaken for Committed Read State
**What goes wrong:** local reads succeed for a tree that no advertised server can traverse after restart.  
**How to avoid:** distinct schema types/tables and APIs: `loadCommittedOverlay()` never reads `pending_candidate`; Phase 4 alone transitions pending to committed after its barrier. [VERIFIED: locked phase boundary]

## Code Examples

### Exact ownership check

```ts
// Source: applesauce-signers 6.2.2 declarations + project identity type
const pubkey = await signer.getPublicKey();
if (!/^[0-9a-f]{64}$/.test(pubkey) || pubkey !== intent.identity.pubkey) {
  throw new SignerCapabilityError("identity-owner-mismatch");
}
```

### Serialized freeze boundary

```ts
// Source: recommended project pattern; timers are injected for fake-clock tests
async function fire(token: number) {
  if (token !== activeToken || workerRunning) return;
  const frozen = repository.claimEligibleGeneration(token); // durable transaction
  workerRunning = true;
  try {
    await writer.buildPendingCandidate(frozen);
  } finally {
    workerRunning = false;
    scheduleNextWindowIfDirty();
  }
}
```

### Canonical directory preparation

```ts
// Source: pinned BUD-16 revision
const links = entries.toSorted((a, b) => compareUtf8(a.name, b.name));
const wire = encodeCanonicalManifest({ l: links.map(toBudLink), t: 2 });
const root = sha256(wire);
```

## State of the Art

| Old/unsafe approach | Current required approach | Impact |
|---------------------|---------------------------|--------|
| `SimpleSigner` | `PrivateKeySigner` | `SimpleSigner` is deprecated in installed 6.2.2. [VERIFIED: declaration] |
| NIP-46 browser default auth | explicit headless `onAuth` and pool methods | Prevents daemon attempts to open `window`. [VERIFIED: official signer docs/source] |
| BUD-17 legacy named `_chunk_*` directory fanout | node type `3`, unnamed links with `count/first/last` | New writer MUST produce type 3; reader compatibility may remain. [CITED: pinned BUD-17] |
| Bare 32-byte `nhash` | strict TLV type 0 (and no type 5 in v1) | Project NIP rejects legacy bare payloads and self-encrypted roots. [VERIFIED: `NIP.md`] |
| Metadata upload without compression | Nix 2.32+ may send `Content-Encoding` for `.narinfo` | Either explicitly reject non-identity metadata encoding with a clear compatibility constraint or add bounded streaming decompression; test installed Nix 2.35.1. [CITED: https://nix.dev/manual/nix/2.33/release-notes/rl-2.32.html] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | None. All prescriptive project designs are labeled as recommendations derived from locked constraints rather than external factual claims. | — | — |

## Open Questions

1. **Protected secret source configuration**
   - What we know: `writeIntent` currently records only mode and identity; no local-key path, bunker URI/session, auth output, or destination list fields exist. [VERIFIED: config grep]
   - What's unclear: the operator-facing secret provider (permission-restricted file, command, OS keyring) and NIP-46 session persistence format.
   - Recommendation: planner adds a Wave 0 configuration contract decision/checkpoint; never infer secrets from general environment variables.

2. **Metadata Content-Encoding compatibility**
   - What we know: Nix 2.32 introduced optional compressed `.narinfo` uploads, controlled by `narinfo-compression`; installed Nix is 2.35.1. [CITED: Nix release notes] [VERIFIED: local version]
   - What's unclear: whether Phase 3 must accept those optional encodings in v1.
   - Recommendation: default E2E uses identity encoding; either explicitly reject encoded metadata or implement bounded streaming decompression with an output ceiling and tests.

3. **Destination readiness source**
   - What we know: Phase 3 must require future publication destinations but must not upload; current config has relay URLs and optional Blossom URLs/BUD-03 discovery. [VERIFIED: context/config]
   - What's unclear: whether readiness requires at least one configured/BUD-03 Blossom destination in addition to relay URLs.
   - Recommendation: define a `PublicationDestinationsSnapshot` interface now, supplied by Phase 1's BUD-03 model, and gate PUT on at least one eligible Blossom destination plus publish relays without doing network writes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Deno | implementation/tests | ✓ | 2.9.4 | Pin/upgrade to AGENTS target 2.9.5 in CI. |
| TypeScript | type checking | ✓ | 6.0.3 | bundled with Deno |
| Nix CLI | stock upload integration | ✓ | 2.35.1 | in-process raw PUT fixture for fast tests |
| npm registry/network | signer verification | ✓ | package queried | committed lock/cache after install |
| SQLite | durable state | ✓ | `node:sqlite` used by project | none needed |

**Missing dependencies with no fallback:** none.  
**Missing dependencies with fallback:** `applesauce-signers` is present in Deno's npm cache but not imported by `deno.json`; add it only after the mandatory human legitimacy checkpoint. [VERIFIED: local filesystem/config]

## Validation Architecture

Skipped because `.planning/config.json` explicitly sets `workflow.nyquist_validation` to `false`. [VERIFIED: config]

The planner should still require these proportional verification tasks: signer lifecycle unit/integration tests; raw and stock-Nix PUT integration tests; restart and quota tests; dependency graph/cycle tests; immutable in-flight snapshot tests; deterministic fake-clock scheduler tests; pinned writer vectors; build-twice/restart equality; and an assertion that no Phase 3 code invokes `signEvent`, Blossom upload, or relay publish. [VERIFIED: phase success criteria and security enforcement]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | signer-derived public key and exact writable-identity ownership; fail closed |
| V3 Session Management | yes | NIP-46 client/session secret lifecycle, abort, close, and sanitized auth status |
| V4 Access Control | yes | PUT unavailable unless the full readiness capability is ready; one owned identity only |
| V5 Input Validation | yes | exact path regex, bounded headers/body, strict Narinfo/parser/hash/reference validation |
| V6 Cryptography | yes | Applesauce signing APIs and noble incremental SHA-256; never custom Schnorr/hash code |

[VERIFIED: OWASP ASVS category applicability mapped to locked phase threats]

### Known Threat Patterns for Deno/HTTP/Signer Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized PUT during signer transition | Elevation of privilege | atomic readiness snapshot and 405 fail-closed route |
| Key/session leakage through logs/state | Information disclosure | status-only state, sanitized errors, owner-only provider/session storage |
| Symlink/path traversal in staging | Tampering | fixed root, generated temp names, create-new, no user-derived filesystem path |
| Concurrent quota exhaustion | Denial of service | atomic reservations plus per-chunk and aggregate ceilings |
| Immutable-address collision/conflict | Tampering | digest/size comparison, never replace committed bytes, observable diagnostic |
| Malformed/compression-bomb metadata | Denial of service | wire and decoded ceilings; bounded streaming decompression or explicit rejection |
| Dependency cycle/incomplete closure | Tampering | monotone fixed-point eligibility; staged-but-invisible unresolved SCCs |
| TOCTOU between build and new writes | Tampering | durable generation freeze and immutable base root |
| Candidate exposed before replication | Spoofing/availability | type/schema separation; only Phase 4 barrier may commit/publish |

## Sources

### Primary (HIGH confidence)

- Repository `AGENTS.md`, `NIP.md`, Phase 3 context/requirements, Phase 1/2 summaries and verification, current `src/` and `tests/` — constraints and integration seams.
- Installed `applesauce-signers@6.2.2` declarations, implementation, and official README — exact APIs and secret behavior.
- [Official Applesauce signer documentation](https://applesauce.build/signers/nostr-connect.html) — NIP-46 integration.
- [Nix 2.35 HTTP binary-cache source](https://github.com/NixOS/nix/blob/2.35.1/src/libstore/http-binary-cache-store.cc) and [binary-cache source](https://github.com/NixOS/nix/blob/2.35.1/src/libstore/binary-cache-store.cc) — PUT method/path/order and closure graph.
- [Pinned BUD-16](https://github.com/hzrd149/blossom/blob/1b2f140b0d3fd06a907b159d7628e1d007588da3/buds/16.md), [BUD-17](https://github.com/hzrd149/blossom/blob/1848f77c4a25b70d10a3963d66ba1c8aba1e4f2c/buds/17.md), and [BUD-18](https://github.com/hzrd149/blossom/blob/018f3e32227cf8fd1fba8dff2d39d6e3370d2d52/buds/18.md) — canonical manifests and immutable roots.
- [Nix binary-cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [HTTP store](https://nix.dev/manual/nix/2.35/store/types/http-binary-cache-store.html) — client-facing layout/configuration.

### Secondary (MEDIUM confidence)

- npm registry metadata and GSD package-legitimacy seam — package versions, publish dates, downloads, missing repository signal.
- Installed RxJS 7.8.2 source — timer, debounce/audit, serialization primitives.

### Tertiary (LOW confidence)

- None used for implementation claims.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — exact repository pins, installed artifacts, official source, and registry checked.
- Architecture: HIGH — derived from locked context and verified existing transaction/snapshot seams.
- Signer lifecycle: HIGH — exact 6.2.2 declarations and implementation inspected.
- Stock Nix upload behavior: HIGH — installed version plus official 2.35.1 source inspected.
- BUD writer: HIGH — project-pinned proposal revisions and vectors inspected.
- Pitfalls/security: HIGH — directly derived from explicit threat constraints and concrete APIs.

**Research date:** 2026-08-12  
**Valid until:** 2026-09-11 for the pinned implementation; re-check Applesauce/BUD revisions before execution if pins change.
