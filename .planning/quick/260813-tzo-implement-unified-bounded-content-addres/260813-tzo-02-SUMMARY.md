---
phase: 260813-tzo-implement-unified-bounded-content-addres
plan: "02"
subsystem: storage
tags: [blob-store, hashtree, streaming, leases, backpressure]
requires:
  - phase: 260813-tzo-01
    provides: bounded content-addressed BlobStore and legacy migration
provides:
  - persistent verified remote cache admission with single-flight misses
  - ordered Hashtree output protected by transient leases through terminal stream state
  - manifest-only HEAD resolution with legacy partial-NAR size compatibility
affects: [260813-tzo-03, 260813-tzo-04, publication, runtime]
tech-stack:
  added: []
  patterns: [one active chunk lease at a time, abortable pending acquisition, terminal stream cleanup]
key-files:
  created: []
  modified: [src/blossom/blob_fetcher.ts, src/hashtree/reader.ts, src/runtime/daemon.ts, tests/integration/blob_store_test.ts, tests/integration/hostile_blossom_test.ts]
key-decisions:
  - "Keep decoded ManifestCache entries outside BlobStore ownership while raw manifest loads use short-lived verified leases."
  - "Cancel active readers and abort pending chunk acquisition before releasing resolver ownership on every error or cancellation path."
patterns-established:
  - "Verified remote bytes remain evictable after their final transient lease releases."
  - "File output opens only the next authenticated chunk, preserving ordering and Web Stream backpressure."
requirements-completed: []
coverage:
  - id: D1
    description: Persistent verified remote reads reuse bounded cached bytes without another network request.
    verification:
      - kind: integration
        ref: tests/integration/blob_store_test.ts#verified remote fetches remain cached and warm reads avoid the network
        status: pass
    human_judgment: false
  - id: D2
    description: Resolver streams ordered authenticated chunks and releases leases on EOF, cancellation, and error while HEAD avoids leaf opens.
    verification:
      - kind: integration
        ref: tests/integration/hostile_blossom_test.ts#resolver and traversal lease tests
        status: pass
    human_judgment: false
duration: 13min
completed: 2026-08-14
status: complete
---

# Quick Task 260813-tzo Plan 02: Persistent Remote Read Cache and Resolver Leases Summary

**Verified remote blobs now persist under the shared capacity ceiling while ordered Hashtree streams hold exactly the leases needed through EOF, cancellation, and validation errors.**

## Performance

- **Duration:** 13 min for the resumed Task 2; Task 1 completed in the prior session
- **Started:** 2026-08-14T09:46:00Z
- **Completed:** 2026-08-14T09:59:27Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Replaced remote temporary-spool ownership with verified BlobStore admission, warm reuse, deterministic eviction, and independent leases.
- Preserved authenticated traversal, transfer, decoded/output, attempt, hash, SSRF, and legacy partial-NAR compatibility constraints.
- Made ordered resolver streams abort pending chunk acquisition and release active leases on EOF, cancellation, and errors; HEAD continues to fetch manifests only.

## Task Commits

1. **Task 1: Replace temporary fetch spools with verified store admission** - `ded6fb3` (RED), `c7d9b71` (GREEN)
2. **Task 2: Stream resolver output through ordered transient leases** - `ac66cb4` (RED), `779a90b` (GREEN)

## Files Created/Modified

- `src/blossom/blob_fetcher.ts` - Admits verified remote streams and returns independently leased handles.
- `src/hashtree/reader.ts` - Resolves manifests and ordered raw chunks with terminal lease cleanup.
- `src/runtime/daemon.ts` - Constructs the shared store-backed fetcher and resolver.
- `tests/integration/blob_store_test.ts` - Covers persistence, reuse, races, eviction, and admission cleanup.
- `tests/integration/hostile_blossom_test.ts` - Covers bounded traversal, legacy sizes, HEAD behavior, ordering, and resolver lease errors.

## Decisions Made

- Keep only one raw chunk reader active at a time; cancellation aborts pending acquisition as well as the current reader.
- Retain ManifestCache as a decoded-memory cache independent of physical BlobStore accounting.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Repository-wide `deno fmt --check` sees unrelated untracked `config.old.json`; the two task files pass targeted formatting and lint gates. The file was preserved unchanged.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can build PUT chunk ownership and publication recovery on the same shared BlobStore. No Plan 02 blocker remains.

## Self-Check: PASSED

- All five claimed modified files exist.
- Commits `ded6fb3`, `c7d9b71`, `ac66cb4`, and `779a90b` exist.
- Focused hostile Blossom suite passes 19 tests and `deno task check` passes.

---
*Phase: 260813-tzo-implement-unified-bounded-content-addres*
*Completed: 2026-08-14*
