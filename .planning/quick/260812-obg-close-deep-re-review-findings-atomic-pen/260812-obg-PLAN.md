---
quick_id: 260812-obg
phase: quick-deep-rereview-closure
plan: 01
type: quick
status: ready
wave: 1
depends_on: []
autonomous: true
requirements:
  - READ-03
  - WRIT-04
  - WRIT-06
  - PUBL-02
  - PUBL-03
  - PUBL-05
  - OPER-04
files_modified:
  - src/persistence/write_repository.ts
  - src/hashtree/writer.ts
  - src/write/batch_scheduler.ts
  - src/write/overlay.ts
  - src/nix/merged_cache.ts
  - src/nix/http_handler.ts
  - src/runtime/daemon.ts
  - tests/protocol/hashtree_writer_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/publication_recovery_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/merged_cache_test.ts
  - tests/integration/http_cache_test.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
must_haves:
  truths:
    - Authoritative pending candidate rows and durable ownership of every inventory blob become visible in one database transaction; no committed pending row can reference a reclaimable run-only blob.
    - Startup reconciliation removes every abandoned run/index and eventually deletes every zero-owner blob file and ledger row, retrying filesystem failures without deleting referenced data.
    - Aggregate quota charges each distinct live physical staged digest exactly once, including current overlay owners and reservations, while reclaimed unreachable history releases capacity.
    - Pinned signer routes retain an exact generation lease from narinfo pinning through NAR response EOF, cancellation, error, eviction, or replacement.
    - HashtreeWriter exposes an idempotent close lifecycle that drains/aborts builds and closes/checkpoints all persistent handles before daemon/test storage removal.
    - Crash injection, cumulative writer ordering, restart, low-quota/shared-blob/current-overlay, concurrent prune, full verification, real-Nix, and clean deep re-review evidence pass.
  artifacts:
    - src/persistence/write_repository.ts
    - src/hashtree/writer.ts
    - src/write/batch_scheduler.ts
    - src/nix/merged_cache.ts
    - src/nix/http_handler.ts
    - tests/integration/publication_batch_test.ts
    - tests/integration/writable_cache_test.ts
  key_links:
    - HashtreeWriter run ownership uses the same SQLite database and repository transaction as pending candidate admission.
    - Startup ownership reconciliation commits database liveness before retryable zero-owner filesystem sweep.
    - Quota derives distinct digests from every live staged/overlay owner plus reservations.
    - SignerRouteRegistry owns generation leases and response wrappers release them only at terminal state.
    - Batch scheduler drains build handles before closing the writer and daemon repository.
---

<objective>
Close every current finding in `.planning/04-MILESTONE-REVIEW.md` by making pending-candidate ownership atomic, abandoned-run cleanup complete and retryable, disk quota physically accurate, pinned routes lease-safe, and writer persistence explicitly disposable.

Purpose: Ensure no crash can make an authoritative root lose its blobs, no restart or current overlay can evade bounded disk accounting, and no concurrent prune can invalidate a stock-Nix request snapshot.
Output: Consolidated ownership persistence, atomic candidate handoff, startup reconciliation/GC, distinct-live-byte quota, lease-bearing route registries, writer lifecycle closure, and discriminating regression/re-review evidence.
</objective>

