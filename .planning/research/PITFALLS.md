# Pitfalls Research

**Domain:** Single-user Deno/TypeScript gateway and writer bridging Nostr cache-root events, Blossom Hashtrees, and the Nix HTTP binary-cache protocol
**Researched:** 2026-08-12
**Confidence:** MEDIUM-HIGH — protocol rules are strongly supported by primary specifications; BUD-15 through BUD-18 are still proposed, so interoperability details require fixtures against the exact drafts adopted by this project.

## Critical Pitfalls

### Pitfall 1: Selecting Before Fully Validating Events

**What goes wrong:**
An invalid or attacker-shaped event wins the replaceable/addressable selection, pins an identity with a future timestamp, collapses distinct named caches, or changes winners across relays. Common mistakes include trusting relay ordering, comparing only `created_at`, accepting malformed `d`/`htree` tags, normalizing `d`, or failing the NIP-01 equal-timestamp lowest-ID tie-break.

**Why it happens:**
Relay stores often expose a convenient “latest event” abstraction, making validation and selection appear to be one operation. NIP-01 also warns that relay behavior can differ; relay output is candidate data, not a selection oracle.

**How to avoid:**
Build one pure conformance pipeline: verify canonical event ID and Schnorr signature; enforce whitelist, kind, identity, future-time limit, expiration, exact tag cardinality and encodings; derive the raw-byte identity; then compare `(created_at DESC, id ASC)`. Apply the same function to stored events, live events, and local publications. Never mutate accepted state until all checks pass.

**Warning signs:**
Different roots after relay reorder; events with duplicate `htree`/`d` tags appear in state; a far-future event remains selected; kind `37091` names collide after case-folding; tests cover only one relay response order.

**Phase to address:**
Phase 1 — protocol primitives and adversarial event-selection fixtures, before any reactive relay integration.

---

### Pitfall 2: Treating Freshness, Rollback, Expiration, and Downgrade as Ephemeral State

**What goes wrong:**
A restart forgets the greatest accepted `created_at` or that an identity was previously signed. A withholding relay can then roll the cache back, or a newer event without `nixSigKey` can silently downgrade it to unsigned. Expired events may remain active because NIP-40 asks relays to delete them but does not guarantee deletion.

**Why it happens:**
The selected root is replaceable network state, while immutable blobs are safe to cache indefinitely. Storing both with the same cache policy erases the distinction between integrity and freshness.

**How to avoid:**
Persist per raw cache identity: high-water `created_at`, tie-break event ID at that timestamp, whether any accepted state declared signing keys, explicit downgrade-consent state, selected event, and last freshness check. Commit this metadata atomically before exposing a newly selected root. Re-evaluate expiration on reads and timers, not only on arrival. Never lower the high-water mark during ordinary cache eviction.

**Warning signs:**
Restart changes the winner without a newer event; an unsigned event becomes active automatically; immutable blob cleanup also deletes rollback metadata; expiration is checked only in a relay callback; “clear cache” silently clears security history.

**Phase to address:**
Phase 2 — durable selection state and restart/crash tests, before serving cache results.

---

### Pitfall 3: Incomplete SSRF Defense Around Publisher-Controlled Blossom URLs

**What goes wrong:**
The daemon fetches loopback, private, link-local, metadata, or Unix-adjacent services through a crafted hostname, a DNS answer that changes between validation and connection, an IPv4-mapped IPv6 address, or a redirect. Deno `fetch` follows redirects by default, so validating only the initial URL is insufficient.

**Why it happens:**
URL syntax validation is mistaken for network-target validation. A preflight DNS lookup followed by an unrelated `fetch` introduces a time-of-check/time-of-use window because the fetch stack may resolve again.

**How to avoid:**
Centralize all untrusted outbound HTTP in one fetcher. Permit only HTTP(S), reject userinfo, normalize hosts and IP representations, resolve every address, enforce an operator policy on every result, and bind the actual connection to the approved address while preserving Host/SNI. Use `redirect: "manual"`; resolve and validate each `Location`, cap redirects, requests, bytes, and time. Revalidate BUD-03 and event URLs equally; only explicitly configured local endpoints bypass public-address restrictions.

