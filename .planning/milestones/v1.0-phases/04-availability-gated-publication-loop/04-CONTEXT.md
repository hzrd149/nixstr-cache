# Phase 4: Availability-Gated Publication Loop - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Mode:** Autonomous recommendations accepted by delegated authority

<domain>
## Phase Boundary

Consume Phase 3's durable unpublished candidate, stream every newly reachable blob to the signer's current advertised Blossom servers, prove at least one server has the complete tree, sign and publish the correct cache-root event, atomically promote it into the signer-first read view, and retain failed replica/relay work for observable retry. Complete the operator health/logging surface and real Nix upload→publish→delete→substitute proof.

</domain>

<decisions>
## Implementation Decisions

### Availability Barrier and Replication
- Snapshot the signer's authenticated current kind-10063 BUD-03 server list when claiming a pending candidate; require at least one valid advertised destination or leave writes unavailable.
- Stream immutable blobs with bounded concurrency and per-server attempt/deadline limits. Use content-addressed upload semantics and verify server possession with HEAD/GET plus hash where the protocol requires.
- A server counts complete only when every blob reachable from the candidate root is proven present on that same server; success distributed across different partial servers does not satisfy the barrier.
- Do not call the signer or relay publisher before the first complete-server proof is durably committed.

### Signing, Relay Publication, and Promotion
- Build exactly kind `17091` for default identity or kind `37091` with the exact configured `d`; include canonical plaintext `nhash`, ordered Blossom tags, Nix signature-key tags, and expiration semantics required by `NIP.md`.
- Add an explicit ordered, strictly validated operator `nixSigKey` list; an empty list intentionally publishes no key declarations and must never be inferred from uploaded Narinfo records.
- Attach NIP-40 expiration using a validated configurable publication lifetime with a 30-day default; schedule refresh through the same durable saga before expiry rather than emitting immortal mutable cache identities.
- Sign only through the ready owned signer capability and verify the completed signed event locally before any relay publication.
- Publish to configured relays with bounded acknowledgement tracking; one configured relay acknowledgement is sufficient to promote, while other failures remain retryable. If no relay acknowledges, keep the candidate pending and do not promote.
- After the completeness and relay barriers, transactionally mark the publication committed and feed the same verified event through EventStore/selection so the signer overlay becomes the highest-priority read root without a special bypass.

### Retry and Local Event Cache
- Persist per-server and per-relay outcomes with attempt count, next-attempt time, last safe error code, and candidate/event identity; never persist secrets or raw authorization headers.
- Retry incomplete replicas and unacknowledged relays asynchronously with capped exponential backoff and jitter after promotion; retries never roll back or block the committed root.
- An optional operator-configured local relay receives both observed allow-listed events and newly signed events as a read/write-through event cache, but local acknowledgement alone counts only when it is explicitly in the configured publication relay set.
- Restart recovery resumes claimed/pending publication, replica repair, and relay retry idempotently without signing a second distinct event for the same candidate.

### Observability and Health
- Emit structured JSON diagnostics through one typed sink for event rejection, merge conflict, upstream failure, signer transition, batch transition, replication, relay acknowledgement, and publication promotion.
- Redact private keys, bunker secrets, authorization headers, full NAR/Narinfo bodies, and unsafe URLs/query credentials; log stable codes, identities, hashes, counts, and durations.
- `/health` reports process health, read availability, and write availability separately with machine-readable reasons; process/read can remain healthy while write publication is blocked.
- Health is observational only and never mutates state or performs network probes synchronously.

### End-to-End Acceptance
- Use in-process hostile Blossom and minimal Nostr relay fixtures for truncation, mismatch, partial replicas, missing acknowledgements, restart, and retry behavior.
- Extend the real Nix E2E to upload via the production daemon, wait for actual signed publication/promotion, remove the isolated local store path, and substitute solely from the published root.
- Keep every test permission-scoped to loopback, temp paths, explicit environment variables, and pinned `nix`/`nix-store` executables.
- Final verification must run format, lint, check, protocol, hostile integration, signer, publication, health/log redaction, and real-Nix read/write workflows.

### the agent's Discretion
- Exact retry backoff constants within bounded deterministic tests.
- Whether relay acknowledgements are collected sequentially or bounded-concurrently, provided configured ordering and durable outcomes are stable.
- Health JSON field names beyond the required process/read/write status and reason codes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 3 provides durable pending candidates, reachable blob inventories, signer lifecycle, staging, immutable overlay generations, and deterministic tree writing.
- Phase 1/2 provide RelayPool, EventStore selection, authenticated BUD-03 projection, safe streamed Blossom transport, typed diagnostics, and stock-Nix HTTP service.
- In-process Deno Blossom, relay, and encrypted NIP-46 fixtures already establish the test style.

### Established Patterns
- Persist barrier state before emission or irreversible external action.
- Verify signed events and content hashes locally even when produced by trusted local capabilities.
- Use typed outcomes and structured redacted diagnostics; keep hostile bytes in bounded streams/files.
- Reads remain available independently from write readiness and repair queues.

### Integration Points
- Add publication coordinator/repositories to production lifecycle after Phase 3 scheduler/writer.
- Add streamed Blossom uploader and completeness prover alongside existing verified reader/fetcher.
- Feed signed publication back through the existing EventStore selection admission path.
- Extend HTTP handler with `/health` and E2E upload/publication synchronization without changing stock-Nix cache routes.

</code_context>

<specifics>
## Specific Ideas

- "One complete replica" means one advertised server independently contains the entire reachable DAG.
- Promotion requires both a complete Blossom server and at least one configured relay acknowledgement.
- A published root is never rolled back because repair work fails later.

</specifics>

<deferred>
## Deferred Ideas

- Multi-user tenancy, distributed gateways, BUD-15 self-encrypted roots, hardware-backed key isolation, and privacy/authorization claims remain outside v1.

</deferred>
