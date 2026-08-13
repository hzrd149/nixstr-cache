---
phase: 04-availability-gated-publication-loop
reviewed: 2026-08-12T19:12:00Z
re_review_of: 2026-08-12T18:58:00Z
head: 31fc58b
depth: deep
files_reviewed: 55
files_reviewed_list:
  - main.ts
  - src/app.ts
  - src/blossom/blob_fetcher.ts
  - src/blossom/cache_sink.ts
  - src/blossom/publication_uploader.ts
  - src/blossom/source_plan.ts
  - src/config/config.ts
  - src/hashtree/reader.ts
  - src/hashtree/writer.ts
  - src/network/safe_fetcher.ts
  - src/nix/http_handler.ts
  - src/nix/merged_cache.ts
  - src/nostr/blossom_servers.ts
  - src/nostr/local_relay_cache.ts
  - src/nostr/selection.ts
  - src/operations/diagnostics.ts
  - src/operations/health.ts
  - src/persistence/state_repository.ts
  - src/persistence/write_repository.ts
  - src/protocol/hashtree.ts
  - src/protocol/narinfo.ts
  - src/protocol/nhash.ts
  - src/protocol/publication.ts
  - src/runtime/daemon.ts
  - src/signer/capability.ts
  - src/write/batch_scheduler.ts
  - src/write/eligibility.ts
  - src/write/overlay.ts
  - src/write/publication_coordinator.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
  - tests/e2e/nix_substitution_test.ts
  - tests/integration/address_pinning_test.ts
  - tests/integration/blossom_discovery_test.ts
  - tests/integration/blossom_publication_test.ts
  - tests/integration/health_diagnostics_test.ts
  - tests/integration/hostile_blossom_test.ts
  - tests/integration/http_cache_test.ts
  - tests/integration/merged_cache_test.ts
  - tests/integration/nip46_signer_test.ts
  - tests/integration/operator_config_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/publication_loop_test.ts
  - tests/integration/publication_recovery_test.ts
  - tests/integration/publication_selection_test.ts
  - tests/integration/relay_publication_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/protocol/hashtree_test.ts
  - tests/protocol/hashtree_writer_test.ts
  - tests/protocol/narinfo_test.ts
  - tests/protocol/publication_test.ts
  - tests/fixtures/nostr_connect.ts
  - tests/fixtures/publication.ts
  - tests/fixtures/bud/README.md
  - tests/fixtures/nix/README.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: passed
---

# Phase 04: Milestone Code Re-review Report

## Final Confirmation Re-review — 2026-08-12

**HEAD:** `31fc58b`  
**Status:** passed

Fresh source-wide review confirms WR-06, WR-07, and WR-08 are closed and finds
no new Critical or Warning issue. The callable HTTP handler now owns and closes
its route registries during daemon drain; idle signer leases expire on an
independent earliest-deadline timer with exact-once release. Writer builds are
registered synchronously before asynchronous work, close rejects new admission,
drains active operations and returned handles, then checkpoints/closes its
ledger. Index cleanup paths are journaled before run liveness is removed and
failed filesystem deletion retains a tombstone for retry on reopen.

The final focused read-only verification passed 42/42 tests across Hashtree
writer lifecycle, handler/registry lifecycle, batching, publication rollover,
repair, cancellation, quota, and writable-cache behavior. Cross-file review
also reconfirmed the historical CR-01 through CR-06 and WR-01 through WR-05
closures, SSRF address pinning/manual redirects, bounded streaming, exact signer
template validation, and durable relay/admission ordering.

Final result: zero Critical findings, zero Warnings. All reports below are
retained as superseded historical evidence.

## Zero-Warning Lifecycle Re-review — 2026-08-12

**HEAD:** `42fc03f`  
**Status:** passed

Fresh deep review closes WR-06, WR-07, and WR-08 without reopening any prior
finding. `SignerRouteRegistry` now schedules one earliest-expiry timer and all
removal paths converge on exact-once lease release; the callable HTTP handler
closes both registries during daemon drain and rejects post-close work.
`HashtreeWriter.build()` registers synchronously before asynchronous work and
memoized close drains admitted builds plus returned handles before ledger
checkpoint/closure. Repository run release and abandonment now journal exact
index paths before dropping liveness, retain deletion failures, and retry base,
WAL, and SHM absence on reopen.

