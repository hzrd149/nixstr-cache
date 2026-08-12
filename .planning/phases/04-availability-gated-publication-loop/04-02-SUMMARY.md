---
phase: 04-availability-gated-publication-loop
plan: 02
subsystem: publication
tags: [sqlite, retry, nostr, relay-cache, lifecycle]
requires:
  - phase: 04-availability-gated-publication-loop
    plan: 01
    provides: durable availability-gated publication saga
provides:
  - Durable per-endpoint replica and relay repair with deterministic bounded retry
  - Expiration refresh through archived immutable sagas and unchanged availability barriers
  - Optional verified-event local relay read/write-through cache
  - Validated publication policy and production coordinator lifecycle
affects: [04-03, publication-observability, end-to-end-publication]
tech-stack:
  added: []
  patterns: [nearest-due durable work, stable retry jitter, archived refresh saga, verified event forwarding]
key-files:
  created: [src/nostr/local_relay_cache.ts, tests/integration/publication_recovery_test.ts]
  modified: [src/persistence/write_repository.ts, src/write/publication_coordinator.ts, src/config/config.ts, src/runtime/daemon.ts, src/nostr/selection.ts, main.ts, tests/integration/operator_config_test.ts]
key-decisions:
  - "Archive each committed publication saga before cloning its immutable inventory into an expiration-refresh successor."
  - "Treat a local relay as a cache-only sink unless its canonical URL is also present in the configured publication relay set."
  - "Use one repository-driven timer and stable target-derived jitter so restart preserves deterministic retry order."
patterns-established:
  - "Post-promotion endpoint outcomes mutate only durable work rows; they never roll back the committed event."
  - "Production coordinator startup waits for signer readiness and shutdown drains timers and network work before repositories close."
requirements-completed: [PUBL-05, PUBL-06, PUBL-04, OPER-04]
coverage:
  - id: D1
    description: "Failed replica and relay work survives restart and repairs without changing the committed event."
    requirement: PUBL-05
    verification:
      - kind: integration
        ref: "tests/integration/publication_recovery_test.ts#restart repairs replicas and relays without rolling back committed root"
        status: pass
    human_judgment: false
  - id: D2
    description: "Publication policy defaults to 30 days and refresh uses a new durable availability-gated saga."
    requirement: PUBL-06
    verification:
      - kind: integration
        ref: "tests/integration/publication_recovery_test.ts#restart repairs replicas and relays without rolling back committed root"
        status: pass
      - kind: integration
        ref: "tests/integration/operator_config_test.ts#publication policy is canonical bounded and explicitly mapped"
        status: pass
    human_judgment: false
  - id: D3
    description: "The optional local relay forwards only verified admitted or exact locally signed events."
    requirement: PUBL-04
    verification:
      - kind: integration
        ref: "tests/integration/publication_recovery_test.ts#local relay forwards only admitted and exact locally signed events"
        status: pass
    human_judgment: false
  - id: D4
    description: "Production lifecycle restores, starts, and drains durable publication work idempotently."
    requirement: OPER-04
    verification:
      - kind: integration
        ref: "deno task test:integration (80 passed)"
        status: pass
      - kind: other
        ref: "deno task check && deno fmt --check && deno lint"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-08-12
status: complete
---

# Phase 4 Plan 2: Durable Publication Recovery Summary

**Committed cache roots now remain readable while deterministic durable repair runs, expiration creates a fresh availability-gated successor saga, and an optional verified-event local relay cache participates in promotion only when explicitly configured.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-12T15:36:00Z
- **Completed:** 2026-08-12T15:45:30Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added atomic per-replica and per-relay work claims with safe status codes, attempt counts, capped exponential backoff, stable jitter, concurrency limits, nearest-due scheduling, and restart recovery.
- Preserved the exact signed event for relay repair and kept committed selection unchanged throughout endpoint failure and recovery.
- Added bounded publication configuration, a 30-day default lifetime, monotonic expiration refresh via archived sagas, verified local-relay caching, and production start/drain wiring.

## Task Commits

1. **Task 1 RED: Repair restart tracer** - `3ab8f2c` (test)
2. **Task 1 GREEN: Durable endpoint repair** - `b168689` (feat)
3. **Task 2 RED: Policy and local relay contracts** - `69270b7` (test)
4. **Task 2 GREEN: Refresh, cache, and lifecycle wiring** - `51b045b` (feat)

## Files Created/Modified

- `src/persistence/write_repository.ts` - Durable endpoint work, atomic outcomes, archived sagas, and refresh cloning.
- `src/write/publication_coordinator.ts` - Serialized initial publication, repair, refresh, and nearest-due supervision.
- `src/nostr/local_relay_cache.ts` - Credential-free verified-event relay cache boundary.
- `src/nostr/selection.ts` - Post-admission callback for safe observed-event forwarding.
- `src/config/config.ts` - Canonical bounded publication policy validation.
- `main.ts` - Environment mapping for publication policy.
- `src/runtime/daemon.ts` - Signer-ready coordinator startup and ordered lifecycle drain.
- `tests/integration/publication_recovery_test.ts` - Restart, repair, refresh, and local relay evidence.
- `tests/integration/operator_config_test.ts` - Publication configuration evidence.

## Decisions Made

- Archived committed sagas retain their exact signed event while a refresh clones only immutable candidate inventory into a successor.
- Stable URL-derived jitter makes retry timing deterministic across restart without storing random state.
- Local relay acknowledgements are correlated and count only through the configured publication-relay list; cache-only forwarding remains outside the promotion barrier.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None - new environment settings are optional and validated before side effects.

## Verification

- `deno task test:integration` — 80 passed
- `deno task check` — passed
- `deno fmt --check` — passed
- `deno lint` — passed

## Next Phase Readiness

Durable retry and refresh state is available for Phase 04-03 health, structured diagnostics, and operator visibility. No blockers remain.

## Self-Check: PASSED

- All nine implementation/test files exist.
- Commits `3ab8f2c`, `b168689`, `69270b7`, and `51b045b` exist.

---
*Phase: 04-availability-gated-publication-loop*
*Completed: 2026-08-12*
