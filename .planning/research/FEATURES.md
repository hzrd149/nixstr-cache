# Feature Research

**Domain:** Single-user local Nix HTTP binary-cache gateway backed by Nostr publication events and Blossom Hashtrees
**Researched:** 2026-08-12
**Confidence:** MEDIUM — protocol behavior is grounded in current official documents, but BUD-15 through BUD-18 and this project's NIP remain drafts and the end-to-end product category has no established reference implementation.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stock Nix read endpoint | The product is only useful if an unmodified Nix client can use it as an `http://` substituter | HIGH | Serve `GET` and `HEAD` for `/nix-cache-info`, `/<store-hash>.narinfo`, and the relative NAR paths named by `URL`. Return consistent status and representation headers on HEAD, no body on HEAD, `404` for a genuine miss, and stream successful bodies with backpressure. `nix-cache-info` needs at least a correct `StoreDir`; expose deliberate `Priority` and `WantMassQuery` values. |
| Correct `.narinfo` parsing and serving | `.narinfo` is the lookup/index record Nix uses before fetching a NAR | HIGH | Preserve all non-signature fields exactly for compatibility; allow repeated `Sig`; verify advertised signatures by decoded key bytes; strip signatures not authorized by the selected event; never rewrite `URL` without also ensuring the referenced path is served. |
| Deterministic merged cache lookup | A single URL must behave predictably when several publishers contain the same store object | HIGH | Resolve in configured publisher order, with the writable signer-owned cache first. Merge only compatible `Sig` fields. If any other field differs, serve the highest-priority record and emit a structured conflict event and counter. Negative results must not become permanently stale when reactive roots change. |
| Reactive Nostr discovery and event validation | Replaceable roots are mutable pointers; a snapshot-only reader quickly becomes stale | HIGH | Subscribe for kinds `17091` and `37091` for an explicit whitelist, validate NIP-01 id/signature and project-NIP tags, honor NIP-40 expiration, select by replaceable/addressable rules, follow configured relays plus useful NIP-65 publisher relays, and reactively invalidate derived indexes on root changes. |
| Freshness, rollback, and downgrade protection | A valid old event or removal of Nix signing keys can silently weaken the cache | HIGH | Persist greatest accepted `created_at` per cache identity; reject/report rollback; bound selected-event staleness; never silently transition a previously signed identity to unsigned; expose a deliberate operator approval/reset path rather than hiding the state. |
| Verified, resource-bounded Hashtree resolution | Blossom and even signed publishers are untrusted; malformed DAGs can exhaust memory or network | HIGH | Verify every ciphertext/blob SHA-256 before decode/cache/serve; for BUD-15 verify ciphertext, decrypt locally, then verify plaintext content key. Deduplicate visited hashes and enforce configured limits for manifest bytes, depth, links/node, total nodes/decoded bytes, redirects, attempts, declared link sizes, and decompression output. |
| Safe Blossom source discovery and failover | Availability depends on finding immutable blobs across imperfect servers | HIGH | Try event `blossom` tags in order, then BUD-03 kind `10063` servers and operator sources; cap attempts (the NIP recommends 10). Apply HTTP(S)-only, DNS/IP SSRF checks and redirect revalidation to publisher-controlled URLs. Treat hash mismatch as source failure and try another source. |
| Streamed reads with bounded memory | NARs and chunked trees can be much larger than daemon memory | HIGH | Stream manifests, chunks, verification, optional decryption, NAR delivery, and any decompression with backpressure. Cancellation from the Nix client must cancel upstream work. Coalesce safe concurrent immutable-blob fetches to avoid duplicate transfer storms. |
| Signer-gated stock Nix HTTP writes | `nix copy --to http://...` uploads binary-cache files using path-oriented HTTP writes; a writable endpoint must preserve that layout | HIGH | Accept streamed `PUT` only for supported cache paths and only when an owned cache identity is configured and its signer is ready. Stream bodies to durable staging while hashing; enforce size/time/concurrency limits. Return a success only after the individual upload is durably accepted, not after global publication. Reject writes with an explicit unavailable/forbidden response when signing is disabled. |
| Transactional upload staging | Nix uploads NAR content and `.narinfo` metadata separately, so exposing an intermediate state creates broken substitutes | HIGH | Keep uploads in a persistent pending generation. Validate path/body consistency and `.narinfo`; do not place a `.narinfo` in a publishable tree until its NAR is staged and verified. Add referenced store paths in topological order where possible. Duplicate idempotent PUTs should succeed without multiplying storage. |
| Debounced, bounded publication batches | A Nix copy emits bursts; signing every file is wasteful, while indefinite batching loses liveness | HIGH | Publish after 5 seconds without a write and force a batch boundary after 60 seconds of sustained writes. Serialize publication per identity. PUT acceptance, current published root, and pending batch status must remain distinct states. |
| Availability-before-announcement replication | A signed root is useless if no advertised server can traverse it | HIGH | Resolve the signer publisher's ordered BUD-03 servers, authenticate Blossom uploads as needed, and ensure at least one advertised server has every newly reachable immutable blob before signing/publishing the root. Use HEAD/content hash checks for deduplication where supported; upload missing blobs by streaming. |
| Post-publication replication convergence | Requiring every server blocks progress, but silently abandoning failed replicas undermines durability | MEDIUM | After one complete advertised replica permits publication, persist per-server deficits and retry remaining servers asynchronously with bounded exponential backoff and jitter. Surface complete/partial/stalled status and provide a safe manual retry trigger. |
| Reliable Nostr publication | A locally signed event that no configured relay accepts is not a usable cache update | HIGH | Sign only after the reachable-tree barrier. Publish to configured write relays, record per-relay acknowledgements/errors, require an explicit minimum success policy, and feed the accepted event back into the same reactive selection path rather than mutating the read view through a side channel. |
| Unified signer lifecycle | Operators need both simple local operation and isolated remote keys without ambiguous authorization | HIGH | One abstraction supports protected local secret keys and NIP-46. Expose disconnected/connecting/auth-required/ready/signing/error states. For NIP-46 validate the connection secret, call `get_public_key`, handle auth challenges and `switch_relays`, and delete the disposable client key on logout. Any disconnect immediately disables new PUT acceptance; pending durable uploads remain recoverable but unpublished. |
| Durable recovery and restart safety | A daemon crash during a multi-gigabyte upload, tree build, or partial replication must not corrupt the published view | HIGH | Persist accepted roots/freshness watermarks, verified immutable-object metadata, pending generation/journal, replication deficits, and publication attempts. On startup remove or quarantine incomplete temp files, reverify ambiguous staged objects, resume safe uploads/retries, and never infer publication merely from a signed-but-unacknowledged local event. |
| Explicit validated configuration | Trust and resource limits cannot be safe implicit defaults | MEDIUM | Validate bind address, store dir, ordered publisher/cache identities, read/write relays, writable kind/name, signer mode, Blossom sources, local-cache exceptions, signature/unsigned policy, SSRF allowlists, timeouts, concurrency and traversal limits. Fail closed on invalid writable configuration. Prefer restart-applied config in v1 over partially hot-reloaded trust state. |
| Health, readiness, metrics, and structured logs | Operators otherwise cannot distinguish a cache miss from stale relays, invalid roots, bad blobs, signer loss, or replication lag | MEDIUM | Separate liveness from read readiness and write readiness. Include selected root age, relay/session state, fetch/hash/validation failures, conflict counts, cache hit/miss, streamed bytes, pending batch age/size, signer state, per-server replication, retry queue, publication latency and last successful publication. Never log secret keys, NIP-46 secrets, auth events, decryption keys, or full untrusted content. |
| Graceful shutdown and backpressure | Local daemon restarts and large concurrent requests are normal operational events | MEDIUM | Stop accepting PUTs, allow or checkpoint active staging, persist pending publication state, cancel upstream reads cleanly, and drain within a configured deadline. Bound concurrent fetches/uploads and queue sizes; return explicit overload responses rather than exhausting memory/descriptors. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| One local substituter over many decentralized publishers | Gives stock Nix a single stable URL while trust remains an explicit ordered whitelist | HIGH | Publisher priority is deterministic and changes reactively without requiring Nix reconfiguration. This is the core product differentiator. |
| Compatible signature union with conflict evidence | Improves trust/key-rotation compatibility without synthesizing contradictory metadata | MEDIUM | Union verified repeatable `Sig` lines only when every non-signature field is identical; otherwise serve the priority winner and retain publisher/root identifiers in diagnostics. |
| Immediate writable overlay with transactional remote publication | Locally uploaded artifacts become available through the same logical cache while remote readers see only complete roots | HIGH | The local overlay may expose only complete staged objects; remote publication still waits for the replication barrier. Clearly distinguish local-complete from globally-published status. |
| Content-addressed multi-source recovery | Hash identity makes failover across publisher servers, local Blossom, and operator mirrors safe | HIGH | Race or sequence bounded sources, cache only verified bytes, and penalize unhealthy sources temporarily without turning source order into a trust decision. |
| Signer-aware write safety | Connecting a signer grants exactly one narrowly configured publication capability, not a general upload service | HIGH | Bind signer pubkey to one default or named cache identity; validate ownership after every reconnect; disable PUT atomically on mismatch/disconnect. |
| Publication state as an observable workflow | Operators can see `staged → tree-built → replicating → sign-needed → relay-publishing → published → converging` | MEDIUM | Stable batch/publication IDs make logs and metrics actionable and enable safe crash recovery and manual retry without duplicate logical updates. |
| Protocol-native optional local acceleration | A local relay and Blossom server improve latency/durability without inventing another interchange format | MEDIUM | Treat them as read/write-through protocol peers; still verify their events/blobs. Their unavailability must degrade gracefully to remote sources. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Public or multi-user write endpoint | Makes the daemon look like a hosted cache service | Expands authentication, quotas, abuse prevention, signer isolation and tenant consistency far beyond the single-user threat model | Bind to loopback by default and gate one configured identity behind one signer; design subsystem boundaries for a later hosted product |
| Arbitrary cache identity selected by PUT URL/header | Seems flexible for multiple projects | Lets request data influence signing authority and complicates recovery/publication ordering | Configure exactly one writable kind `17091` or `(37091, d)` identity and reject all other write targets |
| Publish after each PUT | Minimizes apparent latency | Nix uploads NAR and metadata separately; roots can become incomplete, signer prompts multiply, and relays/Blossom are flooded | Durable staging plus 5-second quiet / 60-second maximum batching |
| Wait for every Blossom replica before publishing | Sounds maximally durable | One slow or dead server blocks all updates indefinitely | Require one complete advertised server, publish, then converge remaining replicas asynchronously and visibly |
| Acknowledge PUT only after global publication | Gives callers a simple mental model | Couples HTTP request lifetime to batching, signing prompts, replication and relay outages; causes timeouts and retries of large bodies | Acknowledge durable local acceptance; expose publication state via health/metrics/logs |
| Buffer complete NARs, manifests, or trees in RAM | Simplifies hashing and tree assembly | Violates the bounded-resource goal and fails on normal large store objects | Streaming pipelines, durable temp/staging files, incremental hashing and bounded manifest traversal |
| Trust a preferred Blossom server or local mirror without hashing | Avoids verification overhead | Blossom is explicitly untrusted transport; corruption or compromise becomes cache forgery/DoS | Verify every blob from every source before decode, cache, or forwarding |
| Treat BUD-15 self-encryption as private cache access | Encryption creates a privacy impression | Root keys are public, content is convergently encrypted, and access patterns remain visible | Describe it only as storage-operator opacity; use a separate authenticated distribution design if confidentiality is later required |
| Automatically accept rollback or signed-to-unsigned downgrade | Maximizes availability after odd publisher updates | Silently weakens freshness or Nix signature policy | Persist watermarks/signature history and require explicit operator intervention with clear diagnostics |
| Full cache crawl/materialization before serving | Makes lookup implementation simple | Startup latency and storage scale with the entire remote cache; hostile trees amplify work | Resolve/index lazily by requested path, cache verified immutable nodes, and optionally prewarm bounded hot metadata later |
| Hot reload of trust, signer, and writable identity in v1 | Avoids daemon restarts | Partial transitions can mix generations and sign under unintended policy | Validate config atomically at startup; add carefully designed reload only after state-machine behavior is tested |
| Built-in GUI/admin dashboard | Easier discovery for some users | Adds a second product surface and local web security burden before protocol correctness is proven | Config file plus structured logs, metrics and compact health/readiness endpoints |
| Automatic deletion/garbage collection of published blobs | Controls storage growth | Old signed roots and lagging clients may still require immutable blobs; this NIP defines no revocation/tombstone | Defer retention policy; expose reachability/accounting first and coordinate deletion with explicit server policy later |

