---
quick_id: 260812-osc
phase: quick-final-warning-closure
plan: 01
type: quick
status: ready
wave: 1
depends_on: []
autonomous: true
requirements:
  - READ-03
  - PUBL-02
  - OPER-04
files_modified:
  - src/nix/merged_cache.ts
  - src/nix/http_handler.ts
  - src/runtime/daemon.ts
  - src/hashtree/writer.ts
  - src/persistence/write_repository.ts
  - tests/integration/merged_cache_test.ts
  - tests/integration/http_cache_test.ts
  - tests/protocol/hashtree_writer_test.ts
  - tests/integration/publication_batch_test.ts
must_haves:
  truths:
    - Route registry expiry and daemon/handler shutdown release every retained exact-generation lease without requiring later HTTP traffic.
    - Every lease is released exactly once on take, replacement, capacity eviction, TTL expiry, explicit close, or response terminal state.
    - HashtreeWriter registers each build before close can observe the active set, rejects builds after closing begins, and waits for all already-admitted operations before closing persistence.
    - Failed run-index deletion retains a durable cleanup record until SQLite, WAL, and SHM paths are all absent; startup retries transient failures.
    - Focused concurrency/fault tests, full verification, and a fresh deep re-review pass with zero warnings.
  artifacts:
    - src/nix/merged_cache.ts
    - src/nix/http_handler.ts
    - src/hashtree/writer.ts
    - src/persistence/write_repository.ts
    - tests/protocol/hashtree_writer_test.ts
  key_links:
    - HTTP handler owns both route registries and exposes an idempotent close hook wired into daemon drains.
    - SignerRouteRegistry timer expiry calls the same single-release deletion path as take/evict/close.
    - HashtreeWriter build admission and close state transition share one synchronous linearization point.
    - Writer run cleanup journal remains authoritative until index, WAL, and SHM absence is confirmed.
---

<objective>
Close final deep-review warnings WR-06, WR-07, and WR-08 with explicit lifecycle ownership for route leases, concurrent writer builds, and retryable run-index cleanup.

Purpose: Prevent idle narinfo pins, direct close/build races, and transient filesystem failures from retaining historical generations, corrupting writer shutdown, or orphaning durable index files.
Output: Disposable timer-driven registries and handler shutdown, linearizable writer operation tracking, durable cleanup tombstones, focused fault/concurrency tests, full verification, and zero-warning re-review.
</objective>

<execution_context>
@/home/user/.codex/gsd-core/workflows/execute-plan.md
@/home/user/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@NIP.md
@.planning/04-MILESTONE-REVIEW.md
@src/nix/merged_cache.ts
@src/nix/http_handler.ts
@src/runtime/daemon.ts
@src/hashtree/writer.ts
@src/persistence/write_repository.ts
@tests/integration/merged_cache_test.ts
@tests/integration/http_cache_test.ts
@tests/protocol/hashtree_writer_test.ts
@tests/integration/publication_batch_test.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Expire an unused signer pin and release it on handler shutdown</name>
  <files>src/nix/merged_cache.ts, src/nix/http_handler.ts, src/runtime/daemon.ts, tests/integration/merged_cache_test.ts, tests/integration/http_cache_test.ts</files>
  <behavior>
    - WR-06: signer narinfo pinning schedules bounded TTL expiry immediately; if no NAR request follows and no later traffic occurs, expiry releases the exact-generation lease and permits pruning.
    - `take` transfers the lease to the response without registry release; response EOF/cancel/error/HEAD releases it exactly once.
    - Invalid lookup, replacement, capacity eviction, eager expiry, timer expiry, and explicit registry close all converge on one idempotent release path with no double release.
    - Closing the HTTP handler cancels expiry timers, releases every retained lease, closes both signer and winner route registries, rejects or safely handles later requests, and is idempotent.
    - Production daemon shutdown invokes handler close before overlay/repository teardown; narinfo-without-NAR followed by rollover/shutdown makes the old generation prunable.
  </behavior>
  <action>Begin with a fake-clock/fake-timer registry test that stores multiple counted leases and independently exercises take, same-key replacement, max-entry eviction, expiration with no subsequent method call, close before timer, timer/close race, and repeated close. Inject `setTimer`/`clearTimer` alongside `now` so tests do not sleep. Refactor `SignerRouteRegistry` to maintain at most one scheduled timer for the earliest expiry (or an equivalently bounded timer structure), eagerly purge all due entries when it fires, then arm the next deadline. Route every removal through a private detach/release primitive that makes ownership explicit: `take` removes and returns ownership without calling release; replacement/eviction/expiry/close call release once. After close, reject `set`, return no value from `take`, and never arm a timer. Apply explicit `close()` and timer cancellation to `WinnerRouteRegistry` too even though publisher selections do not carry generation leases, so the handler owns a uniform disposable lifecycle and future resources cannot be stranded.