**Warning signs:**
Direct calls to `fetch()` outside the hardened client; `redirect: "follow"`; hostname allow checks without resolved-IP logging; tests omit rebinding and redirect-to-private cases; local cache exceptions are host-pattern wildcards.

**Phase to address:**
Phase 3 — hardened blob transport, with controllable DNS and redirect integration tests before Hashtree traversal.

---

### Pitfall 4: Decoding, Decrypting, Caching, or Forwarding Before Hash Verification

**What goes wrong:**
Hostile bytes reach manifest parsers, disk caches, or clients before their content address is proven. For BUD-15, checking plaintext only misses ciphertext-address integrity; checking ciphertext only misses the expected content key. Range/chunk verification can falsely appear sufficient when the complete assembled blob was never hashed.

**Why it happens:**
Streaming pipelines encourage useful work as bytes arrive, and encryption adds two identifiers with different meanings. Developers may also equate authenticated event selection with trustworthy Blossom transport.

**How to avoid:**
Stage every fetched blob in bounded temporary storage while incrementally hashing. For plaintext: verify complete bytes against the requested SHA-256, then atomically promote and parse. For BUD-15: verify ciphertext address, derive/decrypt locally without transmitting keys, verify plaintext against the expected content key, then parse/promote. Never stream unverified upstream bytes directly to Nix. Delete partials on abort and make verified status part of the blob-store API type/state.

**Warning signs:**
Manifest JSON parsing occurs in a network transform; cache entries lack verified metadata; range hashes are treated as the blob hash; decryption starts before ciphertext verification; the root key appears in logs or URLs.

**Phase to address:**
Phase 3 — verified immutable blob store and crypto pipeline, before resolver or HTTP serving.

---

### Pitfall 5: Traversing a DAG as a Tree Without Global Budgets

**What goes wrong:**
A validly signed publisher creates extreme fanout or shared subgraphs that cause exponential repeated work, disk/network amplification, stack exhaustion, or unbounded decoded metadata. Content addressing prevents true cycles but does not prevent path explosion or oversized manifests.

**Why it happens:**
Cycle detection alone seems sufficient, and per-request limits miss amplification across nested nodes. Recursive implementations hide both depth and aggregate cost.

**How to avoid:**
Use iterative traversal with a visited set keyed by the correct content identifier, and a single budget object covering manifest bytes, depth, links per manifest, unique nodes, total decoded bytes, requested servers, redirects, and wall time. Validate declared link size before/during transfer and abort on overrun. Cache only verified nodes, but charge resource budgets even for cache hits where decoding work remains.

**Warning signs:**
Recursive descent; no total-node counter; repeated fetch/decode of the same hash; only maximum file-size limits; memory or requests grow with the number of paths rather than unique nodes.

**Phase to address:**
Phase 4 — bounded Hashtree resolver, proved with adversarial shared-DAG and limit-boundary fixtures.

---

### Pitfall 6: “Streaming” APIs That Secretly Buffer or Ignore Backpressure

**What goes wrong:**
Large NARs, PUT bodies, manifests, or fanout batches are accumulated via `arrayBuffer()`, `bytes()`, `blob()`, `text()`, unrestricted `tee()`, or fire-and-forget writes. Slow Nix clients or Blossom servers then cause heap growth, file-descriptor exhaustion, and abandoned upstream transfers.

**Why it happens:**
Deno exposes both whole-body convenience methods and Web Streams. A function accepting `ReadableStream` can still buffer internally, and `tee()` permits the slower branch to accumulate data.

