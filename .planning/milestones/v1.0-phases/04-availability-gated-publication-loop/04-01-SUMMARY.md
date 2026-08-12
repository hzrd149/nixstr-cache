---
phase: 04-availability-gated-publication-loop
plan: 01
subsystem: publication
tags: [sqlite, nostr, blossom, streaming, eventstore]
requires:
  - phase: 03-signer-gated-writable-cache
    provides: durable pending candidates, immutable inventory, and owned signer lifecycle
provides:
  - Durable monotone publication saga with immutable candidate and destination snapshots
  - Same-server complete-replica proof before owner-checked event signing
  - Exact signed-event persistence and configured-relay acknowledgement barrier
  - Commit-before-normal-EventStore admission with idempotent replay
affects: [04-02, publication-repair, relay-retry, runtime-wiring]
tech-stack:
  added: []
  patterns: [durable publication saga, persistence-before-side-effect, same-server proof matrix]
key-files:
  created: [src/blossom/publication_uploader.ts, src/write/publication_coordinator.ts, tests/integration/publication_loop_test.ts]
  modified: [src/persistence/write_repository.ts, src/signer/capability.ts]
key-decisions:
  - "Use a serialized, repository-authoritative coordinator so duplicate ticks cannot sign or publish a second event."
  - "Verify signed template equality and Nostr validity again at the persistence boundary, not only in the coordinator."
patterns-established:
  - "Publication barriers advance monotonically: claim, complete proof, exact signed event, relay OK, commit, admission."
  - "Possession proofs are keyed by the immutable candidate, snapshotted server, and inventory hash."
requirements-completed: [PUBL-03, PUBL-04, OPER-04]
coverage:
  - id: D1
    description: "One complete same-server replica is required before signing."
    requirement: PUBL-03
    verification:
      - kind: integration
        ref: "tests/integration/publication_loop_test.ts#one complete replica publishes exact event through normal admission"
        status: pass
    human_judgment: false
  - id: D2
    description: "The exact event is durable before a configured relay OK permits commit and normal admission."
    requirement: PUBL-04
    verification:
      - kind: integration
        ref: "tests/integration/publication_loop_test.ts#hostile signer and false relay fail before promotion"
        status: pass
    human_judgment: false
  - id: D3
    description: "Duplicate ticks and retries reuse durable event state."
    requirement: OPER-04
    verification:
      - kind: integration
        ref: "tests/integration/publication_loop_test.ts#one complete replica publishes exact event through normal admission"
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-12
status: complete
---

# Phase 4 Plan 1: Availability-Gated Publication Tracer Summary

**A restart-safe SQLite publication saga now streams and proves one complete Blossom replica before signing, persists the exact verified event before relay I/O, and commits it only after a configured true acknowledgement before normal selector admission.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-12T15:28:20Z
- **Completed:** 2026-08-12T15:34:06Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added an immutable candidate/destination snapshot, per-server proof matrix, exact signed event, acknowledgement, commit, and admission record.
- Added a backpressured file-stream Blossom uploader that validates bounded descriptors and verifies possession through bounded incremental SHA-256 GET.
- Added owner-rechecked signing and a serialized coordinator that preserves proof, signing, relay, commit, and EventStore admission ordering.

## Task Commits

1. **Task 1 RED:** `9bd6400` (test)
2. **Task 1 GREEN:** `5a58017` (feat)
3. **Task 2 RED:** `55a36b0` (test)
4. **Task 2 GREEN:** `9f486e4` (feat)

## Files Created/Modified

- `src/persistence/write_repository.ts` - Durable publication saga and barrier methods.
- `src/blossom/publication_uploader.ts` - Streamed immutable upload and verified possession.
- `src/write/publication_coordinator.ts` - Monotone publication orchestration and replay.
- `src/signer/capability.ts` - Ready-state and ownership-checked event signing.
- `tests/integration/publication_loop_test.ts` - Barrier, hostile relay, idempotence, and persistence-boundary coverage.

## Decisions Made

- Always use verified streamed GET for possession evidence in this tracer; it is stronger than accepting HEAD metadata and avoids ambiguous status-only proof.
- Keep relay publication behind a typed acknowledged publisher boundary so later repair/retry plans can add RelayPool scheduling without weakening the commit barrier.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added repository-level signed-event verification**
- **Found during:** Task 2
- **Issue:** Coordinator verification alone left the persistence method callable with mismatched signer output.
- **Fix:** Compare all template fields, verify the Nostr event, and validate the publication again before durable storage.
- **Files modified:** `src/persistence/write_repository.ts`, `tests/integration/publication_loop_test.ts`
- **Verification:** Focused suite and all 77 integration tests pass.
- **Committed in:** `9f486e4`

**Total deviations:** 1 auto-fixed (1 Rule 2)

## Issues Encountered

None remaining.

## User Setup Required

None.

## Next Phase Readiness

The tracer barriers are ready for replica repair, retry scheduling, diagnostics, and production runtime wiring in the remaining Phase 4 plans.

## Self-Check: PASSED

- All created files exist.
- All four task commits exist.
- Focused suite: 3 passed.
- Integration suite: 77 passed.
- `deno task check`, `deno fmt --check`, and `deno lint`: passed.

---
*Phase: 04-availability-gated-publication-loop*
*Completed: 2026-08-12*