Return a callable handler object with the existing request-call signature plus idempotent `close()`/`dispose()` rather than hiding registries in the closure. Track in-flight handler responses only where required to release a taken signer lease: close releases entries still in the registry, while a lease already transferred into `releaseOnTerminal` remains response-owned and releases at EOF/cancel/error exactly once. Ensure HEAD and resolution failure release immediately. Close both registries and prevent post-close requests from acquiring new leases. Wire the production handler close into the daemon supervisor drain set before `writeRepository.close`; preserve current bind API by passing the callable object as the handler. Add a production-shaped test: GET signer narinfo only, roll to a newer generation, invoke prune and observe the old generation retained, advance TTL or shut down with no NAR/traffic, then observe release and successful pruning. Do not depend on a future request, extend TTL indefinitely, double-release a taken lease, or delete active response-owned data.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/integration/merged_cache_test.ts tests/integration/http_cache_test.ts --filter "idle expiry|handler close|release exactly once|narinfo without NAR"</automated>
  </verify>
  <done>WR-06 is closed: idle signer pins expire independently, every registry ownership transition releases exactly once, and daemon/handler shutdown releases retained generations without later traffic.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Linearize writer build admission against close and drain direct builds</name>
  <files>src/hashtree/writer.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts</files>
  <behavior>
    - WR-07: a build admitted before close is registered in the active-operation set before its first asynchronous yield; close remains pending until that operation and returned handle ownership reach the documented terminal state.
    - Once close changes state from open to closing, every later direct or scheduler build rejects before creating a run row, index, blob, file handle, or other side effect.
    - Concurrent close calls share the same completion promise; ledger checkpoint/close and final sweep happen once after active operations drain.
    - Build success, error, abort, iterator failure, and handle construction failure unregister in `finally`; no active-operation entry or run artifact leaks.
    - Direct builds blocked at source iteration, file read, inventory construction, and handle return can race close without SQLite errors, early ledger closure, or deadlock.
  </behavior>
  <action>Write direct concurrency tests with deterministic gates, not scheduler serialization: start one or more builds whose async source/file seam blocks; call `close`; assert close has not resolved and ownership persistence remains usable; attempt another build and assert immediate rejection with no database/filesystem delta; release/fail/abort the admitted builds; dispose any returned handles; assert close resolves, database handles are closed, artifacts are reconciled, and repeated close returns the same outcome. Cover simultaneous admitted builds completing in reverse order and failure in one while another succeeds.

Implement a linearizable lifecycle state machine (`open` → `closing` → `closed`) and one memoized close promise. At the synchronous start of public `build`, check `open`, create a deferred operation token/promise, and insert it into `#active` before invoking any async implementation or returning control. Move the existing body to a private `#build`; wrap its full await in `try/finally` that resolves/removes the operation. Avoid the async-function pre-await race by making public `build` a non-async admission wrapper returning the tracked private promise, or use an equivalent synchronous registration primitive. `close` flips to closing synchronously, aborts owned operation controllers if the contract chooses cancellation, awaits a stable snapshot/drain condition that also accounts for every pre-close admission, then performs reconciliation/checkpoint/database close once. Clarify whether returned build handles must be disposed before close completes; prefer close to track and dispose outstanding writer-owned handles safely rather than hang on an abandoned caller, while preserving durable owners. Keep scheduler close ordering compatible. Do not poll, use sleeps, clear `#active` prematurely, or close the ledger while any admitted operation can still touch it.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts --filter "close build race|active operation|reject after closing" &amp;&amp; deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/publication_batch_test.ts --filter "writer close"</automated>
  </verify>
  <done>WR-07 is closed: direct builds are synchronously registered, close drains every admitted operation and rejects all later work, and persistent state closes only after safe terminal cleanup.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Retain run-index cleanup tombstones until all files are absent</name>
  <files>src/persistence/write_repository.ts, src/hashtree/writer.ts, tests/protocol/hashtree_writer_test.ts</files>
  <behavior>
    - WR-08: releasing or abandoning a writer run records cleanup-pending durably before removing ownership; its index path remains recoverable until base SQLite, `-wal`, and `-shm` are each successfully removed or confirmed absent.
    - Failure deleting any one suffix retains the tombstone and records retryable progress without reintroducing blob ownership or deleting referenced content.
    - Every writer/repository startup retries all cleanup-pending records before accepting builds; a later successful retry removes remaining files then deletes the tombstone transactionally.
    - Crash between each file deletion and tombstone completion is idempotent on reopen; `NotFound` is success, while permission/I/O failure is not silently discarded.
    - Full verification passes and a new deep re-review reports zero warnings and no critical findings.
  </behavior>
  <action>Add a deterministic filesystem fault injector at the writer cleanup boundary and test failures for the base index, WAL, and SHM separately, including partial success followed by process-style reopen. Inspect durable rows after each attempt: the run owner may be released, but a cleanup journal/tombstone must retain the canonical validated index path and pending state; referenced content owners remain untouched. On the next writer construction, allow deletion and prove all three paths absent plus the cleanup record removed. Add crash injections after base deletion, after WAL deletion, after SHM deletion, and immediately before journal completion; every reopen converges without error or lost retry information.