**How to avoid:**
Define end-to-end streaming contracts with explicit byte limits and cancellation. Use awaited `pipeTo` or writers whose `ready`/`write` promises are honored; use bounded disk spools when a second pass is required for verify-then-serve or multi-replica upload. Propagate downstream cancellation through `AbortSignal`, close handles in `finally`, and test with multi-gigabyte synthetic streams plus deliberately slow sinks while asserting bounded RSS.

**Warning signs:**
Any large-data path calls a whole-body method; unawaited stream writes; unlimited concurrent pipes; `tee()` on NAR data; client disconnects leave upstream network traffic active; heap tracks object size.

**Phase to address:**
Phase 3 for primitives, then enforce as a release gate in read and write phases.

---

### Pitfall 7: Misinterpreting `.narinfo` Hash and Signature Semantics

**What goes wrong:**
The gateway validates the wrong bytes, rewrites signed fields, accepts a `Sig` by matching key name rather than Ed25519 key bytes, leaks unverifiable signatures, or assumes the Nostr signature replaces Nix policy. `FileHash` covers downloaded/compressed bytes; `NarHash` covers the NAR serialization after decompression; `Sig` is repeatable; Nix’s fingerprint semantics must remain exact.

**Why it happens:**
There are two trust chains and two hashes. NIP.md deliberately matches declared keys by bytes, while stock Nix configuration selects trusted keys by name. A generic key-value parser may also overwrite repeatable fields or normalize data before verification.

**How to avoid:**
Use a lossless bounded parser with explicit repeatable `Sig` handling. Verify each signature according to Nix’s official fingerprint algorithm against decoded key bytes declared by the selected event; strip failures without invalidating an otherwise valid record. Preserve all non-signature fields byte-semantically. Verify `FileHash`/`FileSize` while transferring compressed bytes and, if decompressing, cap output at `NarSize` then verify `NarHash`. Keep gateway publisher trust and Nix client key trust distinct in configuration and metrics.

**Warning signs:**
Signatures stored in a map with one value; comparison by `name:` prefix or domain; changed whitespace/order before signature verification; only one hash is tracked; unsigned cache works in tests only because Nix is globally trusted.

**Phase to address:**
Phase 5 — Nix compatibility layer, with golden fixtures produced/consumed by real Nix.

---

### Pitfall 8: Synthesizing Conflicting Merged Records

**What goes wrong:**
Two publishers provide the same `.narinfo` path with different `StorePath`, `URL`, hashes, sizes, references, compression, deriver, or CA fields, and the aggregator combines them into a record no publisher signed. Even harmless reserialization can obscure the conflict. Merging signatures across incompatible fingerprints creates false attribution.

**Why it happens:**
The product promise says “merged cache,” and duplicates usually agree, encouraging field-by-field union. But only repeatable compatible signature material is safely combinable.

**How to avoid:**
Canonicalize only for comparison using a formally defined compatibility key of every non-`Sig` field; retain an original priority-winner representation for serving. Merge only signatures that verify and cover the identical Nix fingerprint. On any substantive conflict, serve the complete highest-priority record unchanged except required signature filtering, and emit structured publisher/root/path diagnostics plus a metric.

**Warning signs:**
The merge function accepts arbitrary fields; output contains fields sourced from multiple records; conflicts are debug-only logs; priority changes within a request; signature union occurs before fingerprint comparison.

**Phase to address:**
Phase 6 — deterministic aggregate view, after Nix parsing/signature semantics are locked.

---

### Pitfall 9: Making Partial PUT Batches Visible or Losing Them Across Crashes

**What goes wrong:**
A `.narinfo` enters the pending/published tree before its NAR or references are durable; a crash leaves an index pointing at absent temporary data; restart loses accepted uploads; concurrent PUTs race root construction; the five-second debounce starves forever under sustained writes or publishes multiple overlapping batches.

**Why it happens:**
HTTP success, local durability, tree membership, remote replication, and Nostr publication are distinct commit points. Treating them as one asynchronous callback produces impossible intermediate states.

