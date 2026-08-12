# Project Research Summary

**Project:** nixstr-cache
**Domain:** Single-user Deno gateway bridging Nostr cache publications, Blossom Hashtrees, and the Nix HTTP binary-cache protocol
**Researched:** 2026-08-12
**Confidence:** MEDIUM-HIGH

## Executive Summary

`nixstr-cache` is a protocol gateway, not a conventional web application: it gives an unmodified Nix client one local HTTP binary-cache endpoint while resolving an ordered set of Nostr-published, Blossom-hosted Hashtrees. Experts should build it as two deliberately separate planes. Applesauce and RxJS own the small reactive control plane—relay subscriptions, validated event selection, signer lifecycle, and immutable merged snapshots—while Web Streams, an incremental hasher, bounded temporary storage, and a verified content-addressed store own every large-byte path. `NIP.md` is normative wherever research or upstream drafts disagree.

The recommended delivery strategy is read-first and verification-first. Lock strict protocol value objects and adversarial fixtures, then prove safe fetch-and-verify streaming and bounded BUD-16/17/18 traversal before introducing live Nostr state. On those foundations, ship deterministic merged GET/HEAD behavior for stock Nix. Add writes only afterward as durable staging, a copy-on-write tree builder, and a recoverable publication saga. A PUT means durably staged; it never means globally published. A root may be signed and announced only after one advertised Blossom server contains its entire reachable tree.

The main risks are semantic rather than framework risk: BUD-15–18 remain proposed, hostile publisher URLs create SSRF and amplification hazards, and crashes can split local staging, remote replication, signing, relay acknowledgement, and root selection. Mitigate these with pinned proposal fixtures, one hardened outbound fetch boundary, verify-then-promote storage, global traversal budgets, persistent anti-rollback/downgrade state, immutable per-request snapshots, dependency-closed publication batches, and kill-at-every-transition recovery tests. Real Nix CLI interoperability is a release gate because unit tests cannot establish `.narinfo`, HEAD, compression, signature, and upload compatibility.

## Key Findings

### Recommended Stack

Pin the runtime and package graph rather than targeting floating major versions. Use reactive abstractions only for metadata and lifecycle; use standards-native streams for blobs and NARs. No released dependency implements the exact BUD-15/16/17/18 proposal set plus the stricter `NIP.md` profile, so the Hashtree and Nix protocol boundary must remain small, project-owned, and fixture-driven.

**Core technologies:**

- Deno `2.9.5` with bundled TypeScript `6.0.3`: runtime, direct `Deno.serve`, permissions, filesystem/process APIs, Web Streams, and test runner; pin both local and CI behavior through the Deno version and committed `deno.lock`.
- `applesauce-core@6.2.0`, `applesauce-relay@6.2.1`, `applesauce-loaders@6.2.0`, and `applesauce-signers@6.2.2`: required reactive Nostr store, relay pool, loaders, casts, and interchangeable NIP-46/local signers.
- RxJS `7.8.2`: control-plane composition, cancellation, signer state, and serialized debounce/max-delay publication scheduling; never use it as the bulk byte transport.
- Web Streams API: backpressured request, response, Blossom, hashing, staging, and NAR pipelines with cancellation and bounded memory.
- `@db/sqlite@0.13.0`: durable security and workflow state—freshness watermarks, downgrade consent, staged generations, publication transitions, and replication debt. Applesauce SQLite persistence is optional and must not own security-critical state.
- `@noble/hashes@2.3.0`, `@noble/curves@2.3.0`, and `@scure/base@2.3.0`: incremental SHA-256, Ed25519 verification, and strict Bech32/TLV primitives.
- Deno tests plus `@std/assert`, `@std/testing`, and `fast-check@4.9.0`: unit, property, hostile-fixture, streaming, crash-boundary, and integration coverage; include pinned upstream Blossom and real Nix CLI compatibility suites.
- Project-owned `hashtree-codec`, reader, writer, hardened `blossom-client`, and lossless `nix-cache-codec`: isolate proposed or profile-specific protocol semantics behind narrow tested ports.

### Expected Features

The feature set is large because integrity, availability, and recovery are product behavior, not later hardening. The v1 target remains a single-user daemon with one optional writable identity; hosted tenancy and broad administration surfaces would change the threat model.

**Must have (table stakes):**

