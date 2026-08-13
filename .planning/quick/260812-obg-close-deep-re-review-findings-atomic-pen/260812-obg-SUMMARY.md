---
phase: quick-deep-rereview-closure
plan: 01
subsystem: publication-lifecycle
tags: [deno, sqlite, streaming, quota, leases, crash-recovery]
requires:
  - phase: 04-availability-gated-publication-loop
    provides: writable overlay and availability-gated publication baseline
provides:
  - atomic pending candidate and blob ownership admission
  - restart-safe abandoned writer-run reclamation
  - distinct-live-byte quota including current overlay content
  - response-lifetime exact-generation signer leases
  - deterministic writer shutdown
affects: [publication, writable-cache, hashtree, http-cache]
tech-stack:
  added: []
  patterns: [single-database ownership transaction, lease-bearing route registry, ledger-proven sweep]
key-files:
  created: []
  modified: [src/persistence/write_repository.ts, src/hashtree/writer.ts, src/write/batch_scheduler.ts, src/nix/http_handler.ts]
key-decisions:
  - "Candidate ownership uses WriteRepository's SQLite transaction rather than a second WAL database."
  - "Signer narinfo pins transfer an exact-generation lease into the bounded route registry."
  - "Aggregate staging quota charges distinct physical digests including current overlay routes."
patterns-established:
  - "Filesystem deletion follows a committed zero-owner ledger query and retains failed rows for retry."
  - "Scheduler shutdown drains serial work and closes the writer before repository teardown."
requirements-completed: [READ-03, WRIT-04, WRIT-06, PUBL-02, PUBL-03, PUBL-05, OPER-04]
coverage:
  - id: D1
    description: Pending inventory and durable batch ownership commit atomically and abandoned runs reclaim safely.
    requirement: PUBL-02
    verification:
      - kind: integration
        ref: tests/integration/publication_batch_test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Current and shared staged content is quota-charged by distinct physical digest.
    requirement: WRIT-04
    verification:
      - kind: integration
        ref: tests/integration/writable_cache_test.ts#distinct live quota charges current overlay and shared blobs once
        status: pass
    human_judgment: false
  - id: D3
    description: Pinned signer routes retain exact-generation leases through terminal response state.
    requirement: READ-03
    verification:
      - kind: integration
        ref: tests/integration/merged_cache_test.ts#pinned signer registry releases generation leases exactly once
        status: pass
    human_judgment: false
  - id: D4
    description: Full protocol, integration, and stock-Nix publication/substitution behavior remains green.
    requirement: OPER-04
    verification:
      - kind: e2e
        ref: deno task verify
        status: pass
    human_judgment: false
duration: 35min
completed: 2026-08-12
status: complete
---

# Quick 260812-obg: Deep Re-review Closure Summary

**Atomic repository-backed candidate ownership, bounded physical-byte quota, exact-generation response leases, and deterministic writer teardown close CR-04–06 and WR-04–05.**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-08-12
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Consolidated candidate content/run/batch ownership into the publication repository so pending rows and complete durable ownership become visible in one transaction.
- Added startup and terminal zero-owner sweeps plus idempotent writer close wired through scheduler and daemon shutdown.
- Restored aggregate bounds for current/shared cache bytes and transferred signer pins into exact-generation leases released at terminal response or registry cleanup.
- Passed 21 protocol tests, 99 integration tests, and both stock-Nix E2Es without the prior cleanup `disk I/O error`.

## Task Commits

1. **Task 1: Atomic ownership, abandoned sweep, and writer lifecycle** — `c015e27`
2. **Task 2: Distinct-live quota and pinned generation leases** — `e878a53`
3. **Task 3: Integrated lifecycle verification** — `020ae43`

## Decisions Made

- Consolidation was feasible, so no cross-database two-phase journal or SQLite `ATTACH` was introduced.
- Standalone protocol writers retain their local ledger adapter; production and publication integration tests use the repository-backed ownership port.
- Pinned NAR lookup consumes the registry lease and hands its release to the response stream wrapper; TTL, replacement, eviction, and registry close release unused pins.

## Deviations from Plan

None - the plan's consolidation, quota, lease, lifecycle, verification, and review closure were implemented without scope reduction.

## Known Stubs

None.

## Threat Flags

None beyond the plan threat register; no new network endpoint, authorization path, or external trust boundary was introduced.

## Self-Check: PASSED

- All modified production and test files exist.
- Commits `c015e27`, `e878a53`, and `020ae43` exist.
- Focused 34-test lifecycle suite and `deno task verify` passed.
- CR-04, CR-05, CR-06, WR-04, and WR-05 are closed in the retained deep re-review artifact.