## Feature Dependencies

```text
[Validated configuration + persistent state]
    ├──requires──> [Publisher whitelist and cache identity model]
    ├──requires──> [Resource/network safety policy]
    └──enables───> [Reactive Nostr selection]
                       └──requires──> [Event validation + freshness/downgrade state]
                                          └──enables───> [Verified Hashtree resolution]
                                                             └──enables───> [GET/HEAD Nix cache]

[Deterministic merged lookup]
    ├──requires──> [Multiple validated publisher views]
    └──requires──> [Narinfo compatibility/signature filtering]

[Signer ready + owned writable identity]
    └──enables───> [Streamed path-oriented PUT]
                       └──requires──> [Durable transactional staging]
                                          └──requires──> [NAR before narinfo completeness]
                                          └──enables───> [Debounced tree generation]
                                                             └──requires──> [At least one complete advertised replica]
                                                                                └──enables───> [Sign and publish root event]
                                                                                                   └──enables───> [Reactive writable overlay update]
                                                                                                   └──enhances──> [Async replica convergence]

[Structured state machine + durable journal]
    ├──enables───> [Crash recovery]
    ├──enables───> [Graceful shutdown]
    └──enables───> [Actionable health/metrics/logs]
```

### Dependency Notes

- **HTTP read compatibility requires validated Hashtree resolution:** serving a `.narinfo` or NAR before verifying the complete signed-event-to-blob chain breaks the gateway trust model.
- **Merge semantics require canonical `.narinfo` handling:** priority and signature union cannot be implemented safely on loosely parsed text or on records whose NAR paths are unavailable.
- **PUT requires signer readiness, but durable staging must outlive signer readiness:** writes must be disabled immediately on signer loss; already accepted uploads must remain recoverable and await reconnection.
- **Publication requires a reachable-tree barrier:** tree creation alone is not success. Every blob reachable from the proposed root must exist on at least one advertised server before signing the event.
- **Async replication requires durable deficit tracking:** background retries that live only in memory are silently lost on restart.
- **Observability should be built with each state transition:** adding it after the publication pipeline makes failures difficult to attribute and recovery unsafe.

