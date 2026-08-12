---
quick_id: 260812-nes
phase: quick-milestone-review-closure
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
  - PUBL-04
  - PUBL-05
  - PUBL-07
  - OPER-04
files_modified:
  - src/persistence/write_repository.ts
  - src/write/publication_coordinator.ts
  - src/write/batch_scheduler.ts
  - src/hashtree/writer.ts
  - src/hashtree/reader.ts
  - src/blossom/publication_uploader.ts
  - src/signer/capability.ts
  - src/runtime/daemon.ts
  - tests/protocol/hashtree_writer_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/publication_loop_test.ts
  - tests/integration/publication_recovery_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/hostile_blossom_test.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
must_haves:
  truths:
    - Every newer eligible generation rolls into its own publication saga after the prior generation is admitted, without losing prior repair or refresh obligations.
    - Writer build-run indexes, handles, and unreferenced candidate blobs are reclaimed on success, failure, abort, and pending replacement.
    - Historical overlay, staging, batch, and candidate data is reclaimed only after durable admission and only when no active snapshot, saga, repair, refresh, or pending generation references it.
    - File chunks are discovered and streamed lazily with bounded DFS state and cancellation between every manifest and chunk operation.
    - Coordinator shutdown aborts replica, signing, and relay work and durably restores claimed work for retry after restart.
    - Multi-generation, restart, low-quota, cleanup, cancellation, full verification, and real-Nix regressions pass, followed by a clean re-review.
  artifacts:
    - src/persistence/write_repository.ts
    - src/write/publication_coordinator.ts
    - src/hashtree/writer.ts
    - src/hashtree/reader.ts
    - src/blossom/publication_uploader.ts
    - tests/integration/publication_recovery_test.ts
    - tests/e2e/nix_publication_roundtrip_test.ts
  key_links:
    - Newer pending generation transactionally archives the admitted active saga and becomes the next active saga.
    - Durable reference tables govern overlay, staged, batch, candidate, and writer blob reclamation.
    - PublicationBatchScheduler owns and disposes each Hashtree build handle in finally after inventory persistence.
    - PathResolver response pull drives manifest DFS and raw chunk fetch one descriptor at a time.
    - PublicationCoordinator AbortSignal reaches uploader requests, signer delegation, and bounded relay publication.
---

<objective>
Close every actionable finding in `.planning/04-MILESTONE-REVIEW.md` so the daemon supports repeated cache updates indefinitely with bounded storage/memory, explicit resource ownership, safe reclamation, and deterministic cancellation.

Purpose: Restore the core mutable-cache lifecycle beyond its first publication while preserving NIP.md validation, same-server availability proof, exact relay acknowledgement, immutable active snapshots, durable repair/refresh, streaming, and the prohibition on premature root exposure.
Output: Multi-generation saga rollover and retention, disposable writer runs with reference-aware garbage collection, lazy file DFS, coordinator-wide cancellation/retry restoration, discriminating integration/protocol/E2E tests, and a clean re-review.
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
@.planning/phases/03-signer-gated-writable-cache/03-VERIFICATION.md
@.planning/phases/04-availability-gated-publication-loop/04-VERIFICATION.md
@src/persistence/write_repository.ts
@src/write/publication_coordinator.ts
@src/write/batch_scheduler.ts
@src/hashtree/writer.ts
@src/hashtree/reader.ts
@src/blossom/publication_uploader.ts
@src/signer/capability.ts
@src/runtime/daemon.ts
@tests/integration/publication_loop_test.ts
@tests/integration/publication_recovery_test.ts
@tests/integration/publication_batch_test.ts
@tests/integration/writable_cache_test.ts
@tests/integration/hostile_blossom_test.ts
@tests/protocol/hashtree_writer_test.ts
@tests/e2e/nix_publication_roundtrip_test.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Publish a second real generation and reclaim only unreachable history</name>
  <files>src/persistence/write_repository.ts, src/write/publication_coordinator.ts, src/write/overlay.ts, tests/integration/publication_loop_test.ts, tests/integration/publication_recovery_test.ts, tests/integration/writable_cache_test.ts, tests/e2e/nix_publication_roundtrip_test.ts</files>
  <behavior>
    - CR-01: after generation 1 is committed and admitted, a distinct newer pending generation atomically becomes a new active saga; its event has the new root and strictly greater `created_at` while generation 1 repair work remains durable.
    - Same-root expiration refresh remains a separate transition and never consumes or masks a newer pending generation.
    - Restart with an admitted saga, unfinished repair, and a newer pending candidate deterministically restores repair plus generation rollover without re-signing old work, losing the candidate, or exposing the new root before its barrier completes.
    - CR-03: admission establishes the reclamation watermark, but active immutable overlay snapshots, the current/new saga, pending batches, repair/refresh work, and their blob inventories remain retained until their references are released.
    - Under a deliberately low staging quota, several publish/admit cycles reclaim obsolete overlay rows, staged Narinfo/reference/blob rows, frozen batch rows, candidate rows/index references, proofs/work, and unreferenced files so later PUTs continue to succeed.
    - A response holding an older overlay snapshot continues reading valid bytes during pruning; the admitted current overlay and ongoing repair remain intact.
  </behavior>
  <action>Write the failing two-generation lifecycle first: publish generation 1 through same-server proof, exact signature, configured relay OK, durable commit and selector admission; stage/commit/build a different generation 2; tick; assert a second event with the new root and monotonic `created_at`; then substitute the new object through the production view. Include restart variants with generation 1 admitted plus pending generation 2, with incomplete generation 1 endpoint repair, and with a near-expiry old root to discriminate new-generation rollover from refresh.