<execution_context>
@/home/user/.codex/gsd-core/workflows/execute-plan.md
@/home/user/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@NIP.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/04-MILESTONE-REVIEW.md
@.planning/v1.0-MILESTONE-AUDIT.md
@src/persistence/write_repository.ts
@src/hashtree/writer.ts
@src/write/batch_scheduler.ts
@src/write/overlay.ts
@src/nix/merged_cache.ts
@src/nix/http_handler.ts
@src/runtime/daemon.ts
@tests/protocol/hashtree_writer_test.ts
@tests/integration/publication_batch_test.ts
@tests/integration/publication_recovery_test.ts
@tests/integration/writable_cache_test.ts
@tests/integration/merged_cache_test.ts
@tests/integration/http_cache_test.ts
@tests/e2e/nix_publication_roundtrip_test.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Atomically admit one candidate with its blob owners and reconcile every crash point</name>
  <files>src/persistence/write_repository.ts, src/hashtree/writer.ts, src/write/batch_scheduler.ts, src/runtime/daemon.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts, tests/integration/publication_recovery_test.ts</files>
  <behavior>
    - CR-04: `recordPending` commits pending metadata, inventory, batch state, and `batch:<id>` blob-owner edges in one `BEGIN IMMEDIATE` transaction; a pending inventory row without its durable owner is structurally impossible.
    - A run remains the owner until that transaction succeeds; synchronous failure leaves no pending candidate and disposal releases the run, while commit success permits disposal to release only the redundant run owner.
    - Crash/error injection before build completion, after blob creation, during inventory iteration, before transaction commit, after commit before handle disposal, and during supersession/restart always recovers to either no pending candidate with reclaimable blobs or a complete pending candidate whose files and durable owners exist.
    - CR-05: startup removes foreign-session run ownership/index artifacts, then sweeps every zero-owner content blob and ledger row; failed unlink keeps a retryable row and is retried on later startup/close.
    - WR-05: writer close is idempotent, rejects new builds, aborts or waits for active builds/handles according to the documented shutdown order, sweeps, checkpoints, and closes the ownership connection before repository/root deletion.
    - Cumulative writer-order tests prove deterministic results and cleanup when builds complete/dispose in every ordering: A then B, B then A, interleaved inventory consumption, shared blobs, transfer success/failure, and close with active/disposed handles.
  </behavior>
  <action>Eliminate the unsafe split-database transfer rather than papering it over. Move `content_blobs`, `blob_owners`, `writer_runs`, and any cleanup/handoff state into `WriteRepository`'s SQLite database (or a repository-owned database at the same transaction boundary); inject a narrow `CandidateOwnershipRepository` port into `HashtreeWriter`. Production must use the same `DatabaseSync` transaction owner as pending/batch/saga tables. Standalone writer tests may construct a repository-backed temporary ownership store, but must exercise the identical schema and methods. Do not use SQLite `ATTACH` across independently WAL-journaled databases as a claim of crash-atomic commit; consolidation is the preferred implementation. If consolidation proves blocked by a documented dependency conflict, use a durable two-phase journal whose recovery algorithm is tested at every transition and whose prepared owner is never swept until repository reconciliation resolves it.

Within one `BEGIN IMMEDIATE`, make `recordPending` validate the frozen run/batch identity and every inventory file/hash/size row; insert/replace pending metadata/inventory; create `batch:<id>` owner edges by selecting the run's exact hashes; verify owner count equals candidate blob count and pending inventory count; transition the batch; then commit. The build handle exposes its immutable run ID but no longer performs a second database ownership transfer. On rollback it remains run-owned; on commit scheduler `finally` disposes the handle, releasing only `run:<id>`. Pending replacement atomically installs the newer batch owner before releasing the superseded pending owner, so no zero-owner window exists. Saga claim/history/repair transitions transfer or retain durable owners in their existing transactions.

Implement startup reconciliation before builds are accepted: mark foreign-session runs abandoned transactionally, remove their run-owner edges and writer-run rows while retaining cleanup work; close/delete their per-run index/WAL/SHM files; select zero-owner `content_blobs`; unlink files using exact validated paths under the candidate root; delete the ledger row only after absent/successful unlink; retain a cleanup-pending row/code on permission/I/O failure and retry at next startup, build disposal, and writer close. Never delete by age, glob without a ledger row, or while any run/batch/pending/saga/history/repair owner exists. Add injectable crash/failure seams usable only through repository/writer dependencies, not production bypasses.

