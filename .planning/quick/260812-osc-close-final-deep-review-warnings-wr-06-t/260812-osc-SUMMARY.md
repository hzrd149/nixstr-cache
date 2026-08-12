---
phase: quick-final-warning-closure
plan: 01
subsystem: lifecycle
tags: [leases, timers, sqlite, shutdown, crash-recovery]
requires:
  - phase: quick-deep-rereview-closure
    provides: atomic candidate ownership and exact-generation response leases
provides:
  - idle and shutdown signer-pin release
  - linearized writer build/close lifecycle
  - durable retry-safe run-index cleanup
affects: [http-cache, hashtree-writer, publication]
tech-stack:
  added: []
  patterns: [earliest-expiry timer, synchronous operation admission, cleanup tombstone]
key-files:
  created: []
  modified: [src/nix/merged_cache.ts, src/nix/http_handler.ts, src/hashtree/writer.ts, src/persistence/write_repository.ts]
key-decisions:
  - "Route registries are explicit handler-owned disposable resources."
  - "Writer close owns and disposes returned handles after admitted operations settle."
  - "Index cleanup paths remain in writer_run_cleanup until base, WAL, and SHM are absent."
requirements-completed: [READ-03, PUBL-02, OPER-04]
coverage:
  - id: D1
    description: Idle signer pins expire and handler shutdown releases retained leases exactly once.
    requirement: READ-03
    verification:
      - kind: integration
        ref: tests/integration/merged_cache_test.ts#pinned signer registry releases generation leases exactly once
        status: pass
    human_judgment: false
  - id: D2
    description: Writer close drains synchronously admitted direct builds and rejects later work.
    requirement: PUBL-02
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts#close build race drains active operation and rejects after closing
        status: pass
    human_judgment: false
  - id: D3
    description: Failed index deletion retains a durable tombstone and converges on reopen.
    requirement: OPER-04
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts#cleanup tombstone survives deletion failure and clears on retry
        status: pass
    human_judgment: false
  - id: D4
    description: Complete protocol, integration, and stock-Nix matrix remains green.
    requirement: OPER-04
    verification:
      - kind: e2e
        ref: deno task verify
        status: pass
    human_judgment: false
duration: 24min
completed: 2026-08-12
status: complete
---

# Quick 260812-osc: Final Warning Closure Summary

**Timer-driven lease disposal, linear writer close admission, and durable SQLite index-cleanup tombstones close WR-06–08 with a zero-warning review.**

## Performance

- **Duration:** 24 min
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added bounded autonomous signer-pin expiry and explicit HTTP handler/daemon cleanup.
- Made direct writer admission synchronous against close and drained all admitted operations and handles before persistence shutdown.
- Journaled retryable index, WAL, and SHM deletion until verified absence across reopen.
- Passed 23 protocol tests, 100 integration tests, both stock-Nix E2Es, and a fresh deep review with zero findings.

## Task Commits

1. **Task 1: Idle signer pin and handler shutdown** — `676dd2f`
2. **Task 2: Linear writer build/close lifecycle** — `e7ca4ff`, `42fc03f`
3. **Task 3: Durable run-index cleanup tombstones** — `cd6a1f3`

## Decisions Made

- Use one rescheduled earliest-expiry timer rather than one timer per pin.
- Treat taken leases as response-owned; handler close releases only leases still retained by its registry.
- Persist cleanup targets before owner/run deletion and treat only successful deletion or `NotFound` as completion.

## Deviations from Plan

None - WR-06, WR-07, and WR-08 were closed without reducing lifecycle, streaming, durability, or boundedness requirements.

## Known Stubs

None.

## Self-Check: PASSED

- Commits `676dd2f`, `e7ca4ff`, `cd6a1f3`, and `42fc03f` exist.
- `deno task verify` passed completely.
- Deep re-review records zero critical findings and zero warnings.