- Stock Nix GET/HEAD endpoint for `nix-cache-info`, `.narinfo`, and referenced NAR paths, with correct HEAD, miss, streaming, hash, compression, and signature semantics.
- Reactive, whitelist-scoped discovery of valid kind `17091` and `37091` publications, with exact NIP-01 selection and NIP-40 expiration.
- Durable freshness, rollback, and signed-to-unsigned downgrade protection per raw cache identity.
- Verified, bounded Hashtree resolution with BUD-15 ciphertext-then-plaintext checks, DAG deduplication, explicit traversal limits, cancellation, and bounded memory.
- Safe ordered Blossom/BUD-03 discovery and failover through HTTP(S)-only, redirect-revalidated, SSRF-constrained requests.
- Deterministic merged lookup: configured publisher order, writable published root first, verified `Sig` filtering, signature union only for semantically compatible `.narinfo`, and structured conflicts otherwise.
- Signer-gated streamed PUT to one configured owned identity, durable/idempotent staging, and dependency-closed NAR/`.narinfo` publication.
- Five-second quiet / sixty-second maximum serialized batching, copy-on-write root construction, one-complete-advertised-replica barrier, relay acknowledgement policy, and reactive root commit.
- Persistent post-publication replication debt, crash recovery, graceful shutdown, validated configuration, bounded concurrency, structured logs, health/read readiness/write readiness, and metrics.

**Should have (competitive):**

- One stable local substituter over multiple decentralized publishers with explicit deterministic trust priority.
- Compatible multi-publisher signature union with evidence for substantive conflicts.
- Immediate local availability of complete staged objects while remote consumers see only committed, fully reachable roots.
- Verified multi-source recovery, in-flight fetch coalescing, and protocol-native optional local relay/Blossom acceleration.
- Observable publication workflow with stable batch IDs, per-relay acknowledgements, and per-server convergence state.

**Defer (v2+):**

- Multi-user hosted writes, arbitrary per-request cache identities, tenant authentication, quotas, and signer isolation.
- GUI/admin dashboard and hot reload of trust, signer, or writable-identity policy.
- Automatic deletion/garbage collection of published immutable blobs; first establish reachability accounting and an explicit retention policy.
- Full cache crawl/materialization, distributed readers/writers, or a custom Nix store implementation.
- Any confidentiality/access-control claim for BUD-15 self-encryption; it is storage-operator opacity only.

### Architecture Approach

Use a hexagonal, stateful-streaming monolith for v1. Nostr ingress is verified before `EventStore` admission, custom casts expose typed publications, and a durable policy gate selects roots into immutable `MergedCacheSnapshot` values captured once per request. Hashtree traversal receives an abort signal, a visited-hash set, and one shared budget ledger. All first-seen blobs flow through verify-then-promote temporary storage before parsing, caching, or serving. Writes enter a durable dependency-gated staging index; one serialized copy-on-write writer freezes a closed batch and advances it through a recoverable publication state machine.

**Major components:**

1. Configuration and policy kernel — validated identities, trust order, limits, network rules, signer mode, and readiness policy.
2. Protocol domain — strict event/tag/`nhash`/manifest/path/`.narinfo` codecs, typed hashes and identities, selection rules, signature checks, and budget accounting.
3. Verified blob transport and CAS — hardened DNS/redirect-aware Blossom access, streaming hashes, bounded spools, optional BUD-15 codec, atomic promotion, and immutable reads.
4. Hashtree reader/writer — bounded deduplicated traversal and deterministic persistent copy-on-write root construction against the same codecs.
5. Reactive Nostr control plane — RelayPool, verified EventStore ingress, custom casts/models, persistent freshness/downgrade gate, and atomic merged snapshots.
6. Nix HTTP gateway — GET/HEAD/PUT route semantics, priority resolution, `.narinfo` compatibility/signature union, response streaming, and overload/cancellation behavior.
7. Durable write coordinator — staged receipts, dependency graph, debounce/max batch freezing, signer capability, replica completeness proof, relay publication, recovery, and replication retries.
8. Operations and test harness — structured logs, health/readiness/metrics, graceful drain, hostile relay/Blossom fixtures, crash injection, and real Nix end-to-end tests.

**Key patterns:**

- Validate, then store, then select; relay order and EventStore replacement alone are never policy.
- Immutable logical snapshots with mutable verified caches; a request never changes roots midway.
- RxJS for small control state, Web Streams/async iterators for bytes.
- Verify-then-promote; never forward first-seen upstream bytes while verification is still pending.
- Budget-carrying iterative traversal with visited-hash deduplication.
- Durable publication saga: `OPEN_BATCH → FROZEN → TREE_BUILT → PRIMARY_COMPLETE → EVENT_SIGNED → RELAY_PUBLISHED → ROOT_COMMITTED → REPLICATING → COMPLETE`.
- Dependency-gated batches: `.narinfo` becomes publishable only with its verified NAR and resolvable references.