Add `HashtreeWriter.close()`/`AsyncDisposable`: set closing, abort owned active builds, await all handles/iterators, reconcile/sweep, checkpoint WAL, close statements/database ownership, and make repeated close harmless. Define scheduler shutdown as abort timers/build, await serial work/handle disposal, then close writer; wire daemon drains in that order before `WriteRepository.close`. Update every writer test/fixture to close before deleting temp roots. Add cumulative ordering and crash tests that inspect both database rows and physical files across reopen, including failure to unlink on first reconciliation and success on the second.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts --filter "ownership|ordering|close|abandoned" &amp;&amp; deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/publication_batch_test.ts tests/integration/publication_recovery_test.ts --filter "atomic handoff|crash|reconcile"</automated>
  </verify>
  <done>CR-04, CR-05, and WR-05 are closed: pending and blob ownership share one atomic commit, every abandoned zero-owner artifact is eventually reclaimed, writer resources close deterministically, and crash/order tests prove both database and filesystem invariants.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Charge distinct live bytes and hold pinned generation leases through response completion</name>
  <files>src/persistence/write_repository.ts, src/write/overlay.ts, src/nix/merged_cache.ts, src/nix/http_handler.ts, tests/integration/writable_cache_test.ts, tests/integration/merged_cache_test.ts, tests/integration/http_cache_test.ts</files>
  <behavior>
    - CR-06: aggregate quota equals the sum of each distinct physical staged digest needed by any live staged route/current overlay generation/lease/pending batch/saga repair or refresh owner, counted once, plus full in-flight reservations.
    - Shared identical blobs across routes/generations are charged once; current overlay bytes remain charged; pruned history releases capacity only when no live owner remains.
    - Under a low ceiling, uploads are rejected before reservation or disk growth would exceed the limit even after many admitted generations; after unreachable history is reclaimed, safe capacity becomes available again.
    - WR-04: signer narinfo pinning stores a lease-bearing exact-generation registry entry; a later NAR request uses that lease or atomically reacquires the same still-retained generation, never an unleased raw snapshot.
    - Lease release occurs exactly once at response EOF, cancellation, stream/read error, HEAD/no-body completion, TTL/LRU eviction, replacement, registry close, and handler shutdown.
    - Fetch old narinfo, concurrently admit/prune a newer generation, then stream/cancel the pinned old NAR successfully; its file remains until terminal release and is reclaimed afterward.
  </behavior>
  <action>Define quota from physical liveness, not route/generation convenience. Normalize ownership so staged content hashes have explicit edges from staged routes, current overlay generations, acquired generation leases, frozen/pending batches, active/history saga inventory, and repair/refresh state. In reservation and post-stream admission transactions, compute `SUM(DISTINCT size by digest)` for all live staged content plus reservation bytes; never exclude a digest merely because its route is in the current overlay. A digest referenced by multiple routes/generations/owners contributes once. Use checked safe integers and reject before temp content can extend physical usage past `stagingAggregateBytes`. Keep the conservative full-per-body reservation behavior. GC removes content and releases charged bytes only after all durable owners and process generation leases are gone. If candidate-tree storage has a separate configured inventory ceiling, retain it; do not double-charge it as staged bytes unless the configured quota contract explicitly covers the shared physical root.

Write low-ceiling tests first: current overlay alone nearly fills quota and blocks another upload; multiple current routes with distinct digests cumulatively hit the ceiling; shared digest owners count once; historical generation pruning does not free a still-current/shared/leased blob; release of the final unreachable owner frees exact capacity; restart reproduces the same accounting without relying on in-memory leases. Assert physical live file byte totals never exceed the configured ceiling plus an explicitly reserved temp maximum during an in-flight stream, and reservations are released on all errors.

Replace `SignerRouteRegistry` raw snapshots with owned entries `{generation, snapshot/resolver data, release, expiresAt}` obtained from `SignerOverlay.acquire(generation?)`. Narinfo pinning transfers a lease into the registry rather than releasing it at request end. NAR lookup atomically takes/duplicates the pinned lease for its response; wrap every response body with terminal release covering close, cancel, pull error, upstream error, and consumer abandonment supported by the stream contract. HEAD releases immediately after headers. Registry eviction/replacement/TTL/close releases retained leases; bound registry entries as today. If exact generation reacquisition is used instead, repository pruning must make the generation unavailable only after registry lease expiry/release, and lookup failure must not silently fall through to a newer signer generation. Apply equivalent response-lifetime ownership to any winner-route resource that can be physically reclaimed; publisher-only immutable remote snapshots may retain metadata without a local generation lease, but registry cleanup remains explicit.

