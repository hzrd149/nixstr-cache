---
phase: 04-availability-gated-publication-loop
plan: 03
subsystem: operations
tags: [diagnostics, health, redaction, publication]
requires:
  - phase: 04-02
    provides: durable publication saga and repair state
provides:
  - closed secret-safe operational diagnostic taxonomy
  - pure three-axis process/read/write health snapshot
  - GET and HEAD /health HTTP surface
affects: [04-04, operations, publication]
tech-stack:
  added: []
  patterns: [closed-union allow-list serialization, callback-only snapshot provider]
key-files:
  created:
    - src/operations/diagnostics.ts
    - src/operations/health.ts
    - tests/integration/health_diagnostics_test.ts
  modified:
    - src/nix/http_handler.ts
    - src/runtime/daemon.ts
    - src/write/publication_coordinator.ts
key-decisions:
  - "Health providers receive only synchronous state readers and expose no network, signer, timer, or mutation capability."
  - "Operational JSON is constructed field-by-field from a closed union; unknown properties and recursive errors are never traversed."
metrics:
  duration: 8min
  completed: 2026-08-12
status: complete
---

# Phase 4 Plan 3: Operational Diagnostics and Health Summary

Closed-union JSON diagnostics with credential-free endpoints and a side-effect-free `/health` snapshot that independently reports process, read, and publication write availability.

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-12T15:44:00Z
- **Completed:** 2026-08-12T15:52:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added one failure-contained JSON diagnostic sink for event rejection, merge conflict, upstream failure, signer, batch, replica, relay, and promotion events.
- Removed credentials, query strings, fragments, arbitrary properties, errors, headers, and bodies by copying only explicitly allowed fields.
- Added deterministic process/read/write health axes with stable machine-readable reason codes.
- Routed GET and HEAD `/health` before selection capture and stock Nix routing, preserving HEAD content length and existing unsupported-method behavior.
- Proved repeated health requests do not invoke selection, resolution, write readiness, network, signer, retry, or mutation paths.

## Task Commits

1. **Task 1: Trace a blocked publication into secret-safe diagnostics and health** - `250c630` (RED), `42d3d09` (GREEN)
2. **Task 2: Cover the complete health matrix and diagnostic taxonomy** - `6462f57`

## Files Created/Modified

- `src/operations/diagnostics.ts` - Closed diagnostic union, credential-free endpoint normalization, allow-list serializer, and failure-contained sink.
- `src/operations/health.ts` - Pure three-axis snapshot and stable reason enums.
- `src/nix/http_handler.ts` - Machine-readable GET/HEAD health route ahead of cache state capture.
- `src/runtime/daemon.ts` - Production diagnostic adapters and authoritative health-state composition.
- `src/write/publication_coordinator.ts` - Replica, relay, batch, and promotion diagnostic callbacks.
- `tests/integration/health_diagnostics_test.ts` - Blocked tracer, health matrix, hostile redaction corpus, sink failure, and purity tripwires.

## Decisions Made

- Health is a synchronous projection of already-current repository, selection, overlay, signer, configuration, and coordinator state; it never probes dependencies.
- A disabled signer is a write-axis state, while a publication awaiting a complete replica or relay acknowledgement blocks only writes.
- Diagnostic output is non-authoritative and sink exceptions are swallowed so logging cannot weaken publication barriers or read availability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added coordinator event hooks**
- **Found during:** Task 1
- **Issue:** Production composition could not observe replica attempts, relay acknowledgements, or promotion because the coordinator exposed no safe callback.
- **Fix:** Added an optional typed diagnostic sink to the coordinator and emitted allow-listed outcome events after authoritative repository transitions.
- **Files modified:** `src/write/publication_coordinator.ts`
- **Verification:** Publication recovery tests and health/diagnostic suite pass.
- **Commit:** `42d3d09`

**Total deviations:** 1 auto-fixed (1 missing critical functionality).
**Impact:** Required operational categories are observable without changing saga authority or failure barriers.

## Issues Encountered

None.

## Verification

- `deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/health_diagnostics_test.ts` — 5 passed.
- Relevant merged-cache and publication-recovery integration tests — 8 passed in combined run.
- `deno task check` — passed.
- `deno fmt --check` — passed.
- `deno lint` — passed.

## Known Stubs

None.

## Threat Flags

None. The new HTTP health surface and diagnostic serialization are covered by the plan threat model.

## Next Phase Readiness

Operational diagnostics and health are ready for the Phase 4 end-to-end publication proof.

## Self-Check: PASSED

- All six key files exist.
- Task commits `250c630`, `42d3d09`, and `6462f57` exist.
- All plan verification commands pass.
