# nixstr-cache

## What This Is

`nixstr-cache` is a single-user background daemon that presents Nostr- and Blossom-published Nix caches to an unmodified Nix client through the standard HTTP binary-cache interface. It aggregates kind `17091` default-cache and kind `37091` named-cache publication events from a configured whitelist, resolves their BUD-18 Hashtrees, and exposes one merged cache with deterministic publisher priority.

When a signer is connected, the daemon also accepts streamed HTTP PUT uploads, updates one configured cache identity owned by that signer, uploads the resulting immutable Hashtree blobs to the signer's BUD-03 Blossom servers, and publishes the new signed cache-root event. The signer's writable cache is overlaid at the highest priority in the merged read view.

## Core Value

An unmodified Nix client can reliably read and publish a decentralized binary cache while the daemon preserves the trust, integrity, freshness, and bounded-resource guarantees defined by `NIP.md` without buffering large files or datasets in memory.

## Requirements

### Validated

- ✓ Reactive validated kind `17091`/`37091` selection for an ordered identity whitelist — v1.0.
- ✓ Normative `NIP.md` validation, freshness, rollback, downgrade, discovery, and signature behavior — v1.0.
- ✓ Applesauce EventStore, custom model, relay, and signer composition — v1.0.
- ✓ Stock-Nix GET/HEAD cache metadata, Narinfo, and NAR interface — v1.0.
- ✓ Deterministic merged publisher priority with signer-first writable overlay — v1.0.
- ✓ Full-semantic Narinfo agreement, signature occurrence union, and typed conflict reporting — v1.0.
- ✓ Backpressured bounded streaming across Hashtrees, NARs, HTTP, hashing, staging, and Blossom — v1.0.
- ✓ Cryptographic Nostr-event and content-addressed Blossom verification before use — v1.0.
- ✓ Bounded traversal, pinned-address SSRF controls, manual redirect validation, and deadlines — v1.0.
- ✓ Optional verified local relay and Blossom read/write-through caches — v1.0.
- ✓ Exact signer-owned write gate with read-only failure behavior — v1.0.
- ✓ NIP-46 and protected local-key signers behind one capability — v1.0.
- ✓ Durable bounded standard binary-cache PUT staging — v1.0.
- ✓ Dependency-closed immutable overlay and pending Hashtree construction — v1.0.
- ✓ Durable five-second quiet / sixty-second maximum batching — v1.0.
- ✓ Complete same-server Blossom availability proof before signing — v1.0.
- ✓ Durable asynchronous replica and relay repair after promotion — v1.0.
- ✓ Exact event signing, configured-relay acknowledgement, and normal reactive admission — v1.0.
- ✓ Validated configuration, secret-safe typed diagnostics, and independent health axes — v1.0.
- ✓ Protocol, hostile-input, restart, lifecycle, NIP-46, and two-generation stock-Nix E2E coverage — v1.0.

### Active

- Human-readable console rendering for MVP debugging is captured as backlog Phase 999.1; internal diagnostics remain typed and secret-safe.

### Out of Scope

- Graphical user interface — v1 is a headless background daemon configured and observed through daemon-oriented interfaces.
- Multi-user hosted tenancy — v1 targets one operator and one optional connected signer; per-user authentication and isolation are deferred.
- Arbitrary write targets selected per HTTP URL — v1 writes to one explicitly configured default or named cache identity.
- Replacing or extending the Nix client — compatibility is provided through the existing HTTP binary-cache protocol.
- Defining new Hashtree, Blossom, Nostr, or Nix formats — `NIP.md`, its referenced BUDs/NIPs, and the Nix binary-cache protocol are authoritative.
- Treating BUD-15 self-encryption as confidentiality or access control — it provides storage opacity only, as specified in `NIP.md`.
- BUD-15 self-encrypted Hashtree reads and writes — defer until the plaintext read/write path is interoperable and the draft's bounded-memory implementation has been validated.
- Requiring every configured Blossom replica before publication — one complete advertised replica is sufficient; other replicas converge in the background.
- Persisting large cache contents in daemon memory — all large or unbounded data paths must remain streamed and resource-bounded.
- Production-grade operational hardening — metrics, quotas, exhaustive crash-injection, and advanced readiness/drain behavior are deferred; v1 retains structured logs and basic health reporting.

## Context

v1.0 is a working Deno/TypeScript daemon with roughly 15,000 lines across production code, fixtures, and tests. `main.ts` validates configuration before side effects and composes reactive Nostr selection, bounded verified Blossom/Hashtree reads, the stock-Nix HTTP API, signer-gated durable writes, and an availability-gated publication saga. `NIP.md` remains the normative specification for kind `17091` replaceable and kind `37091` addressable cache roots.

The daemon bridges three ecosystems:

- Nostr provides authenticated, replaceable pointers to immutable cache roots, publisher relay discovery, expiration, and BUD-03 Blossom server lists.
- Blossom stores content-addressed Hashtree manifests and file blobs and remains an untrusted transport; all bytes are accepted only after hash verification.
- Nix consumes the conventional HTTP binary-cache layout and independently enforces its NAR hashes and configured signing-key policy.