## MVP Definition

### Launch With (v1)

- [ ] Validated single-user daemon configuration, loopback-safe defaults, durable state, graceful shutdown and bounded concurrency
- [ ] Reactive whitelist subscriptions for kind `17091`/`37091`, strict validation, expiration, freshness/rollback persistence and downgrade approval flow
- [ ] Verified, SSRF-safe, resource-bounded BUD-18 traversal with ordered Blossom/BUD-03 failover and bounded-memory streaming
- [ ] Stock Nix `GET`/`HEAD` service for `nix-cache-info`, `.narinfo` and referenced NAR paths with correct miss behavior
- [ ] Deterministic publisher-priority merge, authorized signature filtering/union, and observable substantive conflicts
- [ ] One explicit writable identity, gated by either protected local signer or NIP-46 signer, with clear read/write readiness
- [ ] Streamed path-oriented PUT, durable transactional staging, NAR-before-narinfo completeness and idempotent duplicate acceptance
- [ ] Five-second quiet / sixty-second maximum batching, immutable tree construction, one-complete-replica barrier, signed Nostr publication and reactive overlay update
- [ ] Persistent asynchronous convergence to remaining advertised Blossom servers with bounded retries
- [ ] Structured logs, liveness/readiness, operational metrics and publication/replication status sufficient to diagnose every pipeline stage
- [ ] Crash recovery tests plus protocol, streaming and end-to-end tests against local relay and Blossom services