### Critical Pitfalls

1. **Selecting or persisting invalid/stale events** — run one pure validation and NIP-01 selection pipeline before mutation; atomically persist high-water timestamps, tie-break IDs, expiration state, and downgrade consent before exposing a root.
2. **Unsafe publisher-directed network and DAG work** — route every untrusted URL through one manual-redirect fetcher with per-hop DNS/IP policy, and carry global request budgets plus visited-hash deduplication through iterative traversal.
3. **Using bytes before integrity is proven or buffering them secretly** — incrementally hash into bounded temporary storage, verify ciphertext before BUD-15 decryption and plaintext afterward, atomically promote, honor backpressure/cancellation, and forbid whole-body APIs on unbounded paths.
4. **Misreading or synthesizing `.narinfo` semantics** — use a lossless bounded parser; distinguish `FileHash` from `NarHash`, match declared Nix keys by decoded Ed25519 bytes, strip unauthorized signatures, and union `Sig` only when every non-signature semantic field agrees.
5. **Publishing partial or unavailable state** — durably journal PUT acceptance, freeze a dependency-closed generation, serialize root builders, prove the complete reachable set exists on one advertised server, then sign/publish; recover every crash window idempotently and track remaining replicas as retry debt.

## Implications for Roadmap

Based on the combined research, use nine phases. The ordering preserves the normative trust chain and produces a useful read-only product before exposing the substantially riskier writer.

### Phase 1: Protocol Contracts and Adversarial Fixtures
**Rationale:** Every subsystem depends on the exact `NIP.md` profile, and proposed BUD semantics must be frozen before implementation spreads assumptions.
**Delivers:** Strict value objects and codecs for identities, events/tags, `nhash` TLV, hashes, paths, `.narinfo`, manifest limits, configuration schema, and hostile/property fixtures pinned to adopted BUD revisions.
**Addresses:** Validated configuration and protocol correctness foundations.
**Avoids:** Invalid-event selection, name normalization, ambiguous tags/base64/TLV, and lossy `.narinfo` parsing.

### Phase 2: Verified Streaming Blob Foundation
**Rationale:** Safe traversal and HTTP serving are impossible until network and byte integrity boundaries are proven.
**Delivers:** Hardened SafeFetcher, manual redirect/DNS/IP policy, incremental hashes, bounded temporary CAS, cancellation/backpressure, source-attempt limits, and plaintext plus isolated optional BUD-15 verification pipelines.
**Addresses:** Safe Blossom failover, bounded-memory streaming, immutable local acceleration.
**Avoids:** SSRF, forward-while-verifying, range-hash mistakes, hidden buffering, leaked keys, and orphaned transfers.

### Phase 3: Bounded Read-Only Hashtree Resolution
**Rationale:** Read codecs should prove the proposed BUD formats and hostile-DAG limits before a writer can emit roots.
**Delivers:** Pinned BUD-16/17/18 decoding, iterative path lookup, visited-hash deduplication, budget ledger, encrypted/plain traversal, declared-size enforcement, and fake/upstream Blossom compatibility tests.
**Addresses:** Verified resource-bounded resolution and lazy lookup.
**Avoids:** Recursive traversal, shared-DAG amplification, unbounded manifests/nodes/bytes, and divergent draft interpretation.

### Phase 4: Reactive Nostr Selection and Durable Trust State
**Rationale:** Roots can enter the read model only after the resolver is safe and persistent selection policy exists.
**Delivers:** Applesauce RelayPool/EventStore ingestion, cryptographic and project-NIP validation, custom publication casts, multi-relay selection, NIP-40 expiration, NIP-65/BUD-03 discovery, persistent freshness/downgrade checkpoints, and lifecycle-safe observables.
**Addresses:** Reactive discovery, rollback resistance, bounded staleness, ordered publisher identities.
**Avoids:** EventStore-as-policy, restart rollback, silent unsigned downgrade, EOSE/live races, stale async commits, and subscription leaks.

### Phase 5: Merged Stock-Nix Read Gateway
**Rationale:** This is the smallest complete vertical value slice and validates the entire read trust chain before write state is introduced.
**Delivers:** Immutable merged snapshots, `nix-cache-info`, GET/HEAD for `.narinfo` and NAR paths, priority fallback, authorized signature filtering/compatible union, conflict diagnostics, streaming responses, cancellation, and real Nix CLI read tests.
**Addresses:** Core substituter endpoint and primary multi-publisher differentiator.
**Avoids:** Mid-request root changes, false misses on source failure, conflicting synthetic records, incorrect HEAD, and confusion between Nostr publisher trust and Nix key policy.