**How to avoid:**
Persist uploads to content-addressed staging with fsync/atomic rename semantics appropriate to the platform, verify path/hash/size metadata, and append an idempotent journal entry before returning the chosen success status. Run one serialized publication coordinator. Admit `.narinfo` only after its NAR and required references are durable. Snapshot a batch at 5 seconds idle or 60 seconds maximum, construct a new immutable root from a committed base, and recover journals/temp files deterministically after kill-at-every-boundary tests.

**Warning signs:**
In-memory pending maps are authoritative; timers directly publish; two root builders run concurrently; `.narinfo` PUT order determines correctness; restart drops uploads; HTTP 2xx precedes any durable state without that contract being explicit.

**Phase to address:**
Phase 7 — durable writer transaction and batching state machine, before any remote publication.

---

### Pitfall 10: Publishing Before a Complete Advertised Replica Exists

**What goes wrong:**
The signed event becomes visible while some newly reachable blob is absent, upload responses were trusted without hash-scoped verification, or the “one complete server” guarantee is accidentally satisfied by unioning partial coverage across several servers. Clients select an irretrievable latest root and persistent rollback rules prevent an easy fallback.

**Why it happens:**
BUD-03 gives an ordered list, not a transaction. Parallel replication and event publication look like independent availability optimizations, but their ordering is a correctness invariant.

**How to avoid:**
Resolve and freeze the signer’s latest valid kind `10063` list for the batch. Compute the complete reachable-hash set. For each advertised server, upload missing blobs with bounded concurrency and verify success via protocol response plus hash-addressed HEAD/GET policy. Mark a server complete only when that same server has the entire set. Publish only after one is complete; record per-server deficits durably and retry remaining replicas asynchronously. Treat relay acceptance acknowledgements separately from data availability and retain a republish queue.

**Warning signs:**
Publication and replication promises race; success counter is per blob rather than per server; no reachable-set audit; server list changes midway through a batch; event is locally selected before any complete replica is confirmed.

**Phase to address:**
Phase 8 — replication/publication saga, after the crash-safe writer exists.

---

### Pitfall 11: Incorrect NIP-46 Identity and Connection Lifecycle

**What goes wrong:**
The daemon confuses the remote-signer transport key with the user pubkey, accepts a spoofed connection response, reuses a one-time secret, keeps PUT enabled after disconnect, signs an unauthorized kind/identity, or hangs publication indefinitely on a dead request.

**Why it happens:**
NIP-46 is asynchronous RPC over relays, not a durable local key. Connection establishment, permissions, user-key discovery, request correlation, timeout, reconnection, and revocation are separate states.

**How to avoid:**
Model signer states explicitly: disabled, connecting, authenticated, ready-for-configured-identity, degraded, disconnected. Validate the returned connection secret, distinguish remote-signer key from `get_public_key()` result, request least-privilege `sign_event` permissions for kinds `17091`/`37091`, correlate and expire every request, and fail closed on disconnect or identity change. Bind pending writes to the expected user pubkey and require revalidation before publication. Protect a local secret signer behind the same capability interface without persisting plaintext secrets.

**Warning signs:**
One boolean `signerConnected`; PUT route checks only startup configuration; no request timeout/correlation table; signer pubkey can change without invalidating pending batches; bunker secret appears in logs; broad sign-anything permission.

**Phase to address:**
Phase 7 — signer capability lifecycle before enabling PUT, then fault injection in Phase 8.

---

### Pitfall 12: Reactive Subscription Leaks and Stale Async Races

**What goes wrong:**
Relay reconnects or configuration changes create duplicate subscriptions, repeated event processing, socket/resource leaks, or stale asynchronous Hashtree resolutions that overwrite newer selected roots. An EOSE snapshot and live events can also race initialization.

**Why it happens:**
Applesauce/RxJS makes composition concise, but every `.subscribe()` owns a lifecycle. Flattening operators have different cancellation semantics, and cancellation of an observable does not automatically make every underlying fetch/parse side effect obsolete.

