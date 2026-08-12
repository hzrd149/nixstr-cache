# Architecture Research

**Domain:** Reactive Nostr/Blossom Hashtree gateway and transactional Nix binary-cache writer
**Researched:** 2026-08-12
**Confidence:** MEDIUM-HIGH — the Nix, Nostr, Blossom BUD-01/BUD-03, Deno, and Applesauce foundations are current primary sources; BUD-15 through BUD-18 remain proposed specifications, so their exact codecs need phase-specific verification against the pinned drafts.

## Standard Architecture

### System Overview

Use a modular monolith with two deliberately different execution planes. The **control plane** is reactive: relay events enter Applesauce, typed casts validate them, and observable selectors emit immutable cache snapshots. The **data plane** is pull-driven and streaming: an HTTP request or publication job resolves one captured snapshot and walks only the needed Hashtree paths with explicit budgets and backpressure. Do not make large blob streams themselves observable application state.

```text
┌────────────────────────────── Control plane ──────────────────────────────┐
│ RelayPool → verified EventStore → NixCacheEvent cast/model → selector$   │
│      │             │                  │                       │           │
│      └─ NIP-65 / BUD-03 server state  └─ policy + checkpoints ┘           │
│                                                   │                       │
│                                      Atomic MergedCacheSnapshot          │
└───────────────────────────────────────────────────┼───────────────────────┘
                                                    │ capture per operation
┌─────────────────────────────── Data plane ─────────▼──────────────────────┐
│ Deno HTTP router → merged resolver → bounded Hashtree reader → blob I/O  │
│ GET/HEAD           narinfo policy      verify/decrypt/decode     sources  │
│                                                                          │
│ PUT → staging CAS → pending index → tree builder → publication coordinator│
│                                              ├─ replicate complete tree   │
│                                              ├─ sign + relay publish       │
│                                              └─ commit root/checkpoint     │
└──────────────────────────────────────────────────────────────────────────┘
                         │                         │
                 durable metadata/checkpoints   optional protocol caches
                 (small local database)          (relay + Blossom)
```

### Component Responsibilities

| Component | Responsibility | Recommended implementation |
|-----------|----------------|----------------------------|
| `NostrIngress` | Maintain bounded relay subscriptions for kinds 17091, 37091, 10002, and 10063; verify signatures before insertion | Applesauce `RelayPool` observables piped through event-only and verification operators into one `EventStore` |
| `NixCacheEventCast` | Turn raw events into immutable, typed publication candidates; enforce all NIP validation without network I/O | Custom Applesauce `EventCast`/cast constructor plus pure parsers for identity, `nhash`, keys, expiration, and Blossom hints |
| `CacheSelector` | Apply whitelist, replaceable/addressable ordering, expiration, future-time, rollback, and signed-to-unsigned downgrade policy | RxJS composition over EventStore models; emits `SelectedCacheState` per configured identity |
| `MergedView` | Produce one versioned priority list, writable overlay first; resolve paths and compatible `.narinfo` signatures deterministically | `combineLatest`/pure reducer producing an immutable `MergedCacheSnapshot`; atomic reference swap on emission |
| `BlobSourceResolver` | Build the bounded ordered source set: event hints, BUD-03, local cache, configured mirrors | Pure policy returning source descriptors; maximum attempts fixed by configuration |
| `SafeFetcher` | Enforce scheme, DNS/IP policy, redirect revalidation, timeouts, length bounds, and cancellation | One outbound HTTP boundary using `fetch(..., {redirect: "manual", signal})`; no other module fetches publisher URLs |
| `VerifiedBlobStore` | Stream bytes, hash ciphertext/address bytes, optionally decrypt, hash plaintext content key, and expose only verified results | Web Streams pipeline backed by temporary files or a local Blossom service; atomic promote after verification |
| `HashtreeReader` | Resolve a path or enumerate a tree while bounding manifests, depth, links, unique node hashes, and decoded bytes | Async iterators with a request/job-local budget ledger and visited-hash set; iterative traversal, not recursion |
| `NixRecordPolicy` | Parse `.narinfo`, verify/filter `Sig` against event-declared key bytes, compare records, and merge only compatible signatures | Pure canonical domain model retaining raw non-`Sig` fields and separately verified signatures |
| `HttpGateway` | Serve `nix-cache-info`, `.narinfo`, referenced NAR URLs, GET/HEAD, health, readiness, and metrics | `Deno.serve`; `Response` bodies are `ReadableStream<Uint8Array>` and HEAD follows the same resolution path without a body |
| `WriteIngress` | Authorize one configured identity and stream PUT bodies to staging without publishing partial objects | Route guard + streamed CAS ingestion + content/path validation; durable staging receipt returned only after fsync/commit semantics |
| `PendingIndex` | Track staged binary-cache paths, dependency edges, completeness, and the base root revision | Durable small records keyed by logical path; serialized mutation per writable identity |
| `TreeBuilder` | Copy-on-write Hashtree mutation with deterministic encoding; emit root and complete reachable blob set | Bottom-up immutable manifest construction; manifests/chunks streamed to CAS as produced |
| `PublicationCoordinator` | Debounce 5 seconds, cap at 60, freeze a batch, prove at least one advertised server complete, sign, publish, and commit | Recoverable state machine with a single writer lease; explicit phases and idempotency keys |
| `SignerPort` | Hide NIP-46 and protected local-key differences; expose availability, pubkey, and signing only | Minimal `EventSigner`-compatible port; signer connection state is observable, key material never enters domain records |
| `CheckpointStore` | Persist greatest accepted time, signed-history bit, selected event/root, pending batch, publication state, and replication debt | SQLite/KV-style transactional metadata store; never store unbounded blob bodies in rows |