### Add After Validation (v1.x)

- [ ] Bounded metadata prewarming and adaptive immutable-blob fetch coalescing — add after real request traces show cold-lookup latency is material
- [ ] Operator-triggered retry/reconcile commands and richer diagnostic status output — add once failure modes from field operation are known
- [ ] Atomic config reload for non-trust operational settings — add only after restart-based configuration and state transitions are stable
- [ ] Periodic re-announcement of an unchanged root — add when relay retention measurements show it is required operationally
- [ ] More sophisticated parallel source racing/health scoring — add after sequential ordered fallback is correct and measurable

### Future Consideration (v2+)

- [ ] Multiple writable identities/signers — requires per-identity queues, authorization and publication serialization
- [ ] Multi-user hosted gateway — requires tenant authentication, quotas, isolation, abuse controls and a new threat model
- [ ] Explicit retention/garbage-collection tooling — requires a policy for old signed roots and replica coordination
- [ ] GUI/admin console — only after daemon interfaces and operational workflows settle
- [ ] Alternate Nix store frontends (`file://`, S3 mirror, custom store) — the HTTP gateway is sufficient to validate the core protocol

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Strict event selection/freshness/downgrade state | HIGH | HIGH | P1 |
| Verified bounded Hashtree resolver and source failover | HIGH | HIGH | P1 |
| Stock Nix GET/HEAD compatibility | HIGH | HIGH | P1 |
| Deterministic merged lookup and `.narinfo` signature rules | HIGH | HIGH | P1 |
| Durable signer-gated streamed PUT staging | HIGH | HIGH | P1 |
| Debounced transactional publication and one-replica barrier | HIGH | HIGH | P1 |
| Crash recovery and replica convergence | HIGH | HIGH | P1 |
| Health/readiness, metrics and structured logs | HIGH | MEDIUM | P1 |
| Optional local relay/Blossom read/write-through acceleration | MEDIUM | MEDIUM | P2 |
| Metadata prewarming and source racing | MEDIUM | MEDIUM | P2 |
| Atomic limited config reload | LOW | MEDIUM | P2 |
| Multiple writable identities | MEDIUM | HIGH | P3 |
| GUI and hosted multi-tenancy | LOW for v1 | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have after correctness is validated
- P3: Future product expansion

