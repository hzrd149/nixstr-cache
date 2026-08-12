# Phase 3: Signer-Gated Writable Cache - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Mode:** Autonomous recommendations accepted by delegated authority

<domain>
## Phase Boundary

Add one signer-owned writable cache identity, streamed stock-Nix upload staging, dependency-closed eligibility, a highest-priority committed signer overlay, deterministic quiet/max-delay batching, and plaintext copy-on-write Hashtree construction. Uploading tree blobs, proving replica completeness, signing/publishing roots, and relay publication remain Phase 4.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Validated write intent already models `disabled`, `nip46`, and `local` signer modes plus an exact writable identity.
- `BlobFetcher`, `VerifiedBlob`, `RequestBudget`, and strict Narinfo/Hashtree codecs provide streaming, hashing, and bounded parsing primitives.
- `StateRepository` and SQLite transactions already enforce commit-before-reactive-emission behavior.
- The merged cache captures immutable ordered snapshots and has winner-pinned routing suitable for a signer-first layer.

### Established Patterns
- Validate before side effects, use typed failures, and keep secrets out of diagnostics.
- Byte data uses Web Streams and owner-only files; RxJS/Applesauce coordinates control-plane state only.
- Immutable content is hash-addressed and never exposed before verification.
- Phase boundaries are strict: readiness and pending candidate construction here, network publication next phase.

### Integration Points
- Extend production composition with signer lifecycle, staging repository, eligibility model, overlay layer, scheduler, and Hashtree writer.
- Extend HTTP handler with gated streamed PUT routes while retaining existing GET/HEAD behavior.
- Add pending-publication rows that Phase 4 can claim without reconstructing or buffering the dataset.

</code_context>

<specifics>
## Specific Ideas

- A configured but disconnected/mismatched signer must look read-only to Nix, not like an authorized endpoint returning late failures.
- Batch freeze is a durable boundary: the committed read root never changes during Phase 3.
- Identical uploads are successful no-ops, enabling safe Nix retries.

</specifics>

<deferred>
## Deferred Ideas

- Blossom replication, completeness proofs, event signing/publication, retry queues, local relay write-through, and full upload→publish→substitute E2E are Phase 4.

</deferred>