## Recommended Project Structure

```text
src/
├── app/                    # composition root, lifecycle, config, shutdown
├── nostr/
│   ├── ingress.ts          # RelayPool subscriptions → EventStore
│   ├── cache_event_cast.ts # custom typed cast and strict NIP validation
│   ├── selection.ts        # identity, freshness, expiration, downgrade
│   └── signer.ts           # SignerPort adapters and signer state
├── state/
│   ├── cache_state.ts      # selected-cache observables
│   ├── merged_view.ts      # immutable snapshot construction
│   └── checkpoints.ts      # durable monotonic policy state
├── hashtree/
│   ├── codec/              # pinned BUD-15/16/17/18 codecs
│   ├── reader.ts           # bounded path lookup and traversal
│   ├── writer.ts           # copy-on-write manifest construction
│   └── budget.ts           # shared limit ledger
├── blossom/
│   ├── sources.ts          # ordered source discovery
│   ├── safe_fetch.ts       # sole SSRF/redirect-aware outbound boundary
│   ├── verified_blobs.ts   # streaming verify/decrypt/promote
│   └── replication.ts      # upload, HEAD verification, retry debt
├── nix/
│   ├── paths.ts            # strict binary-cache path grammar
│   ├── narinfo.ts          # parse, compare, verify/filter/merge Sig
│   └── cache_info.ts       # stable nix-cache-info generation
├── gateway/
│   ├── router.ts           # GET/HEAD/PUT and operational endpoints
│   ├── reads.ts            # snapshot-scoped merged resolution
│   └── writes.ts           # authorized streamed PUT ingestion
├── publication/
│   ├── pending.ts          # dependency graph and batch journal
│   ├── scheduler.ts        # 5s quiet / 60s maximum window
│   └── transaction.ts      # recoverable publication state machine
├── persistence/            # metadata DB and staging/CAS interfaces
├── observability/          # structured logs, metrics, health/readiness
└── testing/                # protocol fixtures and local service harnesses
```

### Structure Rationale

- **`nostr/` and `state/`:** isolates Applesauce/RxJS mechanics from protocol policy. A cast makes a raw event convenient and typed; acceptance still depends on durable freshness and downgrade state.
- **`hashtree/` and `blossom/`:** separates authenticated structure from untrusted transport. The reader requests hashes; the blob layer decides where bytes come from and returns only verified content.
- **`gateway/` and `publication/`:** reading is snapshot-consistent and concurrent, while writing is a serialized, journaled transaction. Combining them would make unpublished staging state leak into reads.
- **`persistence/`:** domain modules depend on narrow repositories, allowing a local metadata database and optional protocol-native caches without making either part of Hashtree semantics.

## Architectural Patterns

### Pattern 1: Typed Casts at the Nostr Boundary

**What:** Insert signature-verified events into one Applesauce EventStore, then cast publication events into a domain object exposing parsed identity, root reference, declared key bytes, valid source hints, and expiration. Compose selected state with observables; keep the cast pure and synchronous.

**When to use:** Every relay candidate and locally published event.