**How to avoid:**
Have one lifecycle owner per configured identity and derive relay filters declaratively. Use shared/ref-counted streams where appropriate, explicit teardown (`takeUntil`/unsubscribe), stable deduplication by event ID, and a generation token or abortable `switchMap` so only the current selected event can commit resolved state. Reconcile stored and live candidates through the same reducer. Instrument active subscriptions, sockets, in-flight resolutions, and commits rejected as stale.

**Warning signs:**
Nested `.subscribe()` calls; subscription count increases after config reload/reconnect; the same event produces repeated work; an older slow root replaces a newer fast root; tests stop at EOSE and omit simultaneous live delivery.

**Phase to address:**
Phase 2 — reactive state engine, with churn/race tests; re-verify in all later integration phases.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep freshness/downgrade history only in memory | Fast prototype | Security regression on every restart | Never after event selection exists |
| Call global `fetch` directly | Less wrapper code | SSRF policy bypass and inconsistent limits | Only for compile-time fixed test URLs |
| Buffer bodies for hashing | Simple crypto code | OOM on real NARs and no backpressure | Only bounded protocol metadata below an enforced small limit |
| Use recursive Hashtree traversal | Readable first implementation | Stack overflow and hidden aggregate work | Only in fixture tooling, never daemon paths |
| Treat EventStore winner as authoritative | Less selection code | Relay-dependent validation/rollback behavior | Never |
| Publish from debounce timer callback | Minimal batching code | Concurrent roots and crash ambiguity | Never |
| Require all replicas before publication | Simple success rule | One bad server blocks all writes indefinitely | Never; require one complete server and retry others |
| Merge parsed `.narinfo` maps | Easy union | Lost repeated fields and synthetic unsigned metadata | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Nostr relays | Assuming relay replacement and ordering are consistent | Fetch candidates from multiple relays, validate locally, apply deterministic tie-break and persisted high-water state |
| NIP-40 | Treating relay deletion as expiration enforcement | Check expiration in the daemon at acceptance and use time |
| Blossom BUD-01 | Trusting successful HTTP status or server descriptor | Hash complete received bytes against the requested address before use |
| Blossom BUD-03 | Treating ordered servers as a single replicated store | Track completeness per server and preserve publisher order for attempts |
| BUD-15–18 drafts | Assuming current libraries share identical encodings | Pin the adopted draft semantics and maintain cross-implementation golden fixtures |
| Nix client | Assuming gateway validation disables Nix checks | Preserve Nix HTTP, signature, `FileHash`, and `NarHash` semantics exactly |
| NIP-46 | Enabling writes on transport connection alone | Enable only after authenticated connect, `get_public_key`, permission, and configured-identity checks |
| Applesauce/RxJS | Creating subscriptions imperatively per callback | Compose one owned pipeline with teardown and stale-result cancellation |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Whole-body convenience methods | Heap spikes and long GC pauses | Stream to bounded spool while hashing | At the first NAR larger than available heap headroom |
| Unbounded parallel Blossom attempts | Socket storms and publisher-directed traffic amplification | Cap servers (NIP recommends 10), per-host and global concurrency, time, redirects | A single hostile event with many server tags |
| Path-based rather than hash-based DAG walk | Duplicate downloads/decodes | Global visited set and memoized verified nodes | Shared fanout can grow exponentially in path count |
| `ReadableStream.tee()` to hash and serve | Slow branch buffers without limit | Verify to disk/CAS first, then serve; or use one bounded transform pipeline where safe | Any sustained sink speed mismatch |
| Rebuilding the full tree per PUT | Write bursts consume CPU/I/O and publish churn | Journal changes and batch at 5s idle/60s max through one coordinator | Normal Nix copy/upload bursts |
| Unbounded reactive replay/caches | Resident state grows with historical events | Retain selected/security metadata plus bounded diagnostics; immutable blobs live on disk | Long-running daemon across many updates |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Validating hostname but not connected IP | DNS rebinding reaches internal services | Resolve, classify every answer, and bind connection to approved address; repeat per redirect |
| Auto-following redirects | Public URL pivots to private target | Manual redirects with full URL/DNS policy and depth limit |
| Parsing before hash verification | Malformed unauthenticated bytes attack parsers/cache | Stage, hash, verify, then decode and promote |
| Logging `nhash` decryption or bunker secrets | Public logs disclose operational secrets/tokens | Structured redaction and secret-bearing type wrappers |
| Calling BUD-15 private/confidential | Operators rely on nonexistent secrecy | Document storage opacity only; all published cache contents are public |
| Clearing signed-history on cache reset | Silent downgrade becomes possible | Separate immutable-cache eviction from security-state reset with explicit consent |
| Trusting Nostr publisher as Nix signing key | False substitute attribution | Keep secp256k1 publisher trust and Ed25519 Nix key policy distinct |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reporting every miss as 404 | User cannot distinguish absent path, unavailable publisher, rejected event, or integrity failure | Keep HTTP compatibility while exposing reason-coded logs/metrics and health diagnostics |
| Silent conflict resolution | Operator misses nondeterminism or publisher compromise | Serve deterministic winner and emit structured warning with both publishers and roots |
| PUT endpoint exists while signer is unusable | Nix uploads fail late or appear accepted but cannot publish | Return a clear unavailable/authorization response and readiness reason before consuming a large body |
| Hidden replication lag | Operator assumes all advertised servers are healthy | Expose complete replica, per-server backlog, retries, and last published root |
| Generic “invalid cache” error | Downgrade, rollback, expiry, and corruption look identical | Use distinct machine-readable failure classes without leaking secrets |