Separate run liveness from file cleanup. Add a `writer_run_cleanup` table (or keep `writer_runs` rows in an explicit `cleanup_pending` state) keyed by run owner with canonical index path, session, and optional completion bits/attempt code. In one transaction, terminal/abandoned run processing releases `blob_owners` and transitions the run to cleanup-pending; it must not delete the only path record first. Outside the database transaction, close every index handle, then attempt exact base/`-wal`/`-shm` removals under the writer root. Treat successful removal and `NotFound` as absent; on any other error retain the tombstone for later retry and continue safe startup without claiming cleanup success. Only after a complete absence check should a transaction delete the tombstone/run row. Retry tombstones during ownership initialization, handle disposal, and writer close. Validate paths are generated by the writer and remain within the candidate root; never accept arbitrary persisted deletion targets or use broad globs.

After focused tests, run `deno task verify`. Then execute a fresh deep code re-review of the production lifecycle and new discriminating tests against WR-06, WR-07, and WR-08. Fix and rerun until the review reports zero warnings/critical findings; retain historical review evidence rather than editing findings away. Preserve canonical output, atomic pending ownership, distinct-live-byte quota, exact-generation response leases, availability barriers, and all existing NIP.md behavior.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts --filter "cleanup tombstone|WAL|SHM|retry deletion" &amp;&amp; deno task verify</automated>
  </verify>
  <done>WR-08 is closed, the complete verification matrix passes, and a fresh deep re-review reports zero warnings and zero critical findings.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| Narinfo route pin to idle time/shutdown | An exact-generation lease remains live without a subsequent NAR request and must expire or close independently. |
| Direct writer build to writer close | Concurrent callers cross the persistent ledger lifecycle boundary and must be admitted or rejected atomically. |
| Durable run state to filesystem cleanup | Database liveness records govern deletion/retry of exact SQLite index, WAL, and SHM paths. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-osc-01 | Denial of Service | idle signer route leases | medium | mitigate | Timer-driven TTL purge, handler/registry close, exact-once release tests, and daemon drain wiring. |
| T-osc-02 | Denial of Service | writer close/build race | high | mitigate | Synchronous build registration, linear lifecycle state, memoized close drain, and blocked direct-build concurrency tests. |
| T-osc-03 | Denial of Service | failed index deletion | medium | mitigate | Durable cleanup tombstones retained through verified base/WAL/SHM absence and retried on every startup/close. |
| T-osc-04 | Tampering | cleanup target path | high | mitigate | Persist only writer-generated root-contained canonical index paths; reject traversal/arbitrary deletion targets. |
| T-osc-SC | Tampering | package supply chain | low | accept | No install occurs; existing pinned dependencies are used. |
</threat_model>

<source_coverage_audit>

| Source | Item | Coverage |
|---|---|---|
| GOAL | Final lifecycle cleanup closes without weakening bounded, streamed, restart-safe cache behavior | Tasks 1-3 |
| REQ | READ-03 immutable request/generation snapshots | Task 1 |
| REQ | PUBL-02 bounded durable writer | Tasks 2-3 |
| REQ | OPER-04 discriminating lifecycle/fault/full verification | Tasks 1-3 |
| REVIEW | WR-06 signer route leases lack idle/shutdown cleanup | Task 1 |
| REVIEW | WR-07 writer close does not track direct builds | Task 2 |
| REVIEW | WR-08 failed index deletion loses retry record | Task 3 |
| REQUEST | Full `deno task verify` and zero-warning deep re-review | Task 3 |

All current warnings are required closure scope; none is deferred or reduced.
</source_coverage_audit>

<verification>
Execute each task test-first with atomic RED/GREEN/refactor commits. Use injected clocks/timers, blocked direct builds, and per-suffix filesystem faults rather than sleeps or nondeterministic races. Run focused suites, then `deno task verify`. Finally run a fresh deep review and continue fixing until WR-06, WR-07, and WR-08 are closed with zero warnings and no critical regression. Preserve unrelated cache/backlog files and all previously closed security/lifecycle invariants.
</verification>

<success_criteria>
- Idle/unused signer route leases expire without traffic and all handler/registry shutdown paths release retained ownership exactly once.
- Direct writer builds admitted before close drain safely; builds after closing begins reject without side effects; concurrent close is idempotent.
- Run-index cleanup retains a durable retry record until SQLite, WAL, and SHM are confirmed absent across faults/crashes/restarts.
- Focused tests and `deno task verify` pass.
- A fresh deep re-review reports zero critical findings and zero warnings.
</success_criteria>

<output>
Create `.planning/quick/260812-osc-close-final-deep-review-warnings-wr-06-t/260812-osc-SUMMARY.md` when done.
</output>
