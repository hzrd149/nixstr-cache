---
phase: 03-signer-gated-writable-cache
plan: 02
subsystem: writable-cache
tags: [sqlite, rxjs, dependency-closure, immutable-snapshot, nix-http]
requires:
  - phase: 03-signer-gated-writable-cache
    provides: signer-owned streamed PUT staging and durable immutable blobs
  - phase: 02-deterministic-merged-read-cache
    provides: ordered publisher snapshots and winner-pinned NAR routing
provides:
  - Bounded durable reverse-dependency eligibility with cycle-safe fixed-point admission
  - Atomic immutable signer overlay generations restored across restart
  - Signer-first Narinfo and NAR reads pinned to one captured generation
affects: [03-03-hashtree-batching, 04-publication]
tech-stack:
  added: []
  patterns: [affected-only recursive SQLite queue, atomic generation pointer, immutable signer route provenance]
key-files:
  created: [src/write/eligibility.ts, src/write/overlay.ts]
  modified: [src/persistence/write_repository.ts, src/nix/http_handler.ts, src/nix/merged_cache.ts, src/runtime/daemon.ts, tests/integration/writable_cache_test.ts]
key-decisions:
  - "Treat only the current atomic overlay generation as readable; mutable staging and future pending publication state are never resolver inputs."
  - "Resolve lower-layer reference anchors against the publisher snapshot captured by eligibility work, while signer candidates advance through a monotone fixed point."
  - "Pin signer NAR routes to the exact immutable generation that supplied their Narinfo."
patterns-established:
  - "Durable reverse edges seed bounded affected-only recomputation in stable store-path order."
  - "Generation membership is copied forward and the singleton current pointer changes in the same SQLite transaction."
requirements-completed: [WRIT-05, WRIT-06]
coverage:
  - id: D1
    description: "A staged Narinfo is admitted only with its verified NAR and a dependency closure anchored in committed signer or publisher state; unresolved cycles remain invisible."
    requirement: WRIT-05
    verification:
      - kind: integration
        ref: "tests/integration/writable_cache_test.ts#reverse dependencies cycles restart and concurrent generations remain closed"
        status: pass
    human_judgment: false
  - id: D2
    description: "Eligible content commits atomically as a restart-safe highest-priority signer generation, with Narinfo-to-NAR provenance pinned across later commits."
    requirement: WRIT-06
    verification:
      - kind: integration
        ref: "tests/integration/writable_cache_test.ts#complete object commits to signer-first immutable overlay"
        status: pass
      - kind: integration
        ref: "tests/integration/merged_cache_test.ts"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-08-12
status: complete
---

# Phase 3 Plan 2: Dependency-Closed Signer Overlay Summary

**Bounded reverse-dependency closure now atomically promotes complete uploads into restart-safe signer-first generations whose Narinfo and NAR bodies remain pinned per request.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-12T14:37:00Z
- **Completed:** 2026-08-12T14:45:26Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added normalized durable Narinfo/reference rows, reverse indexes, bounded affected-set traversal, and a monotone fixed point that cannot bootstrap an unanchored dependency cycle.
- Added atomic immutable overlay generations and restart restoration, with only the committed current generation exposed to readers.
- Prepended the signer layer to publisher reads and pinned signer Narinfo NAR routes to the captured generation, while retaining existing publisher merge behavior below it.
- Wired post-transaction staging notifications into serialized eligibility work and lower-layer publisher checks without introducing signing, publication, or pending-publication exposure.

## Task Commits

1. **Task 1 RED: signer overlay tracer behavior** - `d96eb38` (test)
2. **Task 1 GREEN: dependency-closed signer-first tracer** - `6c6744c` (feat)
3. **Task 2 RED: reverse dependency, cycle, restart, and concurrency behavior** - `7fd19cf` (test)
4. **Task 2 GREEN: reactive production closure and bounded signer routing** - `79dbfbf` (feat)
5. **Task 2 correction: durable staging change signals** - `b85e2d9` (fix)
6. **Task 2 correction: lint-clean overlay import** - `961a0ba` (fix)

## Files Created/Modified

- `src/write/eligibility.ts` - Serialized bounded affected-set fixed-point eligibility.
- `src/write/overlay.ts` - Frozen current-generation snapshots and file-stream resolver.
- `src/persistence/write_repository.ts` - Durable graph, reverse edges, change signals, and atomic overlay generations.
- `src/nix/http_handler.ts` - Request-entry signer snapshot, signer-first resolution, and generation-pinned NAR reads.
- `src/nix/merged_cache.ts` - Bounded TTL signer-generation route registry alongside publisher provenance.
- `src/runtime/daemon.ts` - Production overlay composition and publisher-backed lower-layer availability checks.
- `tests/integration/writable_cache_test.ts` - Complete/incomplete, cycle, anchor, restart, concurrency, and immutable snapshot coverage.

## Decisions Made

- A lower-layer reference is an eligibility anchor only after bounded HEAD resolution in the current publisher snapshot; publisher arrays are not mutated.
- Eligibility notifications occur only after durable staging/Narinfo transactions, and one promise chain serializes concurrent completions.
- Old generation rows and immutable blob paths remain available so captured snapshots can finish independently of later generations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed an unused signer snapshot type import found by lint**
- **Found during:** Overall verification
- **Issue:** The completed bounded signer route registry made the direct handler type import stale.
- **Fix:** Removed the unused import.
- **Files modified:** `src/nix/http_handler.ts`
- **Verification:** `deno lint` passes.
- **Committed in:** `961a0ba`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** No scope expansion; the correction was required for the repository lint gate.

## Issues Encountered

- Task 2's first staging command omitted `src/persistence/write_repository.ts` because an invalid path made that staging invocation fail atomically. The repository signal change was immediately committed separately as `b85e2d9`; no changes were lost or mixed with unrelated work.

## User Setup Required

None beyond Plan 03-01's writable-cache configuration.

## Next Phase Readiness

- Plan 03-03 can freeze the committed dependency-closed generation as its deterministic Hashtree build input.
- Phase 4 can consume generations as a publication handoff without reading staging rows.
- No pending root, signing, Blossom upload, or publication state is exposed by this plan.

## Self-Check: PASSED

- All created and modified implementation files exist.
- Commits `d96eb38`, `6c6744c`, `7fd19cf`, `79dbfbf`, `b85e2d9`, and `961a0ba` exist.
- Both cumulative integration suites, `deno task check`, `deno fmt --check`, and `deno lint` pass.

---
*Phase: 03-signer-gated-writable-cache*
*Completed: 2026-08-12*