## "Looks Done But Isn't" Checklist

- [ ] **Event selection:** Equal timestamps, malformed duplicate tags, raw-byte `d` identities, future dates, expiration, and invalid signatures have adversarial fixtures.
- [ ] **Persistence:** Restart and power-loss tests preserve high-water timestamps and signed-history independently of blob eviction.
- [ ] **SSRF:** Redirect-to-private, DNS rebinding, IPv4-mapped IPv6, mixed DNS answers, and configured-local exceptions are tested against the actual connection path.
- [ ] **Integrity:** No parser/cache/response sees bytes before complete ciphertext/plaintext verification in the required order.
- [ ] **Traversal:** All limits are aggregate, configurable, observable, and tested exactly at and one unit beyond boundaries.
- [ ] **Streaming:** Slow-sink and cancellation tests demonstrate bounded RSS and no lingering transfers/handles.
- [ ] **Nix compatibility:** Real Nix accepts golden `.narinfo` and NAR responses; bad `FileHash`, `NarHash`, size, and `Sig` cases fail at the intended layer.
- [ ] **Merge:** Only compatible signatures combine; all substantive conflicts serve the configured priority winner and increment metrics.
- [ ] **Writer:** Kill-at-every-commit-point recovery never exposes a `.narinfo` before its durable NAR/references.
- [ ] **Batching:** Five-second idle and sixty-second maximum deadlines work under sustained concurrent PUTs with one publication coordinator.
- [ ] **Replication:** One individual advertised server, not a union, holds every reachable blob before event signing/publication.
- [ ] **NIP-46:** Spoofed secrets, disconnects, timeouts, signer identity changes, and insufficient permissions fail closed and disable PUT.
- [ ] **Reactivity:** Subscription/socket counts return to baseline after relay churn and configuration reload; stale root resolutions cannot commit.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Accepted rollback/downgrade | HIGH | Disable identity, restore durable security metadata from backup/audit trail, query trusted relays, require explicit operator confirmation before accepting any lower/unsigned state |
| Published incomplete root | HIGH | Complete at least one advertised replica immediately, then republish a new root if content set changed; do not roll clients back silently |
| Corrupt/unverified local blob | MEDIUM | Quarantine by hash, invalidate dependent resolved views, refetch from another source, reverify, and audit whether any response was served |
| Partial PUT batch after crash | MEDIUM | Replay journal, verify staged CAS blobs, discard orphan partials, reconstruct the pending snapshot, and resume replication idempotently |
| Reactive leak/race | LOW-MEDIUM | Tear down the identity pipeline, bump generation, rebuild from durable selected state, and confirm active subscription metrics return to baseline |
| `.narinfo` merge bug | HIGH | Disable signature merging, serve priority originals with filtering, regenerate affected cache view, and test records against real Nix before restoring merge |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Validate before deterministic selection | Phase 1: protocol primitives | Property tests over candidate order plus official NIP-01 tie fixtures |
| Durable rollback/downgrade/expiration | Phase 2: reactive durable state | Restart, eviction, time-travel, and downgrade-consent tests |
| Subscription leaks and stale races | Phase 2: reactive durable state | Relay churn test with stable resource counts and generation-gated commits |
| SSRF/DNS/redirect bypass | Phase 3: verified transport | Controlled DNS and multi-hop redirect integration suite |
| Hash/decrypt ordering | Phase 3: verified transport | Instrumented tests prove parse/cache/serve occur only after both required hashes |
| Streaming/backpressure | Phase 3 foundation; all later phases | Large-stream slow-sink RSS and cancellation assertions |
| Unbounded DAG traversal | Phase 4: Hashtree resolution | Shared-subgraph amplification and every-limit boundary fixtures |
| Nix hash/signature semantics | Phase 5: Nix HTTP compatibility | Golden `.narinfo` plus end-to-end stock Nix substitution |
| Conflicting merged records | Phase 6: aggregate view | Permutation tests prove deterministic winner and compatible-signature-only merge |
| Crash-inconsistent PUT batching | Phase 7: transactional writer | Fault injection at every journal/fsync/root-snapshot boundary |
| NIP-46 lifecycle errors | Phase 7: transactional writer | Spoof/disconnect/timeout/permission/identity-change tests |
| Replication/publication misordering | Phase 8: publish saga | Event publication spy asserts one server has complete reachable set first |