Add a deterministic concurrent-prune test: request old signer narinfo and pin its NAR; admit generation N+1 and invoke GC; start/read the old NAR slowly across multiple pulls; prove exact old bytes and generation provenance; cancel/EOF; run GC and prove the old exclusive file becomes reclaimable. Include eviction, replacement, TTL, HEAD, error, and double-cleanup counters. Do not extend TTL as a substitute for a lease or hold a process lease forever after registry eviction.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/integration/writable_cache_test.ts --filter "distinct live quota|current overlay|shared blob" &amp;&amp; deno test --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/merged_cache_test.ts tests/integration/http_cache_test.ts --filter "pinned signer|generation lease|concurrent prune"</automated>
  </verify>
  <done>CR-06 and WR-04 are closed: quota bounds distinct live physical cache bytes including the current overlay, reclaimed history safely restores capacity, and pinned responses keep the exact generation alive through their terminal state.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Prove integrated restart, quota, lease, and lifecycle behavior and pass deep re-review</name>
  <files>tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts, tests/integration/publication_recovery_test.ts, tests/integration/writable_cache_test.ts, tests/integration/merged_cache_test.ts, tests/integration/http_cache_test.ts, tests/e2e/nix_publication_roundtrip_test.ts</files>
  <behavior>
    - A complete production lifecycle survives injected crashes at every candidate ownership transition and restart always finds either a retryable batch or a complete live pending/saga inventory.
    - Repeated writers/builds in differing completion/disposal order leave deterministic roots, no database I/O errors, no abandoned indexes/owners, and no zero-owner files after close/reopen.
    - Multiple real cache generations under low quota preserve current/shared/leased bytes, reclaim only unreachable history, and continue accepting uploads exactly when capacity permits.
    - A stock-Nix narinfo-to-NAR flow pinned before concurrent generation rollover/prune completes with exact bytes; publication/substitution roundtrip remains successful.
  </behavior>
  <action>Build an integrated test matrix rather than relying only on unit seams. Parameterize crash injection at run creation, first/last blob ownership, prepared inventory, pending transaction rollback/commit, handle disposal, pending supersession, writer close, and startup sweep. Reopen both repository and writer after each injected stop; assert pending/saga inventory files exist and have owners, retry batches stay retryable, zero-owner artifacts are eventually absent, and referenced/shared blobs survive. Add cumulative writer tests across at least three builds with overlapping/non-overlapping blobs and every meaningful dispose/close ordering, checking stable canonical roots and no live SQLite/WAL handle before temp-root removal.

Run a low-quota multi-generation integration scenario containing distinct current NARs, a shared blob, prunable historical content, a pending batch, and an old pinned response lease. Compare database-derived charged bytes to physical distinct staged files at each transition. Assert upload rejection occurs before exceeding the ceiling; prune history while preserving current/pending/leased content; terminally release the response; reclaim the final old blob; restart and repeat accounting. Extend the production real-Nix roundtrip only as needed to guard publication/substitution behavior after the ownership/quota/lease changes; preserve both existing E2Es and no-premature-root checks.

After focused tests, run `deno task verify` (which includes protocol, integration, and both real-Nix E2Es). Then run a fresh deep code re-review against the current `.planning/04-MILESTONE-REVIEW.md`, reviewing production and discriminating tests for CR-04, CR-05, CR-06, WR-04, and WR-05. Fix/retest until all five are closed and no new critical/warning finding is introduced. Update the review artifact through the review workflow, not by weakening or deleting findings. Acceptance requires the prior reproducible writer cleanup `disk I/O error` to be absent under repeated focused/full runs.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts tests/integration/publication_batch_test.ts tests/integration/publication_recovery_test.ts tests/integration/writable_cache_test.ts tests/integration/merged_cache_test.ts tests/integration/http_cache_test.ts &amp;&amp; deno task verify &amp;&amp; deno task test:nix-e2e</automated>
  </verify>
  <done>All crash, ordering, restart, quota, shared/current/leased blob, concurrent prune, and real-Nix regressions pass; full verification is green; and a fresh deep re-review closes CR-04–06 and WR-04–05 with no new actionable finding.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| Writer run to pending candidate | Candidate files cross from temporary build ownership into authoritative publication state and must do so atomically. |