Refactor publication state into explicit current/history ownership rather than singleton short-circuiting. In one `BEGIN IMMEDIATE` transaction, `claimPublication` must compare pending and active generations: an uncommitted/unadmitted active saga remains authoritative; an admitted saga with no newer candidate remains available for refresh/repair; an admitted saga plus a strictly newer pending generation is copied to immutable history, its retry/repair ledger and referenced inventory remain owned by history, the new candidate/inventory becomes the active saga, and the consumed pending singleton is cleared. Reject equal/older generation rollback. Derive `created_at` monotonically from both wall time and greatest prior owned event timestamp. Keep refresh as a same-root history transition that loses to a newer pending generation. Update repair claims to address saga/history batch IDs so old repair can proceed while the new active saga advances; never combine possession proofs across generations/servers.

Add a durable reference/lease model for retention. Persist ownership edges from overlay snapshots/generations, staged routes, frozen batches, pending candidate, active/history sagas, endpoint repair/refresh, and published inventory to content hashes/paths. Admission advances a prune watermark but does not delete anything reachable from the current overlay, an explicitly acquired in-process snapshot lease, a pending/building/failed batch, active saga, retained repair/refresh, or publication history required by freshness/rollback rules. Provide acquire/release around `SignerOverlaySnapshot`/route serving, with deferred pruning after the last lease; startup treats persisted durable owners conservatively and clears only process leases. In the admission transaction or a serialized post-commit GC transaction, prune obsolete `overlay_entries`, `overlay_store_paths`, staged metadata/references/routes, consumed batch/candidate/proof rows and content files only after reference count reaches zero. Compute quota from live staged references plus reservations, not historical unreachable rows. File deletion follows committed row ownership changes and is restart-idempotent: leftover unreferenced files are swept; a referenced path is never removed. Preserve anti-rollback event history and any data needed for repair while bounding its retention by explicit policy. Do not prune on PUT success, batch creation, replica proof, signing, relay OK alone, or before normal selector admission.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/publication_loop_test.ts tests/integration/publication_recovery_test.ts tests/integration/writable_cache_test.ts --filter "second generation|rollover|low quota|retention"</automated>
  </verify>
  <done>CR-01, CR-03, and the lifecycle/low-quota portions of WR-03 are closed: distinct generations publish sequentially, repair/refresh survive rollover and restart, and unreachable history is reclaimed only after admission without invalidating active snapshots or enabling premature exposure.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Give every Hashtree build an explicit disposable run and reclaim its blobs</name>
  <files>src/hashtree/writer.ts, src/persistence/write_repository.ts, src/write/batch_scheduler.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts</files>
  <behavior>
    - CR-02: `HashtreeWriter.build` returns an explicit build handle whose inventory iterator is valid only until idempotent disposal and whose SQLite database/statement ownership is closed on every path.
    - `PublicationBatchScheduler` consumes the inventory into `recordPending` and disposes the handle in `finally`, including when persistence throws.
    - Successful disposal removes the per-run SQLite database plus WAL/SHM files while preserving blobs referenced by the durable pending candidate.
    - Abort, frozen-file size drift, canonical/bound failures, and `recordPending` failures close all handles and remove run indexes and every blob created solely by that failed/unconsumed run.
    - Reused blobs and blobs referenced by pending, active/history saga, repair, or another concurrent/completed run are never removed; superseded candidates release their ownership and are reclaimed only at zero durable/run references.
  </behavior>
  <action>First add discriminating tests that inspect the candidate directory before parent cleanup and inject failures at source iteration, file size validation, manifest persistence, abort, inventory consumption, and `recordPending`. Assert no `inventory-*.sqlite`, `-wal`, `-shm`, open iterator, or unreferenced candidate blob survives; assert pending and reused blobs do survive. Include repeated successful/failed builds under a low disk/inventory ceiling and a restart sweep.