### Phase 6: Signer-Gated Durable PUT Staging
**Rationale:** HTTP acceptance, signer authority, and publishability must be modeled separately before any root construction or remote side effect.
**Delivers:** Unified local/NIP-46 signer capability states, ownership validation, write readiness, streamed/idempotent PUT receipts, durable staging CAS, NAR/`.narinfo` association, dependency graph, and graceful restart/drain behavior.
**Addresses:** One explicit writable identity, protected signers, durable transactional uploads, immediate local-complete overlay policy.
**Avoids:** PUT after signer loss, identity confusion, plaintext-secret persistence, upload-order assumptions, lost accepted uploads, and partial objects becoming visible.

### Phase 7: Copy-on-Write Tree Construction and Closed Batching
**Rationale:** The writer should reuse already-proven codecs and storage and produce deterministic candidate roots without publishing them.
**Delivers:** Persistent copy-on-write manifests, five-second quiet/sixty-second maximum serialized freezing, dependency-closed subsets, reachable-set enumeration, deterministic roots, and restart-safe writer recovery.
**Addresses:** Immutable Hashtree updates and bounded publication batching.
**Avoids:** Concurrent root builders, timer-driven races, starvation under sustained writes, broken reference closure, and mutable published state.

### Phase 8: Availability-Gated Publication Saga
**Rationale:** Cross-system publication is the highest-risk correctness boundary and requires the crash-safe local writer first.
**Delivers:** Frozen BUD-03 target lists, per-server completeness audit, one-complete-advertised-replica barrier, local/NIP-46 event signing, relay acknowledgement policy, idempotent crash reconciliation, reactive root commit, and durable retry debt for remaining replicas.
**Addresses:** Reliable Nostr publication and availability-before-announcement replication.
**Avoids:** Unioning partial replica coverage, signing before availability, relay/data success conflation, duplicate roots after crash, dead NIP-46 requests, and unrecoverable split-brain state.

### Phase 9: Convergence, Operations, and End-to-End Hardening
**Rationale:** Production readiness depends on observable recovery and resource behavior across all protocol seams, not only happy-path completion.
**Delivers:** Background convergence with backoff/jitter, fetch coalescing, quotas and semaphores, health/read/write readiness, metrics and structured logs, graceful shutdown, periodic republish policy, kill-at-transition tests, slow/hostile service tests, and pinned Nix/Blossom end-to-end CI.
**Addresses:** Operational diagnosis, replica durability, overload behavior, and release confidence.
**Avoids:** Silent retry loss, duplicate remote work, descriptor/memory exhaustion, secret logging, unbounded shutdown, and unit-test-only compatibility claims.

### Phase Ordering Rationale

- Protocol contracts precede implementations because `NIP.md` is normative while BUD-15–18 are moving proposals.
- Network and integrity primitives precede Hashtree traversal; traversal precedes event-driven serving; a safe reader precedes a writer.
- The merged GET/HEAD gateway is the first vertical product slice and should be validated with stock Nix before expanding scope.
- Durable staging and signer ownership precede tree mutation; deterministic closed-tree construction precedes any signing or replication.
- Recovery semantics are designed with each write transition, not retrofitted after external writes are enabled.
- Observability begins with typed states in earlier phases and is completed as an explicit release-hardening phase.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2:** Re-check the exact BUD-15 proposal revision and prove whether its cipher/KDF can be implemented with bounded-memory streaming; keep encryption optional if not.
- **Phase 3:** Re-check BUD-16/17/18 merge status and lock conformance fixtures and canonical encoding rules to exact revisions.
- **Phase 5:** Validate current stock Nix HTTP upload/read behavior, `.narinfo` fingerprint/signature details, HEAD headers, compression, and status codes with a pinned Nix version.
- **Phase 6:** Confirm Applesauce NIP-46 daemon-safe authorization, `switch_relays`, reconnection, request timeout, and identity lifecycle against current APIs.
- **Phase 8:** Research Blossom authentication/upload acknowledgement details and relay publication acknowledgement/reconciliation policy against the selected server implementations.

Phases with standard patterns (skip research-phase unless dependencies changed):