**Trade-offs:** Casts eliminate repeated tag parsing and fit Applesauce's reactive graph. A project-specific kind has no ready-made cast, and hiding policy inside getters would make validation order and tests opaque.

```typescript
class NixCachePublication extends EventCast {
  readonly parsed = parseAndValidatePublication(this.event); // pure, throws typed error
  get identity(): CacheIdentity { return this.parsed.identity; }
  get root(): ImmutableRootRef { return this.parsed.root; }
}

const selectedCaches$ = candidates$.pipe(
  map((events) => selectAcceptable(events, durablePolicySnapshot)),
  distinctUntilChanged(sameSelectedRoots),
  shareReplay({ bufferSize: 1, refCount: true }),
);
```

Applesauce officially describes EventStore as a reactive in-memory database, RelayPool subscriptions as observables, and casts as typed wrappers connected to an event store. That supports this boundary, but durable rollback/downgrade checkpoints must remain outside the in-memory EventStore.

### Pattern 2: Immutable Snapshot / Mutable Cache

**What:** Each reactive update creates a new `MergedCacheSnapshot` containing ordered cache roots and validation context. Every HTTP request captures exactly one snapshot. Content-addressed verified blobs may be added concurrently to caches, but the request's logical root list never changes mid-resolution.

**When to use:** All GET, HEAD, closure checks, and publication verification jobs.

**Trade-offs:** Snapshot objects are cheap because they hold roots and policy metadata, not trees. Slight staleness during one request is preferable to mixing `.narinfo` from one root with a NAR lookup under another.

### Pattern 3: Budget-Carrying Async Traversal

**What:** Tree operations carry an `AbortSignal`, a budget ledger, and a visited-node set. Manifest blobs may be buffered only after a strict small manifest-size check; file/chunk payloads remain streams. Deduplicate manifests by their addressed ciphertext hash and use an explicit stack/queue to avoid call-stack depth risk.

```typescript
async function* walk(root: RootRef, ctx: WalkContext): AsyncGenerator<TreeEntry> {
  const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const next = pending.pop()!;
    ctx.budget.enterNode(next.node.hash, next.depth); // dedupe + limits
    const bytes = await ctx.blobs.readVerifiedManifest(next.node, ctx.signal);
    const manifest = decodeBoundedManifest(bytes, ctx.budget);
    for (const link of manifest.links) pending.push(toPending(link, next.depth + 1));
    yield* manifest.files;
  }
}
```

**Trade-offs:** Limit bookkeeping is unavoidable domain logic. Centralizing it prevents individual codecs and handlers from applying inconsistent caps.

### Pattern 4: Verify-Then-Promote Streaming CAS

**What:** Stream an inbound or fetched blob through byte-count and incremental hash transforms into a temporary object. Only after the expected hash (and for BUD-15, ciphertext then plaintext checks) succeeds is it atomically promoted under its immutable address. A response can stream from an already verified object; it must not forward a first-seen upstream stream before final verification.

**When to use:** Blossom reads, Blossom writes, PUT staging, optional local caching.

**Trade-offs:** First fetch incurs disk latency and cannot be transparently forwarded immediately, but this is required by the NIP's verify-before-forward rule and keeps memory bounded. Deno's Request/Response bodies and Web Streams `pipeThrough`/`pipeTo` provide the needed backpressure primitives.

### Pattern 5: Recoverable Publication State Machine

**What:** Treat publication as a durable transaction across systems that cannot share an ACID transaction.

```text
OPEN_BATCH → FROZEN → TREE_BUILT → PRIMARY_COMPLETE → EVENT_SIGNED
          → RELAY_PUBLISHED → ROOT_COMMITTED → REPLICATING → COMPLETE
```

Every transition persists enough data to resume idempotently. `PRIMARY_COMPLETE` records the advertised server and proof that every reachable addressed blob is present (upload success or verified HEAD policy). Only then sign and publish. `ROOT_COMMITTED` changes the writable overlay to the published root; incomplete replicas become durable retry debt.

**When to use:** Every debounced write batch and startup recovery.

**Trade-offs:** This is a saga, not atomic distributed commit. A process may crash after relay acceptance but before the local commit; recovery must query by event id and safely finish the commit rather than create a divergent root.

### Pattern 6: Dependency-Gated Pending Index