Replace the plain `HashtreeBuild` return with a `HashtreeBuildHandle`/`AsyncDisposable` contract containing immutable root metadata, a single-use bounded inventory iterator, and idempotent `dispose()` (and `Symbol.asyncDispose` where supported). The writer owns a run ID, index connection, iterator statements, and a run-to-blob reference journal from creation. Wrap the complete build in `try/catch/finally`: failure closes statements/database and releases the run; success transfers the open run to the returned handle. Disposal closes any iterator/database before unlinking the index, WAL, and SHM. Make `PublicationBatchScheduler.#enqueue` bind the handle outside the try and always `await handle?.dispose()` in `finally` after `recordPending` synchronously consumes inventory. Ensure cancellation marks the frozen batch retryable rather than treating cleanup as candidate success.

Integrate candidate blob ownership with Task 1's durable reference graph: content-addressed persistence records a transient run reference before/with create-new; `recordPending` transactionally creates durable candidate references before disposal releases run references; failed/superseded runs release only their own edges; GC deletes a blob only when no run or durable owner references its hash. Sweep abandoned run indexes/journals and zero-reference candidate blobs at startup, but never infer liveness from filename age. Preserve exact canonical bytes, deterministic inventory order, COW reuse, and bounded durable iteration. Do not rely on temporary test-directory deletion, finalizers, process exit, best-effort database close without unlink, or delete-all candidate cleanup.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts --filter "build handle|cleanup" &amp;&amp; deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/publication_batch_test.ts --filter "dispose|cleanup|recordPending failure"</automated>
  </verify>
  <done>CR-02 and writer-cleanup coverage in WR-03 are closed: every build has explicit lifetime ownership, all success/failure/abort resources are reclaimed, and reference-aware GC preserves every durable or reused blob.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Stream file descriptors lazily and cancel publication work durably</name>
  <files>src/hashtree/reader.ts, src/write/publication_coordinator.ts, src/blossom/publication_uploader.ts, src/signer/capability.ts, src/runtime/daemon.ts, tests/integration/hostile_blossom_test.ts, tests/integration/publication_loop_test.ts, tests/integration/publication_recovery_test.ts, tests/e2e/nix_publication_roundtrip_test.ts</files>
  <behavior>
    - WR-01: resolving a multi-level file manifest returns a response stream before traversing all leaves; each pull discovers/fetches only the next descriptor while retaining at most depth-bounded DFS frames plus one active raw-chunk reader.
    - Aggregate authenticated file size, link/depth/visited/decoded/output budgets, ordering, and expected-size equality remain enforced; final size mismatch errors before successful EOF and cancellation stops pending manifest/chunk work.
    - WR-02: `PublicationCoordinator.close` aborts before awaiting serialized work, and the same signal reaches replica upload/proof requests, authorization, signer signing where supported, and relay publication with a bounded timeout adapter.
    - Cancellation during upload, proof, signing, or relay acknowledgement never commits/admit/promotes; claimed endpoint work returns durably to retry with safe code/backoff and resumes after restart from the same candidate/event where already persisted.
    - Repeated close is idempotent, releases streams/sockets/files, and completes within a bounded test deadline even when dependencies intentionally hang until aborted.
  </behavior>
  <action>Replace `PathResolver.#fileStream`'s eager `chunks` collection with a pull-driven async DFS state machine. Keep only frames `{hash, depth, manifest, index}` up to the configured depth, load/debit/validate one manifest as needed, descend type-1 links, and yield one type-0 descriptor to one raw stream reader. Debit safe-integer aggregate size and output availability before fetching each raw chunk; at traversal exhaustion compare the incrementally authenticated total to the directory link size before closing. On response cancellation or any error, abort/cancel the active manifest fetch/raw reader and clear frames. Add a fixture whose later manifest blocks/fails to prove initial response and first bytes do not prefetch it, plus deep ordering, final mismatch, budget, and cancellation tests. Do not relax authenticated size equality or send a successful EOF before final validation.

