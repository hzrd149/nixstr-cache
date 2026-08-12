# Phase 2: Deterministic Merged Read Cache - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Mode:** Autonomous recommendations accepted by delegated authority

<domain>
## Phase Boundary

Generalize the verified Phase 1 read path from one selected cache identity to an ordered set of exact trusted default and named identities, expose their union through the same stock-Nix HTTP endpoint, report semantic overlap conflicts without hiding them, and optionally reuse only verified immutable blobs through an operator-configured local Blossom cache. Signer-authorized PUT ingestion and publication remain Phase 3 and Phase 4 work.

</domain>

<decisions>
## Implementation Decisions

### Identity and Priority Model
- Treat the ordered configured cache-identity list as the sole priority source; relay arrival order, event timestamp across different identities, and lookup latency never change publisher priority.
- Accept raw identities only in canonical `17091:<pubkey>:` or `37091:<pubkey>:<exact-d>` form. Preserve exact named-cache `d` values and reject duplicates during configuration validation.
- Maintain one independently freshness-checked selected root per configured identity, then expose an immutable ordered snapshot of all currently available identities through an Applesauce reactive model.
- Expiration or withdrawal of one identity removes only that layer and does not roll another identity backward.

### Duplicate Narinfo Resolution
- Resolve the requested `.narinfo` against every available layer in priority order using one request-captured merged snapshot.
- Compare parsed non-signature semantic fields canonically. Records that agree contribute a stable union of syntactically valid `Sig` lines while preserving the highest-priority record's scalar field encoding/order.
- Deduplicate identical signature lines byte-for-byte and append lower-priority unique signatures in stable publisher and record order.
- On any semantic disagreement, serve the complete highest-priority record unchanged and emit one structured conflict diagnostic containing the store-path hash, winning/losing identities, and differing field names; do not leak record contents or silently merge.

### Conflict Observability
- Use a typed diagnostic sink at the merged-index/HTTP boundary rather than ad-hoc console strings so tests and future operator surfaces can consume the same event.
- Emit at most one diagnostic per losing record per request; include stable machine-readable codes and identity/event references.
- Conflict warnings are non-fatal for reads because deterministic priority already chooses the safe result; resolver/hash/transport failures retain their existing typed HTTP mappings.
- NAR retrieval follows the Narinfo winner's snapshot and URL/hash metadata, preventing metadata from one publisher from selecting bytes from another.

### Local Blossom Read-Through Cache
- Model the local cache as an explicitly operator-configured origin with local-service allowance; it is tried before remote sources for reads but never trusted by location alone.
- Every local hit is streamed and hash-verified through the same immutable blob boundary before use. Corrupt local bytes are discarded/ignored and remote resolution continues.
- Populate the local cache only after remote bytes have passed address verification and content-hash verification; upload with streaming/backpressure and preserve retryable failures as diagnostics.
- Phase 2 adds no public write route and no signer dependency. The local service is an optimization, never an authority or availability prerequisite.

### the agent's Discretion
- Exact internal type/module names, provided they preserve the identity-layer, immutable-snapshot, typed-diagnostic, and verified-blob boundaries above.
- Whether duplicate Narinfo probing is sequential or bounded-concurrent, provided output ordering and resource ceilings remain deterministic and explicit.
- Local cache upload retry timing within Phase 2, provided failed uploads remain observable and do not fail a successfully verified read.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/nostr/selection.ts` already admits validated publications through Applesauce `EventStore` and a custom `CacheSelectionModel`, with durable per-identity freshness state.
- `src/protocol/narinfo.ts` already provides strict parsing, signature preservation, and endorsement classification suitable for semantic comparison and signature union.
- `src/blossom/source_plan.ts`, `src/blossom/blob_fetcher.ts`, and `src/network/safe_fetcher.ts` already implement ordered sources, verified immutable spooling, SSRF controls, deadlines, and streaming.
- `src/nix/http_handler.ts` already captures one immutable selection before awaits and maps typed resolver outcomes to stock-Nix HTTP behavior.

### Established Patterns
- Validate all operator input before side effects and aggregate configuration diagnostics.
- Commit durable state before reactive emission; dispose subscriptions/models explicitly on shutdown.
- Treat publisher/network input as hostile and preserve typed absence/error outcomes.
- Keep byte transport in Web Streams with configured transfer/output ceilings; RxJS/Applesauce is control-plane state only.

### Integration Points
- Extend configuration from a publisher set/single identity assumption to an ordered exact identity list while retaining Phase 1 compatibility where reasonable.
- Generalize the selection view used by `src/runtime/daemon.ts` and `src/nix/http_handler.ts` to an ordered immutable merged snapshot.
- Add Narinfo agreement/merge logic between path resolution and response serialization, keeping NAR routing pinned to the winner.
- Add optional local Blossom origin to source planning and a post-verification streamed population hook in `BlobFetcher` or a narrow wrapper.

</code_context>

<specifics>
## Specific Ideas

- Determinism is defined entirely by configured identity order, never relay or network timing.
- Conflict diagnostics must identify what disagreed without dumping untrusted metadata or NAR contents.
- A local cache hit must pass the same SHA-256 verification as a remote hit; locality grants SSRF allowance, not integrity trust.

</specifics>

<deferred>
## Deferred Ideas

- HTTP PUT authorization and streamed Nix upload ingestion are Phase 3.
- Hashtree mutation, replica availability gates, event signing, publication debounce/retry, and relay acknowledgements are Phase 4.

</deferred>