**What:** Parse accepted `.narinfo` into a pending dependency graph. A record is eligible for the next tree only when its referenced store paths are already in the base root or staged and eligible, and its referenced NAR path has a verified staged blob. Freeze a topologically closed subset at the debounce boundary; leave incomplete entries pending.

**Trade-offs:** NARs commonly arrive before their `.narinfo`, but request order cannot be trusted. Persistent dependency status avoids both fragile upload-order assumptions and roots that advertise missing data.

## Data Flow

### Reactive Cache-State Flow

```text
configured whitelist + relay set
       ↓
RelayPool subscriptions (17091, 37091, 10002, 10063)
       ↓ only protocol messages carrying events
signature verification → EventStore.add
       ↓
custom NixCachePublication casts / models
       ↓
validation + expiration + NIP-01 winner + durable freshness/downgrade gate
       ↓
SelectedCacheState[] ordered by configured publisher priority
       ↓ (+ connected writable identity first)
Atomic MergedCacheSnapshot$ → request handlers / health / metrics
```

Use `shareReplay(1)` or an equivalent BehaviorSubject only at stable derived-state seams. Use `switchMap` for subscriptions whose whitelist/relay set changes so old relay subscriptions are cancelled. Ensure subscriptions are owned by a daemon lifecycle scope and explicitly unsubscribed on shutdown.

### GET / HEAD Flow

```text
request → validate binary-cache path → capture merged snapshot
  ├─ nix-cache-info: synthesize stable small response
  └─ cache path: for each root in priority order
       → bounded path lookup → verified blob cache/fetch → typed result
       → if .narinfo: parse + strip unverifiable Sig
            → collect lower-priority records only while non-Sig fields match
            → merge unique verified Sig fields; warn/metric on conflict
       → if NAR: stream previously verified addressed bytes with cancellation
response ← headers/status identical for GET and HEAD; HEAD omits body
```

Path absence and cache unavailability must be distinct internally even if both eventually map to an HTTP failure: absence permits trying the next publisher; budget exhaustion, integrity failure, or all source failures must be observable and must never be treated as a trustworthy miss.

### PUT and Publication Flow

```text
PUT → signer/identity authorization → strict path validation
    → request.body stream → bounded staging CAS → durable receipt
    → update pending path/dependency graph → reset quiet timer
                                              │ 5s quiet or 60s max
                                              ▼
serialize writer → freeze closed batch → build immutable tree bottom-up
    → enumerate/dedupe reachable blob addresses
    → upload/check complete tree on one advertised BUD-03 server
    → build event → signer signs → publish to configured relays
    → add accepted event to EventStore + commit local root/checkpoint
    → asynchronously replicate remaining servers with retry/backoff
```

The HTTP PUT success contract should mean **durably staged**, not globally published. Expose publication status operationally; otherwise a standard uploader would be held open across debounce, remote signer interaction, all tree uploads, and relay acknowledgements.

### Persistence and Restart Flow

Persist at least:

| Record | Purpose |
|--------|---------|
| Greatest accepted `created_at` per cache identity | Prevent silent rollback across restart |
| Whether identity has ever been accepted as signed | Enforce unsigned downgrade consent across restart |
| Last selected event id/root and last validation time | Warm startup and bounded staleness behavior |
| Staged logical paths and immutable blob addresses | Recover accepted PUTs without re-upload |
| Pending dependency graph and frozen batch id | Resume or safely re-freeze publication |
| Publication state, event template/id, primary replica | Resolve crash windows idempotently |
| Per-server replication debt and retry schedule | Converge advertised replicas after publication |

On startup, load checkpoints before enabling reads/writes, seed cached events into the validation path, resume incomplete publication states, then connect relays. Readiness should require a usable merged snapshot (or an explicitly valid empty state); write readiness additionally requires signer ownership, recovered writer state, and at least one valid advertised Blossom target.

## Merged Cache Resolution Rules