| Finding | Result | Discriminating evidence |
|---|---|---|
| WR-06 | Closed | Fake-timer exact-once expiry/replacement/eviction/take/close coverage and idempotent handler shutdown test. |
| WR-07 | Closed | A gated direct build keeps close pending; post-closing admission rejects before side effects; close then disposes the returned handle. |
| WR-08 | Closed | Injected permission failure retains `writer_run_cleanup`; a clean reopen removes remaining exact paths and tombstone. |

`deno task verify` passed at this HEAD: 23 protocol tests, 100 integration
tests, and both stock-Nix E2Es. Review result: zero critical findings and zero
warnings. The 18:34 warning report remains below as historical evidence.

## Final Deep Re-review — 2026-08-12

**HEAD:** `968cca6`  
**Status:** issues_found

All historical Critical findings CR-01 through CR-06 are closed. WR-01 through
WR-03 are also closed. The focused production lifecycle suites passed 39/39,
including ownership, quota, rollover, repair, cancellation, lazy streaming,
exact-generation pinning, and the writer test that previously failed with a
disk I/O error. Three cleanup/lifecycle warnings remain in the final code.

### WR-06: Signer route leases have no terminal handler-shutdown cleanup

**File:** `src/nix/http_handler.ts:91-95`, `src/nix/http_handler.ts:239-248`, `src/nix/merged_cache.ts:217-251`

**Issue:** A signer narinfo response transfers its generation lease into
`SignerRouteRegistry`, but the registry is local to the handler and its
`close()` method is never exposed or called by daemon shutdown. Expired entries
are purged only on a later `set()`/`take()`; there is no timer. A client that
fetches narinfo and never fetches the referenced NAR can therefore retain an
old generation for the entire daemon lifetime, preventing pruning. Entry count
is bounded, but retained historical rows and generation contents can be large.

**Fix:** Give the HTTP handler an explicit dispose hook and call
`signerRoutes.close()` during daemon shutdown. Alternatively schedule bounded
TTL eviction independent of later requests. Test narinfo-without-NAR followed
by rollover and shutdown, asserting the exact-generation lease is released and
the old generation becomes prunable.

### WR-07: HashtreeWriter.close() does not actually wait for direct active builds

**File:** `src/hashtree/writer.ts:96`, `src/hashtree/writer.ts:138-558`, `src/hashtree/writer.ts:560-569`

**Issue:** `close()` waits on `#active`, but `build()` never inserts or removes
any promise from that set. Production currently avoids the race because the
batch scheduler drains its serial queue before calling writer close, but the
public writer lifecycle itself can close its ledger while a direct build is
still recording ownership, causing SQLite errors or incomplete cleanup.

**Fix:** Wrap each build in a tracked operation promise (or maintain an active
counter plus drain promise), remove it in `finally`, and make `close()` reject
new builds before awaiting all existing builds. Add a test that blocks a build,
calls close concurrently, verifies close remains pending, then releases the
build and confirms clean closure.

### WR-08: Failed run-index deletion loses its durable retry record

**File:** `src/persistence/write_repository.ts:224-257`, `src/hashtree/writer.ts:515-535`

**Issue:** Restart reconciliation deletes each `writer_runs` row before removing
the associated index/WAL/SHM files. If filesystem deletion fails, the comment
says “retry next open,” but the path is no longer stored and cannot be retried.
Build disposal has the same ordering after `releaseWriterRun()`. Persistent
permission or transient filesystem failures can therefore accumulate orphaned
index files without durable cleanup state.

**Fix:** Retain a cleanup-pending row until all index files are absent, or move
index paths into a dedicated cleanup journal. Delete the durable record only
after successful/NotFound cleanup and retry pending rows on every open.

### Final Closure Matrix

| Historical finding | Final result |
|---|---|
| CR-01 saga rollover | Closed |
| CR-02 writer run/blob cleanup | Closed for normal/crash zero-owner paths; WR-08 remains for index deletion failures |
| CR-03 storage reclamation | Closed |
| CR-04 atomic ownership handoff | Closed in the shared repository transaction |
| CR-05 abandoned-owner sweeping | Closed |
| CR-06 live quota | Closed; distinct physical digests including current overlay are charged |
| WR-01 lazy traversal | Closed |
| WR-02 cancellation | Closed |
| WR-03 discriminating tests | Closed |
| WR-04 exact-generation leases | Partially closed; exact lease transfer works, shutdown/idle cleanup remains WR-06 |
| WR-05 writer close | Partially closed; normal scheduler closure works, direct active-build drain remains WR-07 |

