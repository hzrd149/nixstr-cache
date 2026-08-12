---
phase: 04-availability-gated-publication-loop
reviewed: 2026-08-12T17:05:00Z
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
  critical: 3
  warning: 3
  info: 0
  total: 6
status: issues_found
---

# Phase 04: Milestone Code Review Report

**Reviewed:** 2026-08-12T17:05:00Z  
**Depth:** deep  
**Files Reviewed:** 55  
**Status:** issues_found

## Summary

The implementation has strong validation, address pinning, bounded network reads, and exact NIP-46 template checks, but it is not ready to ship. The publication state machine cannot advance from an admitted root to a newly built root, the durable writer leaks per-build indexes and candidate storage, and overlay history grows without reclamation. Passing tests cover one publication followed by refresh of the same root; they do not exercise the normal second-update lifecycle or resource cleanup.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: A completed saga permanently blocks every later cache update

**File:** `src/persistence/write_repository.ts:548-625`, `src/persistence/write_repository.ts:776-817`, `src/write/publication_coordinator.ts:99-110`

**Issue:** `recordPending()` replaces the singleton pending candidate, but `claimPublication()` always returns the existing saga, including when it is already committed and admitted. Nothing archives/removes that saga when a newer pending generation exists. `beginPublicationRefresh()` only clones the old saga/root near expiration. Consequently, after the first successful publication, later PUTs can build and overwrite `pending_candidate`, but the coordinator continues processing the admitted old root forever; the new cache generation is never signed or published. This breaks the core mutable-cache workflow and can silently strand all updates after the first.

**Fix:** In one transaction, when the active saga is admitted and a pending candidate has a newer generation, archive the old saga, move/retain its repair work as required, promote the pending candidate to a new saga, and clear the consumed pending singleton. Keep same-root expiration refresh separate from new-generation promotion. Add a test that publishes generation 1, stages/commits generation 2, ticks the coordinator, and proves the second event has the new root and a greater `created_at`.

### CR-02: Hashtree builds leak their SQLite index on every success and leak open state on failures

**File:** `src/hashtree/writer.ts:71-79`, `src/hashtree/writer.ts:373-388`

**Issue:** Every build creates `inventory-<uuid>.sqlite`. On success it closes the database but deliberately leaves the index behind because the returned inventory iterator reopens it; no consumer or owner has a disposal API and no later code removes it. On any exception or abort before line 373, the database is not closed at all and the index is also retained. Repeated batches or attacker-triggerable build failures therefore consume disk (including WAL/SHM state) and file descriptors without a bound. Candidate blobs written before a failed build are also never associated with a reclaimable run. This violates the daemon's bounded-resource and long-running durability guarantees.

**Fix:** Return a disposable build/run handle whose iterator lifetime is explicit, and have `PublicationBatchScheduler` dispose it in `finally` after `recordPending()` consumes the inventory. Wrap the database in `try/finally` so all failures close it. Track candidate blobs by run/reference and garbage-collect unreferenced blobs after failed or superseded runs; remove the SQLite/WAL/SHM files atomically after consumption. Test success, abort, size drift, and `recordPending()` failure cleanup.

### CR-03: Overlay generations and staged content have no reclamation path

**File:** `src/persistence/write_repository.ts:289-338`, `src/persistence/write_repository.ts:346-380`, `src/persistence/write_repository.ts:1067-1083`

**Issue:** Each commit copies every row from the previous generation into a new generation, but no production path deletes obsolete `overlay_entries`/`overlay_store_paths` generations. Committed staged blobs remain referenced by `staged_blobs` indefinitely, and `discard()` is used only for rejected narinfo. Thus a normal long-running sequence of uploads grows SQLite history roughly with every generation and retains every staged/candidate object forever. The configured aggregate staging ceiling eventually makes the writable cache permanently return 413 even though old generations are no longer needed. This is a functional availability failure, not merely a performance concern.

**Fix:** Define retention ownership explicitly. After a generation is durably published/admitted (while retaining anything needed by the active read snapshot and retry saga), prune older overlay rows, stale staged metadata, publication batch rows, unused candidate indexes, and unreferenced blob files transactionally. Compute the staging quota over live referenced objects, not historical rows. Add a low-ceiling multi-generation test proving old content is reclaimed without breaking the current overlay or publication repair.

## Warnings

### WR-01: File reconstruction materializes the entire chunk descriptor list before streaming

**File:** `src/hashtree/reader.ts:319-403`

**Issue:** `#fileStream()` walks every file-manifest node and pushes every leaf into `chunks` before returning a body. Although byte payloads remain streamed and global limits cap the list, response startup and memory scale with the whole NAR's chunk count, contrary to the project's no-whole-dataset control-data requirement. Cancellation cannot stop traversal once the HTTP handler is awaiting `resolve()` except through the supplied signal.

**Fix:** Implement a bounded lazy DFS iterator that yields chunk descriptors into the response stream, retaining only the traversal stack. Validate the authenticated aggregate size incrementally and preserve cancellation between every manifest/chunk operation.

### WR-02: Publication shutdown cannot cancel in-flight upload, proof, signing, or relay work

**File:** `src/write/publication_coordinator.ts:59-84`, `src/write/publication_coordinator.ts:130-203`, `src/blossom/publication_uploader.ts:53-121`

**Issue:** `PublicationCoordinator` has no abort controller and passes no signal to replica operations. `close()` clears only the timer and then waits for `#serial`; signer and relay calls are likewise not cancellation-aware at this boundary. SafeFetcher timeouts bound Blossom requests, but shutdown can still wait for a full inventory/server pass or an unbounded signer/relay dependency. This weakens deterministic daemon shutdown and can delay repository closure indefinitely.

**Fix:** Add a coordinator-owned `AbortController`, pass its signal through `ReplicaPublisher.prove`, upload/proof requests, signer calls where supported, and relay publication timeouts. Abort before awaiting `#serial` in `close()`, and restore claimed durable work to retry on cancellation.

### WR-03: Tests validate refresh of an old root but never a second real update or build cleanup

**File:** `tests/integration/publication_recovery_test.ts:87-117`, `tests/integration/publication_loop_test.ts:1-206`, `tests/protocol/hashtree_writer_test.ts:1-215`

**Issue:** The recovery test explicitly expects refresh to keep the committed candidate root, and the loop tests seed only one candidate. Writer tests use temporary parent directories that are removed wholesale by the test harness, masking production leaks. Therefore the suites pass while CR-01 through CR-03 remain observable in production.

**Fix:** Add discriminating lifecycle tests for two distinct published generations, pending replacement while repair is active, restart with both an admitted saga and newer pending candidate, cleanup after successful and failed/aborted builds, and quota recovery after pruning.

---

_Reviewed: 2026-08-12T17:05:00Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: deep_