1. Build ordered roots once per snapshot: writable published root first, then configured whitelist order. Never overlay uncommitted staging paths.
2. For ordinary paths, return the first verified present entry.
3. For `.narinfo`, normalize only line endings/serialization mechanics; compare every non-`Sig` semantic field exactly under one parser. Do not combine conflicting `URL`, hashes, sizes, compression, references, store path, derivation, or content-address metadata.
4. Verify each signature using the corresponding publication's declared Ed25519 key bytes; discard all others before comparison or serving.
5. If compatible, preserve the highest-priority record's non-signature field ordering and append unique verified `Sig` lines deterministically.
6. If incompatible, serve the highest-priority winner and emit one structured conflict keyed by path plus publisher/root ids. Do not synthesize a hybrid record.
7. Resolve the winning narinfo's `URL` through the same snapshot and preferably the same publisher root first. A lower-priority blob may satisfy the URL only if its bytes verify against the winner's `FileHash`; integrity, not path coincidence, authorizes reuse.

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| Single-user v1 | One Deno process, one EventStore/RelayPool, local metadata DB, bounded worker pools, optional external local relay/Blossom. This is the target architecture. |
| Shared gateway / tens of clients | Add request coalescing by `(blob hash, verification mode)`, disk CAS quota/eviction, per-publisher and global concurrency limits, and snapshot/cache metrics. Keep one serialized writer per cache identity. |
| Large public gateway | Split stateless HTTP readers from durable publication workers; use a shared verified CAS and metadata store. Distribute immutable reads freely, but lease publication by identity and broadcast committed snapshots. |

### Scaling Priorities

1. **First bottleneck — duplicate remote blob work:** coalesce in-flight hash fetches and cache verified immutable blobs; never duplicate verification streams merely because multiple Nix requests arrive.
2. **Second bottleneck — hostile or broad traversal:** enforce global and per-request semaphores plus manifest/node/byte budgets before adding processes.
3. **Third bottleneck — relay churn:** share subscriptions and derive many identities from one verified EventStore rather than opening subscriptions per HTTP request.

## Anti-Patterns

### Observable Blob Pipelines as Global State

**What people do:** Put downloads, tree walks, and large byte arrays into RxJS subjects alongside selected events.

**Why it is wrong:** Replay retains data, cancellation becomes ambiguous, one slow consumer affects unrelated state, and memory is no longer predictably bounded.

**Do this instead:** Observables carry small immutable control state and job triggers; Web Streams/async iterators carry bytes under request/job-scoped cancellation and budgets.

### Trusting EventStore Replacement Alone

**What people do:** Assume the in-memory store's latest replaceable event is safe to serve.

**Why it is wrong:** NIP-01 winner selection does not enforce this project's future-time, expiration, persistent rollback, or downgrade requirements, and state vanishes on restart.

**Do this instead:** Run typed validation and a durable policy gate before a candidate can update selected state.

### Forward-While-Verifying

**What people do:** Tee an upstream Blossom response to the Nix client and a hash function to save latency.

**Why it is wrong:** Hash mismatch is known only after untrusted bytes have already been forwarded, directly violating the protocol requirement.

**Do this instead:** verify into bounded temporary storage, atomically promote, then serve.

### Publishing the Root Before Availability

**What people do:** Sign/publish after uploads return individually, without proving the full reachable tree exists together on one advertised server.

**Why it is wrong:** Successful partial replication across several servers does not imply any client can traverse the tree.

**Do this instead:** deduplicate the reachable set and establish completeness on one advertised server before signing; track other servers as retry debt.

### Treating PUT Order as Dependency Order

**What people do:** Add a `.narinfo` immediately when it arrives or assume uploader order establishes closure.

**Why it is wrong:** References or the NAR may be missing, creating an intentionally broken intermediate root.

**Do this instead:** stage independently and publish only a dependency-closed frozen subset.

### One Mutable Global Root During Reads

**What people do:** Consult the current observable root at every step of a request.

**Why it is wrong:** A relay update can change the root between narinfo and NAR resolution.

**Do this instead:** capture one immutable merged snapshot per operation.

## Dependency-Aware Build Order

1. **Protocol value objects and adversarial fixtures** — cache identities, strict event/tag parsing, `nhash`, narinfo semantic model, path grammar, hash types, limit ledger. These define contracts for every later subsystem.
2. **Verified streaming blob layer** — SafeFetcher, SSRF/redirect policy, hashing, temporary storage, BUD-15 order, cancellation, and fake Blossom. Hashtree logic is unsafe without it.
3. **Read-only Hashtree codec/traversal** — pinned BUD-16/17/18 fixtures, bounded path lookup, deduplication, encrypted/plain variants. Validate proposed specifications here before designing writes.
4. **Nostr reactive control plane** — RelayPool ingestion, signature verification, custom casts, selector observables, persistent freshness/downgrade checkpoints. It can now resolve roots through a tested reader.
5. **Merged read gateway** — immutable snapshots, priority resolution, narinfo signature filtering/merging, GET/HEAD streaming, health and metrics. This delivers the core reader value before writer complexity.
6. **Staged PUT ingestion and dependency graph** — signer ownership gate, streamed CAS writes, durable receipts, NAR/narinfo association, closure logic.
7. **Copy-on-write Hashtree writer** — deterministic bottom-up manifests and root construction, using the same codec/blob abstractions proven by reads.
8. **Publication transaction and recovery** — debounce/max timer, freeze, one-server completeness proof, signer adapters, relay publication, crash recovery, and overlay commit.
9. **Replication convergence and operational hardening** — per-server debt, retries, quotas, request coalescing, shutdown/drain, end-to-end local relay/Blossom/Nix tests.