- **Phase 1:** Strict parsers, typed value objects, configuration validation, property tests, and hostile fixtures are established patterns; use `NIP.md` as authority.
- **Phase 4:** Applesauce 6.x reactive store/relay/cast patterns are documented; phase work is mainly project-specific policy implementation.
- **Phase 7:** Copy-on-write immutable structures, serialized batching, dependency closure, and journaled state machines are established once codecs are fixed.
- **Phase 9:** Metrics, readiness, bounded concurrency, graceful shutdown, backoff, and fault-injection patterns are standard, though protocol E2E fixtures remain mandatory.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH for released components; MEDIUM for optional draft codecs | Deno, Applesauce, RxJS, Noble, SQLite, and Web Streams were checked against current official sources/package metadata. No released exact BUD-15–18 implementation exists; project-owned codecs are therefore the safer recommendation. |
| Features | MEDIUM-HIGH | Table stakes follow `PROJECT.md`, normative `NIP.md`, and official Nix/Nostr/Blossom protocols. The combined end-to-end product has no mature reference implementation, so some operator behavior needs validation. |
| Architecture | MEDIUM-HIGH | Reactive control-plane/streaming data-plane separation, immutable snapshots, verified CAS, and recoverable sagas are well-established. Exact Hashtree writer interoperability remains draft-dependent. |
| Pitfalls | HIGH for security/correctness classes; MEDIUM for draft-specific details | Hash-before-use, SSRF, rollback, bounded traversal, Nix signature semantics, and publication ordering are directly supported by normative/official sources. Proposal churn can alter codec-level failure modes. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **BUD proposal stability:** BUD-15/16/17/18 were still unmerged at research time. Re-check before Phases 2–3 and 7, record exact revisions, and gate changes with golden conformance fixtures.
- **BUD-15 bounded-memory feasibility:** Confirm the exact algorithm and streaming strategy; do not let optional self-encryption block the plaintext read/write MVP.
- **Real Nix interoperability:** Establish supported Nix version(s), exact PUT paths/status expectations, HEAD headers, narinfo fingerprint/signature behavior, and compression/decompression behavior through executable tests.
- **SSRF connection binding:** Deno's high-level `fetch` may not eliminate DNS time-of-check/time-of-use risk by itself. Prototype an address-bound HTTP(S) transport that preserves Host/SNI, or document and enforce a conservative deployment boundary before accepting publisher URLs.
- **Signer and publication policy:** Decide relay acknowledgement quorum, NIP-46 auth UX/timeouts, BUD-02/BUD-11 authentication, local-key encryption/loading, and crash reconciliation evidence before writes ship.
- **Operational policy:** Choose concrete traversal/byte/concurrency defaults, disk CAS quota/retention, selected-event staleness behavior, downgrade-consent interface, and periodic republish cadence during phase planning.

## Sources

### Primary (HIGH confidence)

- [`NIP.md`](../../NIP.md) — normative project protocol for validation, publication, resolution, trust, freshness, downgrade, traversal, and Nix presentation.
- [Nix 2.35 binary-cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [`.narinfo` format](https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html) — stock Nix layout, metadata, hashes, and signatures.
- [Nix HTTP binary-cache store](https://nix.dev/manual/nix/2.35/store/types/http-binary-cache-store.html) — substituter behavior and trusted-key policy.
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md), [NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md), and [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) — event validation/selection, expiration, and relay discovery.
- [Blossom specifications](https://github.com/hzrd149/blossom) and proposal PRs [BUD-15](https://github.com/hzrd149/blossom/pull/104), [BUD-16](https://github.com/hzrd149/blossom/pull/105), [BUD-17](https://github.com/hzrd149/blossom/pull/106), [BUD-18](https://github.com/hzrd149/blossom/pull/107) — blob transport, server discovery, encryption, manifests, chunking, and `htree` references.
- [Applesauce documentation](https://applesauce.build/) and [monorepo](https://github.com/hzrd149/applesauce) — current EventStore, RelayPool, casts/models, loaders, signer interfaces, and package compatibility.
- [Deno HTTP server](https://docs.deno.com/runtime/fundamentals/http_server/) and [Web Streams](https://docs.deno.com/api/web/streams/) documentation — direct streaming server and backpressure primitives.

### Secondary (MEDIUM confidence)

- [NixOS Binary Cache wiki](https://wiki.nixos.org/wiki/Binary_Cache) — non-normative deployment examples for substituters and trusted keys.
- [`hzrd149/blossom-server`](https://github.com/hzrd149/blossom-server) — compatibility target for current Blossom upload/download behavior, not a Hashtree reference implementation.
- Consolidated research in [STACK.md](./STACK.md), [FEATURES.md](./FEATURES.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [PITFALLS.md](./PITFALLS.md) — source-by-source analysis and rationale.

### Tertiary (LOW confidence)

- No tertiary source drives a roadmap decision. Product-category expectations inferred without a mature reference implementation are explicitly treated as validation gaps.

---
*Research completed: 2026-08-12*
*Ready for roadmap: yes*