## Sources

- [Project NIP draft: Nix Cache Hashtree Roots](../../NIP.md) — normative project protocol; HIGH confidence for project requirements.
- [NIP-01: Basic protocol flow, event validation, subscriptions, replaceable/addressable events](https://github.com/nostr-protocol/nips/blob/master/01.md) — primary specification; MEDIUM confidence per research classification seam, cross-checked with project NIP.
- [NIP-40: Expiration Timestamp](https://github.com/nostr-protocol/nips/blob/master/40.md) — primary specification; MEDIUM confidence.
- [NIP-46: Nostr Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md) — primary specification; MEDIUM confidence.
- [Blossom protocol and BUD index](https://github.com/hzrd149/blossom) and [BUD-03 User Server List](https://github.com/hzrd149/blossom/blob/master/buds/03.md) — primary specifications; MEDIUM confidence.
- Proposed Hashtree specifications: [BUD-15](https://github.com/hzrd149/blossom/pull/104), [BUD-16](https://github.com/hzrd149/blossom/pull/105), [BUD-17](https://github.com/hzrd149/blossom/pull/106), [BUD-18](https://github.com/hzrd149/blossom/pull/107) — primary proposals; MEDIUM confidence and a phase-specific research flag because drafts may change.
- [Nix 2.35 binary-cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [`.narinfo` format](https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html) — official manual; MEDIUM confidence per seam.
- [Deno Fetch API](https://docs.deno.com/api/web/fetch/), [Deno Streams API](https://docs.deno.com/api/web/streams/), and [Deno Web Platform differences](https://docs.deno.com/runtime/reference/web_platform_apis/) — official runtime documentation; MEDIUM confidence.
- [Applesauce introduction and reactive architecture](https://applesauce.build/introduction/getting-started.html) — official project documentation; MEDIUM confidence.

---
*Pitfalls research for: nixstr-cache*
*Researched: 2026-08-12*