The critical ordering is read codec before write codec, verification before traversal, staging before publication, and recovery design before enabling externally visible writes.

## Integration Points

### External Services

| Service | Integration pattern | Notes |
|---------|---------------------|-------|
| Nostr relays | Shared Applesauce RelayPool subscriptions and publish calls | Query multiple relays; validation precedes store selection; relay acceptance is recorded per event id |
| BUD-03 Blossom servers | Ordered server list from valid kind 10063, upload/HEAD/GET through constrained adapters | One advertised server must contain the full reachable tree before publication |
| Optional local relay | Read/write-through protocol cache | Operator-configured address may have explicit local-network allowance; it is not exempt from event signature checks |
| Optional local Blossom | Verified immutable read/write-through CAS | It is not exempt from hash checks; promotion occurs only after verification |
| NIP-46 signer | Async `SignerPort` with observable availability | Expect disconnects and user latency; never hold unjournaled publication state across signing |
| Local secret signer | Same `SignerPort`, protected key loading | Restrict filesystem permissions and key lifetime; no domain module gets raw secret bytes |
| Stock Nix | Standard HTTP binary-cache GET/HEAD and upload PUT paths | Nix independently evaluates configured signatures and NAR/File hashes |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Nostr ingress ↔ EventStore | `Observable<NostrEvent>` → verified `add` | Raw relay messages never enter domain state |
| EventStore ↔ selected state | casts/models + RxJS operators | Keep validation pure; consult persistence through an explicit policy snapshot/service |
| Selected state ↔ gateway | immutable `MergedCacheSnapshot` | Capture once per request |
| Hashtree ↔ Blossom | expected address/key + stream/result | Hashtree never constructs or fetches arbitrary URLs |
| Gateway ↔ publication | published snapshot only | Staging is invisible until `ROOT_COMMITTED` |
| PUT ingress ↔ staging | Web Stream + durable receipt | Body consumption is abort-aware and size bounded |
| Publication ↔ signer/relays/replicas | durable state-machine commands | Every remote side effect is retryable/idempotent or reconciled on restart |

## Sources

- [Applesauce documentation — reactive SDK overview, EventStore, RelayPool, casts](https://applesauce.build/) — official, current; MEDIUM confidence via research confidence seam.
- [Applesauce Getting Started](https://applesauce.build/introduction/getting-started.html) — official examples for EventStore, RelayPool and signing; MEDIUM confidence.
- [Applesauce TypeDoc: `applesauce-core`](https://applesauce.build/typedoc/modules/applesauce-core.html) — official current API surface including EventStore, EventCast, EventSigner, and RxJS exports; MEDIUM confidence.
- [Deno: Writing an HTTP Server](https://docs.deno.com/runtime/fundamentals/http_server/) and [Streams API](https://docs.deno.com/api/web/streams/) — official Request/Response streaming and Web Streams primitives; MEDIUM confidence.
- [Nix 2.35 Binary Cache](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [`.narinfo` format](https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html) — official current protocol reference; MEDIUM confidence.
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — official event, filter, replaceable/addressable behavior; MEDIUM confidence.
- [Blossom BUD-01](https://github.com/hzrd149/blossom/blob/master/buds/01.md) and [BUD-03](https://github.com/hzrd149/blossom/blob/master/buds/03.md) — official repository specifications for addressed retrieval and user server lists; MEDIUM confidence.
- [`NIP.md`](../../NIP.md) — project-normative draft for validation, freshness, traversal, presentation, and publication; HIGH confidence as project requirement, but its BUD-15/16/17/18 dependencies are proposed.

---
*Architecture research for: nixstr-cache*
*Researched: 2026-08-12*