The prior closure reports are retained below as historical evidence and are
superseded by this final verdict.

## Deep Re-review Closure — 2026-08-12

**HEAD:** `020ae43`  
**Status:** passed

Fresh review of the production ownership, quota, signer pinning, shutdown, and
their discriminating tests closes all five findings below. Candidate blob rows,
run owners, durable batch owners, and pending inventory now share the
`WriteRepository` SQLite transaction. Startup and terminal run release sweep
only ledger-proven zero-owner files, retaining failed deletions for retry.
Quota counts distinct physical staged digests including the current overlay.
Signer route pins retain exact-generation leases until response terminal state
or bounded registry cleanup. Scheduler shutdown explicitly closes the writer
before repository teardown.

| Finding | Result | Evidence |
|---|---|---|
| CR-04 | Closed | `recordPending()` validates run-owned inventory and installs `batch:<id>` owners with pending rows in one `BEGIN IMMEDIATE`. |
| CR-05 | Closed | Repository startup removes foreign run owners/indexes and retries zero-owner file/row sweep. |
| CR-06 | Closed | Aggregate reservation/admission sums distinct staged digests without a current-overlay exemption; low-ceiling shared/current test passes. |
| WR-04 | Closed | `SignerRouteRegistry` owns generation leases and terminal response wrapping releases the transferred lease. |
| WR-05 | Closed | `HashtreeWriter.close()` is idempotent and scheduler/daemon/test lifecycle closes it before repository/root deletion. |

Verification at this HEAD: 21 protocol tests, 99 integration tests, and both
stock-Nix E2Es passed through `deno task verify`; the prior writer cleanup
`disk I/O error` did not recur.

The original 17:48 findings are retained below as historical review evidence.

**Reviewed:** 2026-08-12T17:48:00Z  
**Depth:** deep  
**HEAD:** `f15ca60`  
**Status:** issues_found

## Summary

CR-01, WR-01, WR-02, and the behavioral portion of WR-03 are genuinely closed: two distinct generations roll over with monotonic events, file manifests are traversed lazily, and signer/relay work is abort-bounded. CR-02 and CR-03 are not fully closed. The new ownership ledger introduces a non-atomic repository/ledger handoff and incomplete crash sweep, while live-quota accounting excludes all committed cache bytes and therefore removes the configured disk ceiling.

The focused re-review command ran 26 tests: 25 passed and the canonical-boundary writer test failed with `disk I/O error` while cleaning ledger state. This exposed the missing writer-ledger close lifecycle described in WR-05.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-04: Pending candidate commit precedes durable blob ownership transfer

**File:** `src/write/batch_scheduler.ts:79-114`, `src/persistence/write_repository.ts:568-609`, `src/hashtree/writer.ts:489-519`

**Issue:** The scheduler first commits `pending_candidate` and its inventory to the repository, then calls `candidate.transferOwnership(batch:...)`. These are separate SQLite databases and no recovery marker bridges them. A crash or ownership-ledger error after `recordPending()` but before `transferOwnership()` leaves the repository authoritatively pointing at blobs owned only by a `run:*` row. On restart, run reconciliation treats that owner as abandoned and removes it; subsequent sweeping may delete the candidate bytes. The reverse failure is also unsafe: if transfer fails, `finally` disposes the run owner and can delete blobs while the pending candidate remains committed. Publication then retries missing paths and can never prove availability.

**Fix:** Implement an explicit cross-database ownership handoff journal. Persist a prepared batch owner before repository admission, commit the pending candidate, then mark the handoff committed; restart reconciliation must resolve prepared records against `pending_candidate`, batch, saga, and history rows before deleting either owner. On any synchronous `recordPending()` failure, release the prepared owner. Add crash-point tests after each step and reopen both databases to prove the pending inventory always has live files and an owner.

### CR-05: Abandoned-run reconciliation removes ownership rows but never sweeps their blobs

**File:** `src/hashtree/writer.ts:96-123`, `src/hashtree/writer.ts:543-558`