Give `PublicationCoordinator` one lifetime `AbortController`; `close()` sets closed, unsubscribes/cancels timers, aborts first, then awaits the serial chain. Change `ReplicaPublisher.prove(server, entry, signal)`, `PublicationUploader.prove`, authorization callback, signer capability signing boundary, and `publishRelays(event, relays, signal)` to accept/observe the signal. Pass it into every pinned PUT/GET request and cancel response bodies/readers on abort. For libraries without native signal support, race signer/relay work against abort and a configured finite deadline, detach/close the underlying signer/pool operation where APIs allow, and ignore late results via saga/batch identity checks; never allow a late OK/signature to mutate durable state after cancellation. In a repository transaction, convert coordinator-owned `claimed` endpoint rows back to retry with deterministic next-attempt/code on cancellation; leave durable complete proofs, exact persisted signed event, and acknowledged steps intact so restart resumes rather than repeats irreversible completed work. Cancellation itself is not attempt exhaustion. Wire daemon shutdown so coordinator abort precedes pool/signer/repository closure.

Add hanging dependency tests for each boundary, cancellation just before each durable transition, late-result rejection, restart retry restoration, and bounded idempotent shutdown. Finish by extending the real Nix publication roundtrip to publish a second distinct generation and restore it after source deletion, while existing substitution E2E remains green. Run the full gate, then invoke a fresh milestone code re-review of the changed production/test files; acceptance requires CR-01..03 and WR-01..03 closed with no new critical/warning finding.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/hostile_blossom_test.ts tests/integration/publication_loop_test.ts tests/integration/publication_recovery_test.ts --filter "lazy DFS|cancel|shutdown|retry" &amp;&amp; deno task verify &amp;&amp; deno task test:nix-e2e</automated>
  </verify>
  <done>WR-01 and WR-02 are closed, all WR-03 discriminating coverage is present, both real-Nix flows pass including a second publication generation, and a fresh deep re-review reports no remaining CR-01..03/WR-01..03 issue or new actionable regression.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| Pending generation to active saga | A newer mutable cache root crosses into availability proof, signing, relay acknowledgement, and admission while older repair/refresh remains live. |