## Ecosystem Feature Comparison

There is no direct mature competitor that merges Nostr/Blossom Hashtrees into a writable stock-Nix HTTP cache. The useful comparison is therefore against adjacent interfaces.

| Feature | Conventional HTTP binary cache | Blossom server | `nixstr-cache` approach |
|---------|--------------------------------|-----------------|-------------------------|
| Stock Nix reads | Native `nix-cache-info` / `.narinfo` / NAR layout | Exposes hashes, not Nix store metadata | Preserve native Nix layout locally while resolving content through signed roots |
| HTTP writes | Nix HTTP store implementations can upload cache paths with PUT, but publication semantics are server-specific | `PUT /upload` stores one SHA-256-addressed blob, normally with Nostr authorization | Accept Nix path PUTs locally, stage transactionally, then translate the immutable result into Blossom uploads and a root event |
| Publisher trust | Usually configured Nix signing keys/domain endpoint | Server source is not trusted; integrity is blob hash | Explicit Nostr publisher whitelist plus Nix signature filtering; Blossom remains transport only |
| Multiple publishers | Usually multiple substituter URLs and Nix-side priority | Not an index/merge concern | One deterministic merged substituter with conflict visibility |
| Atomic cache generation | Deployment-specific | Individual immutable blobs; no Nix generation pointer | Signed replaceable/addressable event is the generation pointer, published only after reachability |
| Replication | CDN/object-store specific | User server list and mirroring ecosystem | One-complete-server publication barrier plus durable background convergence |
| Signer lifecycle | Often a local Nix Ed25519 secret key | Nostr authorization events per server action | NIP-46 or protected local Nostr signer gates one cache identity; advertised Nix keys remain distinct |

## Sources

Primary and current sources:

- [Nix 2.35 binary cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/)
- [Nix 2.35 `.narinfo` format](https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html)
- [Nix HTTP binary cache store](https://nix.dev/manual/nix/2.35/store/types/http-binary-cache-store.html)
- [Nix cache-info format](https://nix.dev/manual/nix/2.35/protocols/nix-cache-info.html)
- [Nostr NIP-01: event signatures and replaceable/addressable events](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [Nostr NIP-40: expiration](https://github.com/nostr-protocol/nips/blob/master/40.md)
- [Nostr NIP-46: remote signing, relay switching, auth challenges and logout](https://github.com/nostr-protocol/nips/blob/master/46.md)
- [Nostr NIP-65: relay list metadata](https://github.com/nostr-protocol/nips/blob/master/65.md)
- [Blossom protocol overview and endpoint index](https://github.com/hzrd149/blossom)
- [Blossom BUD-01: blob retrieval](https://github.com/hzrd149/blossom/blob/master/buds/01.md)
- [Blossom BUD-02: blob upload](https://github.com/hzrd149/blossom/blob/master/buds/02.md)
- [Blossom BUD-03: ordered user server lists](https://github.com/hzrd149/blossom/blob/master/buds/03.md)
- [Blossom BUD-11: Nostr authorization](https://github.com/hzrd149/blossom/blob/master/buds/11.md)
- [Project NIP draft](../../NIP.md) — normative project protocol, including draft BUD-15–18 integration

Research confidence notes:

- **HIGH for Nix read layout and `.narinfo` semantics:** verified against the current official Nix 2.35 manual.
- **MEDIUM for generic HTTP PUT interoperability:** current Nix HTTP store supports path upsert behavior, but the public manual does not fully specify wire-level response semantics as a standalone protocol contract; integration tests against the supported Nix versions are mandatory.
- **HIGH for merged-cache and publication requirements within this project:** directly specified in `PROJECT.md` and the normative local `NIP.md`.
- **MEDIUM for BUD-15–18 behavior:** the local NIP is detailed, but these upstream BUDs are proposed and may change before merge.

---
*Feature research for: nixstr-cache*
*Researched: 2026-08-12*
