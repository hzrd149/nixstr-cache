---
phase: 03-signer-gated-writable-cache
plan: 03
subsystem: persistence
tags: [deno, sqlite, msgpack, hashtree, scheduler, streaming]
requires:
  - phase: 03-signer-gated-writable-cache
    provides: durable immutable signer overlay generations and staged files
provides:
  - Tokenized five-second quiet and sixty-second maximum publication batch claims
  - Canonical streaming plaintext BUD Hashtree construction with persistent content reuse
  - Restart-safe unpublished pending candidate and dependency-closed blob inventory
affects: [phase-04-publication, blossom-replication, nostr-publication]
tech-stack:
  added: []
  patterns: [persisted timer token, serialized promise worker, content-addressed copy-on-write]
key-files:
  created: [src/write/batch_scheduler.ts, src/hashtree/writer.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts]
  modified: [src/persistence/write_repository.ts, src/protocol/hashtree.ts, src/protocol/nhash.ts, src/runtime/daemon.ts, deno.json]
key-decisions:
  - "Freeze batch membership by copying one immutable overlay generation into durable batch-entry rows before building."
  - "Recover interrupted building rows as failed and deterministically rebuild them from frozen files on scheduler construction."
  - "Retain candidate blobs by content hash and atomically replace pending metadata only after the complete reachable inventory exists."
patterns-established:
  - "Publication scheduling uses one persisted monotonic window token and one serialized worker chain."
  - "Pending publication state has separate tables and APIs from the committed signer overlay."
requirements-completed: [PUBL-01, PUBL-02]
coverage:
  - id: D1
    description: "Eligible generations freeze exactly once after five quiet seconds or sixty sustained seconds and builds remain serialized."
    requirement: PUBL-01
    verification:
      - kind: integration
        ref: "tests/integration/publication_batch_test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Frozen routes produce deterministic canonical plaintext Hashtrees with bounded chunks, fanout, and persistent blob reuse."
    requirement: PUBL-02
    verification:
      - kind: unit
        ref: "tests/protocol/hashtree_writer_test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pending candidates survive restart while committed reads remain unchanged and Phase 3 performs no signing or publication."
    requirement: PUBL-02
    verification:
      - kind: integration
        ref: "tests/integration/publication_batch_test.ts#workers serialize and an interrupted frozen batch rebuilds after restart"
        status: pass
      - kind: integration
        ref: "tests/integration/publication_batch_test.ts#phase three daemon contains no signing upload publish or pending-root promotion"
        status: pass
    human_judgment: false
duration: 15min
completed: 2026-08-12
status: complete
---

# Phase 3 Plan 3: Durable Publication Batch and Hashtree Summary

**Deterministic quiet/max-delay batch freezing now builds a canonical persistent plaintext Hashtree and records only a restart-safe unpublished candidate.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-12T14:48:16Z
- **Completed:** 2026-08-12T15:03:16Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added atomic monotonic-token claims for five-second quiet and sixty-second sustained windows with one serialized build worker.
- Added streaming 2 MiB file chunking, canonical manifest encoding, bounded directory fanout, plaintext nhash encoding, and persistent content-addressed reuse.
- Added durable frozen batches and pending candidate inventories that recover after restart without changing the committed overlay or invoking Phase 4 side effects.

## Task Commits

1. **Task 1: Trace one quiet eligible generation into one durable unpublished root** — `7a762ce` (RED), `78227f2` (GREEN)
2. **Task 2: Close sustained-write, serialization, copy-on-write, restart, and phase-boundary cases** — `b59e4bd` (RED), `4670dbd` (GREEN), `5e2b90c` (REFACTOR)

## Files Created/Modified

- `src/write/batch_scheduler.ts` — persisted dual-timer window and serialized recovery worker.
- `src/hashtree/writer.ts` — bounded canonical plaintext tree construction and immutable blob reuse.
- `src/persistence/write_repository.ts` — frozen batch, failed recovery, and pending candidate transactions.
- `src/protocol/hashtree.ts` — canonical manifest encoder paired with the strict decoder.
- `src/protocol/nhash.ts` — strict plaintext root TLV/Bech32 encoder.
- `src/runtime/daemon.ts` — eligible-generation scheduling and shutdown drain integration.
- `tests/protocol/hashtree_writer_test.ts` — deterministic vectors, fanout, chunking, and COW reuse evidence.
- `tests/integration/publication_batch_test.ts` — timing, race, serialization, restart, and phase-boundary evidence.
- `deno.json` — scoped temporary filesystem permissions for protocol writer tests.

## Decisions Made

- A durable batch owns copied overlay-entry rows, so later staging or overlay mutations cannot change its membership.
- Candidate persistence replaces the pending pointer and inventory in one transaction only after all immutable files are durable.
- Content-addressed `createNew` writes provide copy-on-write reuse without trusting mutable base metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Granted protocol writer tests scoped temporary filesystem permissions**
- **Found during:** Full plan verification
- **Issue:** `deno task test` intentionally ran protocol tests without write access, but Hashtree writer tests require temporary durable files.
- **Fix:** Scoped the protocol test task to read the repository/temp directory and write only `/tmp`.
- **Files modified:** `deno.json`
- **Verification:** `deno task verify`
- **Committed in:** `4670dbd`

---

**Total deviations:** 1 auto-fixed (1 Rule 3)
**Impact on plan:** Required only to execute the planned durable writer tests; production permissions are unchanged.

## Issues Encountered

The tracer feedback gate paused after Task 1 and was explicitly approved after its focused test passed.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

Phase 4 can claim the durable pending candidate, replicate its complete inventory, prove availability, sign the cache-root event, and publish it. No Phase 3 code signs, uploads, publishes, or promotes pending state.

## Verification

- Focused plan suite: 7 passed, 0 failed.
- Full `deno task verify`: formatting, lint, type checks, 18 protocol tests, 72 integration tests, and stock-Nix E2E all passed.

## Self-Check: PASSED

- All key files exist.
- All five task commits exist in git history.
- PUBL-01 and PUBL-02 are marked complete.

---
*Phase: 03-signer-gated-writable-cache*
*Completed: 2026-08-12*