| Retention graph to filesystem/SQLite GC | Durable and process snapshot ownership determines when hostile-volume historical content may be deleted without breaking active reads or recovery. |
| Writer run to pending candidate | Temporary indexes and newly created immutable blobs transfer ownership into durable pending state or must be reclaimed completely. |
| Hashtree manifests to HTTP response | Publisher-controlled file DAGs drive lazy network/storage work and streamed bytes under strict authenticated bounds. |
| Coordinator to replica/signer/relay | Shutdown cancellation crosses external asynchronous boundaries whose late results must not mutate durable publication state. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-nes-01 | Denial of Service | admitted saga rollover | critical | mitigate | Transactional strictly-newer generation promotion, separate refresh, durable concurrent repair, restart tests, and two-generation Nix E2E. |
| T-nes-02 | Denial of Service | overlay/staging/candidate retention | critical | mitigate | Admission watermark plus explicit durable/process leases, zero-reference GC, low-quota multi-generation and active-snapshot tests. |
| T-nes-03 | Denial of Service | writer run resources | critical | mitigate | Explicit async-disposable handle, scheduler finally, run/durable blob references, crash sweep, and injected failure cleanup tests. |
| T-nes-04 | Tampering | premature/superseded root exposure | high | mitigate | Preserve exact same-server proof, signed-event validation, configured relay OK, identity checks, admission order, and generation monotonicity. |
| T-nes-05 | Denial of Service | eager file descriptor traversal | high | mitigate | Pull-driven depth-bounded DFS, one active chunk reader, all existing budgets, final size equality, and cancellation tests. |
| T-nes-06 | Denial of Service | in-flight publication shutdown | high | mitigate | Coordinator-owned abort, bounded adapters, abort-before-wait shutdown, durable claimed-work retry restoration, and late-result rejection. |
| T-nes-07 | Repudiation | cleanup and rollover | medium | mitigate | Durable history/ownership transitions and typed diagnostics retain enough non-secret evidence for repair and audit. |
| T-nes-SC | Tampering | package supply chain | low | accept | No package installation is planned; implementation uses the existing pinned dependency graph. |
</threat_model>

<source_coverage_audit>

| Source | Item | Coverage |
|---|---|---|
| GOAL | Repeated decentralized cache updates remain trustworthy, available, streamed, bounded, and recoverable | Tasks 1-3 |
| REQ | READ-03 streamed immutable request snapshot | Tasks 1 and 3 |
| REQ | WRIT-04/WRIT-06 durable staging and signer overlay | Task 1 |
| REQ | PUBL-02 bounded candidate writer | Task 2 |
| REQ | PUBL-03/PUBL-04 availability/sign/relay/admission barrier | Tasks 1 and 3 |
| REQ | PUBL-05 durable retry and restart | Tasks 1 and 3 |
| REQ | PUBL-07 real Nix publish/restore | Tasks 1 and 3 |
| REQ | OPER-04 hostile, lifecycle, cleanup, restart, and E2E evidence | Tasks 1-3 |
| REVIEW | CR-01 completed saga blocks later update | Task 1 |
| REVIEW | CR-02 writer index/handle/blob leak | Task 2 |
| REVIEW | CR-03 overlay/staged content never reclaimed | Task 1 |
| REVIEW | WR-01 eager file chunk descriptor list | Task 3 |
| REVIEW | WR-02 in-flight publication not cancellable | Task 3 |
| REVIEW | WR-03 missing discriminating multi-generation/cleanup tests | Tasks 1-3 |

Every actionable review finding is required closure scope; none is deferred or reduced.
</source_coverage_audit>

<verification>
Implement each task test-first with atomic RED/GREEN/refactor commits. Run focused suites after each task, then `deno task verify` and `deno task test:nix-e2e`. Inspect database/file counts across multi-generation and restart tests, prove no active snapshot or repair object is pruned, prove no writer run artifacts remain, and prove cancellation restores durable retry without promotion. Finally run a fresh deep code review against `.planning/04-MILESTONE-REVIEW.md`; repeat fixes/tests until CR-01, CR-02, CR-03, WR-01, WR-02, and WR-03 are all closed and no new critical/warning finding remains.
</verification>

<success_criteria>
- Two or more distinct generations publish/admit sequentially with monotonic events while prior repair and same-root refresh semantics remain correct across restart.
- Overlay, staged, batch, candidate, writer-index, and blob storage remain bounded through reference-aware reclamation after durable admission without invalidating active snapshots.
- Success, failure, abort, size drift, and `recordPending` failure leave no leaked build handle/index/WAL/SHM or unreferenced blob.
- File reconstruction uses lazy bounded DFS with backpressure, exact authenticated ordering/size, and prompt cancellation.
- Coordinator shutdown cancels replica/sign/relay work, rejects late mutations, and restores claimed work for durable retry.
- Discriminating multi-generation, restart, low-quota, cleanup, and cancellation tests pass; `deno task verify` and both real-Nix E2Es pass.
- A fresh milestone re-review closes all six findings and introduces no new actionable critical or warning.
</success_criteria>

<output>
Create `.planning/quick/260812-nes-close-all-actionable-milestone-review-fi/260812-nes-SUMMARY.md` when done.
</output>
