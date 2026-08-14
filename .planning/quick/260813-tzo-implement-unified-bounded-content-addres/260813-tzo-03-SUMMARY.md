---
phase: 260813-tzo-implement-unified-bounded-content-addres
plan: 03
subsystem: persistence
tags: [blob-store, streaming, hashtree, publication, sqlite]
requires:
  - phase: 260813-tzo-02
    provides: persistent remote blob admission and resolver leases
provides:
  - Canonically chunked NAR PUT admission into the shared BlobStore
  - Hashtree construction from stored route components
  - Durable publication ownership transfer across batch and saga recovery
affects: [260813-tzo-04, writable-cache, publication]
tech-stack:
  added: []
  patterns: [transactional blob ownership, leased component streaming]
key-files:
  created: []
  modified: [src/persistence/blob_store.ts, src/persistence/write_repository.ts, src/hashtree/writer.ts, src/write/overlay.ts, src/runtime/daemon.ts]
key-decisions:
  - "NAR routes are represented by ordered fixed-size BlobStore components while small narinfo metadata retains the compatible scalar route representation."
  - "Writer-run ownership is transferred to batch and saga owners in the shared SQLite transaction domain before transient owners are released."
patterns-established:
  - "Writable byte streams enter the physical store once and downstream layers reference hashes."
  - "Multi-component responses acquire all component leases before exposing a stream and release them on every terminal path."
requirements-completed: []
coverage:
  - id: D1
    description: NAR PUT streams into canonical bounded shared-store components.
    verification:
      - kind: integration
        ref: tests/integration/writable_cache_test.ts#NAR staging records canonical content-addressed route components
        status: pass
    human_judgment: false
  - id: D2
    description: Hashtrees build from pre-chunked components without rechunking source NARs.
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts#canonical writer reuses pre-chunked shared-store components
        status: pass
    human_judgment: false
  - id: D3
    description: Publication bytes retain durable ownership through writer disposal and recovery.
    verification:
      - kind: integration
        ref: tests/integration/publication_batch_test.ts and tests/integration/publication_recovery_test.ts
        status: pass
    human_judgment: false
duration: 18min
completed: 2026-08-14
status: complete
---

# Quick Task 260813-tzo Plan 03: Chunked Writes and Publication Summary

**Single-pass canonical NAR chunks now feed shared-store Hashtree construction and remain durably owned through publication recovery.**

## Performance

- **Duration:** 18 min
- **Completed:** 2026-08-14
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Streamed NAR PUT bodies into deterministic `FILE_CHUNK_BYTES` components with temporary upload ownership and atomic immutable-route exposure.
- Built canonical Hashtrees directly from component descriptors and admitted generated manifests into the shared BlobStore.
- Transferred ownership through writer, batch, saga, and refresh lifetimes; writable overlay responses stream ordered component leases.

## Task Commits

1. **Task 1:** `85d17c8` (RED), `872ca38` (GREEN)
2. **Task 2:** `a87b065` (RED), `ecbd069` (GREEN)
3. **Task 3:** `0139e18` (RED), `0fb4580` (GREEN)
4. **Correctness fixes:** `d92a83d`, `65b5c84`

## Files Created/Modified

- `src/persistence/blob_store.ts` - Atomic route component ownership.
- `src/persistence/write_repository.ts` - Chunked upload, component batches, and publication owner transfers.
- `src/hashtree/writer.ts` - Component inputs and shared-store manifest admission.
- `src/write/overlay.ts` - Leased multi-component response assembly.
- `src/runtime/daemon.ts` - Shared BlobStore writer wiring without candidate blob storage.
- `tests/integration/writable_cache_test.ts` - Canonical upload component coverage.
- `tests/protocol/hashtree_writer_test.ts` - Pre-chunked writer coverage.
- `tests/integration/publication_batch_test.ts` - Durable owner transfer coverage.

## Decisions Made

- Small bounded narinfo metadata retains legacy route storage compatibility; unbounded NAR bodies use component descriptors.
- Generated manifest blobs and NAR chunks share one catalog and physical store.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Streamed multi-component writable overlay responses**
- **Found during:** Overall verification
- **Issue:** A path-only overlay would expose only the first chunk of a multi-chunk NAR.
- **Fix:** Added ordered BlobStore component leases with close/cancel cleanup.
- **Files modified:** `src/write/overlay.ts`, `src/persistence/write_repository.ts`
- **Verification:** Focused writable tests and full `deno task check` pass.
- **Committed in:** `65b5c84`

**2. [Rule 2 - Missing Critical] Removed the obsolete candidate blob directory**
- **Found during:** Overall storage-path inspection
- **Issue:** Daemon wiring still named a writer work directory `candidate-blobs`.
- **Fix:** Renamed it to bounded `writer-work`; physical blobs live only in BlobStore.
- **Committed in:** `d92a83d`

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical functionality).

## Issues Encountered

The plan's literal focused test commands omit `--allow-env`, while an npm `debug` transitive import reads environment variables at module load. The same focused suites passed with the minimum additional `--allow-env` permission. Scoped format/lint, full type-checking, and all focused test gates passed.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

Plan 04 can remove remaining legacy schemas/configuration paths against the unified store baseline. No implementation blocker remains.

## Self-Check: PASSED

All modified implementation/test files and task commits were verified on disk.

---
*Phase: 260813-tzo Plan 03*
*Completed: 2026-08-14*