Read aggregation produces one logical cache. The configured whitelist order is authoritative when publishers overlap. Because Nix store objects are content-addressed and builds are expected to be deterministic, duplicates should ordinarily agree. Compatible `.narinfo` records may differ only in repeatable signature material and can be combined; substantive disagreement is treated as an observable publisher conflict rather than silently synthesized.

Write processing is transactional at publication boundaries. PUTs may arrive as a burst, so accepted files are streamed into content-addressed storage and accumulated into a pending tree update. Publication occurs after five quiet seconds or at sixty seconds of continuous activity. Before signing the event, the daemon ensures at least one BUD-03-advertised Blossom server contains every blob reachable from the new root. The signed root event is therefore never intentionally published ahead of its data.

Local cache URLs are optional infrastructure rather than an embedded database requirement. A local relay stores and serves observed or newly published events. A local Blossom cache stores verified upstream blobs and locally produced blobs. Immutable manifests and blobs may be cached indefinitely; selected mutable events retain the freshness rules from `NIP.md`.

## Constraints

- **Protocol**: `NIP.md` is normative for cache publication and resolution — implementation choices must not weaken its MUST/MUST NOT requirements.
- **Runtime**: Build on the existing Deno/TypeScript project unless later research proves a blocking incompatibility — the repository is already initialized for Deno.
- **Nostr stack**: Use Applesauce packages and examples, especially reactive stores, casts, and observable composition — cache state should update from streams rather than imperative polling snapshots.
- **Streaming**: Avoid whole-file and whole-dataset buffering — hashing, upload, download, verification, tree traversal, and HTTP serving must use streams with backpressure.
- **Resource safety**: Bound manifest size, depth, links per node, total visited nodes, decoded bytes, redirect depth, server attempts, and decompressed output — hostile signed publishers and hostile transports are within the threat model.
- **Network safety**: Re-check SSRF restrictions after DNS resolution and on every redirect for publisher-provided URLs; operator-configured local services may be explicitly allowed.
- **Integrity**: Verify Nostr events and content hashes before selection or use; v1 rejects BUD-15 self-encrypted roots as unsupported.
- **Freshness**: Persist the greatest accepted `created_at` per cache identity, honor expiration, and do not silently roll back or downgrade a formerly signed identity to unsigned.
- **Compatibility**: Serve stock Nix's HTTP binary-cache paths and semantics; gateway validation supplements but does not replace Nix's own signature and hash checks.
- **Write authorization**: HTTP PUT is unavailable without a connected signer and configured owned identity; only that identity can be mutated.
- **Availability**: A new event may be published only after one advertised Blossom server has a complete reachable tree; failures elsewhere must remain visible and retryable.
- **Deployment**: Optimize v1 for a single-user local daemon while keeping subsystem boundaries suitable for a later shared gateway.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat the codebase as greenfield while retaining `NIP.md` as normative | Existing executable code was only a hello-world stub, while the protocol document contained the domain design | ✓ Good — v1.0 shipped against the normative protocol |
| Present one merged HTTP binary cache | Gives stock Nix one substituter URL while allowing multiple decentralized publishers | ✓ Good — stock-Nix E2E verified |
| Resolve overlaps by configured whitelist order | Trust priority is an operator decision and is deterministic across requests | ✓ Good — provenance remains snapshot-pinned |
| Overlay the connected signer's cache at highest priority | Newly uploaded objects should be immediately available through the same substituter | ✓ Good — generation leases protect concurrent reads |
| Merge only compatible `.narinfo` signatures | Repeatable signatures can be combined without inventing metadata; substantive conflicts cannot | ✓ Good — full semantic matrix tested |
| Serve priority winner and warn on incompatible `.narinfo` records | Keeps the cache available while making unexpected nondeterminism or publisher faults observable | ✓ Good — typed redacted conflicts tested |
| Write to one configured kind `17091` or `37091` identity | Keeps PUT authorization and publication behavior unambiguous in the single-user v1 | ✓ Good — exact ownership enforced |
| Support NIP-46 and protected local-key signers | Covers key-isolated operation and simple local deployments through one interface | ✓ Good — both signer paths tested |
| Publish after 5 seconds quiet, no later than 60 seconds | Batches common Nix upload bursts without leaving sustained uploads unpublished indefinitely | ✓ Good — deadlines survive restart |
| Require one complete advertised Blossom replica before publishing | Prevents announcing an unavailable root while tolerating partial server outages | ✓ Good — hostile split-replica tests pass |
| Use optional local relay and Blossom services as read/write-through caches | Reuses protocol-native services and avoids building a separate large-object cache into the daemon | ✓ Good — auxiliary forwarding is outside the promotion barrier |
| Build around Applesauce reactive casting | Aligns Nostr ingestion, derived cache selection, signer state, and publication updates with the required reactive architecture | ✓ Good — durable admission precedes EventStore visibility |
| Defer BUD-15 self-encrypted Hashtrees | Ship the plaintext interoperability path first while BUD-15 remains a moving proposal with unresolved bounded-streaming details | ✓ Good — v1 rejects encrypted roots explicitly |
| Keep v1 operations minimal | Prioritize functional read/write behavior; retain typed logs and health while deferring advanced operations | ✓ Good — MVP diagnostics and health shipped |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-12 after v1.0 milestone*
