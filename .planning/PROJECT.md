# nixstr-cache

## What This Is

`nixstr-cache` is a single-user background daemon that presents Nostr- and Blossom-published Nix caches to an unmodified Nix client through the standard HTTP binary-cache interface. It aggregates kind `17091` default-cache and kind `37091` named-cache publication events from a configured whitelist, resolves their BUD-18 Hashtrees, and exposes one merged cache with deterministic publisher priority.

When a signer is connected, the daemon also accepts streamed HTTP PUT uploads, updates one configured cache identity owned by that signer, uploads the resulting immutable Hashtree blobs to the signer's BUD-03 Blossom servers, and publishes the new signed cache-root event. The signer's writable cache is overlaid at the highest priority in the merged read view.

## Core Value

An unmodified Nix client can reliably read and publish a decentralized binary cache while the daemon preserves the trust, integrity, freshness, and bounded-resource guarantees defined by `NIP.md` without buffering large files or datasets in memory.

## Requirements

### Validated

(None yet — the repository currently contains a protocol draft and a Deno HTTP stub, not a working cache daemon.)

### Active

- [ ] Subscribe to and reactively maintain the latest valid kind `17091` and `37091` cache events for a configured, ordered whitelist of Nostr publishers.
- [ ] Treat `NIP.md` as the normative application protocol specification, including event validation, replaceable/addressable identity, expiration, freshness and rollback behavior, downgrade handling, Blossom discovery, and Nix-signature rules.
- [ ] Use Applesauce packages and their reactive/casting patterns for Nostr relay connections, event stores, queries, signer integration, and derived application state.
- [ ] Expose a single standard Nix HTTP binary-cache endpoint supporting GET and HEAD for `nix-cache-info`, `.narinfo`, and referenced NAR paths.
- [ ] Merge whitelisted caches in configured priority order, with the connected signer's writable cache first.
- [ ] For duplicate `.narinfo` paths, merge compatible signature fields; when non-signature fields conflict, serve the highest-priority record and emit a structured warning and metric.
- [ ] Stream Hashtree manifests, chunks, NARs, HTTP request bodies, HTTP responses, hashing, verification, encryption/decryption, and Blossom transfers with bounded memory use.
- [ ] Verify every Nostr signature and every fetched Blossom blob against its expected hash before decoding, caching, or serving it.
- [ ] Enforce the validation, traversal limits, redirect checks, outbound-network restrictions, signature filtering, and decompression bounds specified by `NIP.md`.
- [ ] Optionally use an operator-configured local Nostr relay and local Blossom server as read/write-through caches for events and verified immutable blobs.
- [ ] Keep write access disabled unless a supported signer is connected and the writable kind/cache identity is explicitly configured.
- [ ] Support both a NIP-46 remote signer and a protected local secret-key signer behind one signer abstraction.
- [ ] Accept streamed HTTP PUT uploads for the configured writable Nix cache and preserve the standard binary-cache path layout.
- [ ] Build immutable Hashtree updates without making incomplete store objects visible; referenced NAR data must be available before its `.narinfo` entry enters a published root.
- [ ] Debounce publication until five seconds of write inactivity, with a maximum delay of sixty seconds during sustained writes.
- [ ] Resolve the signer's BUD-03 server list, upload all newly referenced blobs, and publish only after at least one advertised server holds a complete reachable tree.
- [ ] Retry incomplete replication to the remaining BUD-03 Blossom servers asynchronously after publication.
- [ ] Publish the updated kind `17091` or `37091` event through the configured Nostr relays only after its referenced tree is retrievable, then update the merged read view reactively.
- [ ] Provide daemon configuration, structured logs, health/readiness information, and operational metrics sufficient to diagnose relay, Blossom, validation, conflict, replication, and publication failures.
- [ ] Provide automated protocol, streaming, integration, and end-to-end tests against local Nostr relay and Blossom test services.

### Out of Scope

- Graphical user interface — v1 is a headless background daemon configured and observed through daemon-oriented interfaces.
- Multi-user hosted tenancy — v1 targets one operator and one optional connected signer; per-user authentication and isolation are deferred.
- Arbitrary write targets selected per HTTP URL — v1 writes to one explicitly configured default or named cache identity.
- Replacing or extending the Nix client — compatibility is provided through the existing HTTP binary-cache protocol.
- Defining new Hashtree, Blossom, Nostr, or Nix formats — `NIP.md`, its referenced BUDs/NIPs, and the Nix binary-cache protocol are authoritative.
- Treating BUD-15 self-encryption as confidentiality or access control — it provides storage opacity only, as specified in `NIP.md`.
- Requiring every configured Blossom replica before publication — one complete advertised replica is sufficient; other replicas converge in the background.
- Persisting large cache contents in daemon memory — all large or unbounded data paths must remain streamed and resource-bounded.

## Context

The repository is effectively greenfield. `main.ts` is a minimal Deno `Deno.serve` hello-world handler, `deno.json` contains only a development task and standard assertion import, and no application architecture has been established. `NIP.md` is a detailed draft specification for publishing Nix cache Hashtree roots with kind `17091` replaceable events and kind `37091` addressable events.

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
- **Integrity**: Verify Nostr events and content hashes before selection or use; verify ciphertext before BUD-15 decryption and plaintext against its content key afterward.
- **Freshness**: Persist the greatest accepted `created_at` per cache identity, honor expiration, and do not silently roll back or downgrade a formerly signed identity to unsigned.
- **Compatibility**: Serve stock Nix's HTTP binary-cache paths and semantics; gateway validation supplements but does not replace Nix's own signature and hash checks.
- **Write authorization**: HTTP PUT is unavailable without a connected signer and configured owned identity; only that identity can be mutated.
- **Availability**: A new event may be published only after one advertised Blossom server has a complete reachable tree; failures elsewhere must remain visible and retryable.
- **Deployment**: Optimize v1 for a single-user local daemon while keeping subsystem boundaries suitable for a later shared gateway.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat the codebase as greenfield while retaining `NIP.md` as normative | Existing executable code is only a hello-world stub, while the protocol document contains the real domain design | — Pending |
| Present one merged HTTP binary cache | Gives stock Nix one substituter URL while allowing multiple decentralized publishers | — Pending |
| Resolve overlaps by configured whitelist order | Trust priority is an operator decision and is deterministic across requests | — Pending |
| Overlay the connected signer's cache at highest priority | Newly uploaded objects should be immediately available through the same substituter | — Pending |
| Merge only compatible `.narinfo` signatures | Repeatable signatures can be combined without inventing metadata; substantive conflicts cannot | — Pending |
| Serve priority winner and warn on incompatible `.narinfo` records | Keeps the cache available while making unexpected nondeterminism or publisher faults observable | — Pending |
| Write to one configured kind `17091` or `37091` identity | Keeps PUT authorization and publication behavior unambiguous in the single-user v1 | — Pending |
| Support NIP-46 and protected local-key signers | Covers key-isolated operation and simple local deployments through one interface | — Pending |
| Publish after 5 seconds quiet, no later than 60 seconds | Batches common Nix upload bursts without leaving sustained uploads unpublished indefinitely | — Pending |
| Require one complete advertised Blossom replica before publishing | Prevents announcing an unavailable root while tolerating partial server outages | — Pending |
| Use optional local relay and Blossom services as read/write-through caches | Reuses protocol-native services and avoids building a separate large-object cache into the daemon | — Pending |
| Build around Applesauce reactive casting | Aligns Nostr ingestion, derived cache selection, signer state, and publication updates with the required reactive architecture | — Pending |

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
*Last updated: 2026-08-12 after initialization*