**Issue:** Startup reconciliation deletes `blob_owners` and `writer_runs` for old sessions and removes their index files, but it never invokes `#sweepUnowned()`. A process crash during a build therefore leaves every created content blob and its `content_blobs` ledger row indefinitely. Successful later builds with transferred ownership do not sweep either. Repeated crash/restart cycles can grow the candidate directory without bound, so CR-02's failure-path cleanup guarantee remains open.

**Fix:** Reconcile old runs transactionally, then sweep all zero-owner `content_blobs` before accepting another build. Make deletion retryable: retain ledger rows when filesystem deletion fails and retry on later startup/disposal. Add a restart test that leaves a foreign-session run plus unique blobs, constructs a new writer, and asserts index, owner, ledger row, and file are all removed.

### CR-06: Current cache bytes are excluded from the configured aggregate storage limit

**File:** `src/persistence/write_repository.ts:1138-1151`, `src/persistence/write_repository.ts:1212-1223`

**Issue:** Both quota queries exclude every staged blob whose route occurs in the current overlay. Because generations copy all prior routes forward, almost the entire writable cache becomes uncharged immediately after admission. An owner can therefore upload and commit an unbounded sequence of distinct NAR/store paths despite `stagingAggregateBytes`; physical files in `staged_blobs` remain present and are needed by the signer overlay. This defeats the project's mandatory bounded-resource guarantee and converts CR-03's cleanup change into an unbounded-disk regression.

**Fix:** Charge physical bytes once per distinct digest across all live staged/overlay generations and reservations. Reclamation may remove only content no longer referenced by the current overlay, leases, pending batches, active/history repair, or refresh state. If the writable cache itself needs a separate capacity, add an explicit bounded cache quota rather than excluding it. Add a low-ceiling multi-generation test whose routes remain in the current overlay and prove the next upload is rejected before disk use exceeds the configured ceiling.

## Warnings

### WR-04: Old pinned signer snapshots bypass generation leases

**File:** `src/nix/http_handler.ts:234-245`, `src/nix/http_handler.ts:270-283`, `src/write/overlay.ts:28-31`

**Issue:** Direct current-overlay NAR requests acquire a generation lease, but narinfo resolution stores the raw snapshot in `SignerRouteRegistry`; a later NAR request through `pinnedSigner` resolves that snapshot without acquiring a lease. Today staged files are never reclaimed, which masks the race. Once CR-06 is fixed with physical reclamation, pruning can delete the old generation/file between narinfo and NAR retrieval.

**Fix:** Store a lease-bearing registry entry, or reacquire the exact stored generation before resolving the pinned NAR. Release on TTL eviction/replacement and after response completion/cancellation. Add a rollover test that fetches old narinfo, admits/prunes a newer generation, then successfully streams the pinned old NAR.

### WR-05: HashtreeWriter owns a persistent SQLite handle with no close lifecycle

**File:** `src/hashtree/writer.ts:88-104`, `src/hashtree/writer.ts:543-558`

**Issue:** `#ownership()` caches a `DatabaseSync` connection for the writer lifetime, but `HashtreeWriter` exposes no `close()`/`dispose()`, and daemon shutdown only closes the batch scheduler. The focused suite reproduced a `disk I/O error` in cleanup at writer line 526 after temporary roots were removed while ledger handles remained live. Production normally creates one writer, but deterministic shutdown, tests, and reconfiguration cannot release the ledger/WAL resources correctly.

**Fix:** Add idempotent `HashtreeWriter.close()` that rejects new builds, waits for active handles or aborts them, checkpoints/closes the ledger, and wire it into scheduler/daemon shutdown after builds drain. Ensure every test closes writers before deleting temporary roots.

## Closure Matrix

| Prior finding | Re-review result |
|---|---|
| CR-01 generation rollover | Closed; distinct generation test and production E2E exercise it. |
| CR-02 writer cleanup | Still open as CR-04/CR-05/WR-05. |
| CR-03 reclamation/quota | Still open as CR-06; historical rows prune, but physical current bytes are uncharged. |
| WR-01 lazy traversal | Closed; pull-driven DFS retains bounded stack state. |
| WR-02 cancellation | Closed for configured production adapters; abort-first shutdown and operation deadlines are wired. |
| WR-03 test discrimination | Partially closed; two-generation/cancellation tests exist, but crash handoff, abandoned-blob sweep, and charged-current-cache cases are absent. |

---

_Re-reviewed: 2026-08-12T17:48:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: deep_