| Ownership ledger to filesystem | Durable references decide which immutable blob files may be deleted after crashes and retries. |
| Live cache owners to quota | Current overlay, staged, batch, saga, repair, refresh, and lease references determine charged distinct disk bytes. |
| Narinfo pin to later NAR response | A request-scoped immutable generation must survive asynchronous rollover, pruning, streaming, and cancellation. |
| Daemon shutdown to writer ledger | Persistent SQLite handles and active build resources must drain before repository/root teardown. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-obg-01 | Tampering | pending/owner handoff | critical | mitigate | Consolidated database transaction validates inventory and atomically creates batch ownership with pending admission. |
| T-obg-02 | Denial of Service | abandoned writer runs | critical | mitigate | Transactional abandoned-owner removal plus retryable zero-owner file/row sweep on startup, disposal, and close. |
| T-obg-03 | Denial of Service | aggregate storage quota | critical | mitigate | Sum distinct live staged digests including current overlay and reservations; low-ceiling physical-byte tests enforce the bound. |
| T-obg-04 | Tampering | pinned signer route pruning | high | mitigate | Lease-bearing registry entry and response-terminal release prevent deletion or generation substitution during a pinned flow. |
| T-obg-05 | Denial of Service | writer SQLite lifecycle | high | mitigate | Idempotent close, active-build drain/abort, checkpoint, handle closure, daemon ordering, and repeated cleanup tests. |
| T-obg-06 | Repudiation | crash reconciliation | medium | mitigate | Durable owner/run/cleanup states and injected transition tests make restart outcomes auditable and deterministic. |
| T-obg-SC | Tampering | package supply chain | low | accept | No package installation occurs; existing pinned dependencies are reused. |
</threat_model>

<source_coverage_audit>

| Source | Item | Coverage |
|---|---|---|
| GOAL | Preserve trusted, bounded, streamed, restart-safe read/write publication under crash and concurrency | Tasks 1-3 |
| REQ | READ-03 immutable request snapshots | Tasks 2-3 |
| REQ | WRIT-04/WRIT-06 durable staged/current overlay data | Tasks 1-3 |
| REQ | PUBL-02 bounded durable candidate construction | Tasks 1 and 3 |
| REQ | PUBL-03/PUBL-05 available inventory and restart retry | Tasks 1 and 3 |
| REQ | OPER-04 hostile/crash/integration/E2E coverage | Tasks 1-3 |
| REVIEW | CR-04 non-atomic pending candidate/blob-owner handoff | Tasks 1 and 3 |
| REVIEW | CR-05 abandoned runs do not sweep blobs/ledger rows | Tasks 1 and 3 |
| REVIEW | CR-06 current cache bytes excluded from quota | Tasks 2 and 3 |
| REVIEW | WR-04 pinned signer snapshots bypass generation leases | Tasks 2 and 3 |
| REVIEW | WR-05 writer ledger lacks close lifecycle | Tasks 1 and 3 |
| REQUEST | Crash/error, cumulative writer-order, low quota/shared/current overlay, concurrent prune, full verify, deep re-review | Tasks 1-3 |

Every current review finding is a required closure; none is deferred, transferred, or scope-reduced.
</source_coverage_audit>

<verification>
Execute every production task test-first with atomic RED/GREEN/refactor commits. Use injected failures to stop at each database/filesystem ownership transition, then reopen and verify both rows and files. Run focused cumulative-order and quota/lease concurrency suites, `deno task verify`, and the explicit real-Nix task. Finally perform a new deep review and continue closure until CR-04, CR-05, CR-06, WR-04, and WR-05 are all closed without new actionable findings. Preserve NIP.md validation, canonical roots, same-server proof, exact relay OK, anti-rollback, streaming, boundedness, and no-premature-exposure behavior throughout.
</verification>

<success_criteria>
- Pending candidate admission and durable blob ownership are one atomic repository transaction with complete crash/restart discrimination.
- Startup/disposal/close removes abandoned indexes, owners, zero-owner files, and ledger rows, retrying deletion errors safely.
- Aggregate quota bounds distinct live physical staged bytes including current overlay and reservations, counts shared blobs once, and releases only unreachable history.
- Pinned signer NAR responses hold exact generation leases until EOF/cancel/error/eviction and survive concurrent rollover/pruning.
- Writer close is idempotent, wired through scheduler/daemon/tests, and produces no leaked SQLite/WAL handles or cleanup I/O errors.
- Focused tests, `deno task verify`, both real-Nix E2Es, and a fresh deep re-review all pass with no remaining or new actionable finding.
</success_criteria>

<output>
Create `.planning/quick/260812-obg-close-deep-re-review-findings-atomic-pen/260812-obg-SUMMARY.md` when done.
</output>
