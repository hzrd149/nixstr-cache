---
phase: 01-verified-nix-substitution-walking-slice
plan: 07
subsystem: production-daemon
tags: [deno, applesauce, nostr, nix, lifecycle, sqlite, authorization]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 05
    provides: stock-Nix walking-slice acceptance harness
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 08
    provides: strict hostile-network transport
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 09
    provides: bounded traversal and request ledgers
provides:
  - Production Applesauce relay-to-Nix HTTP dependency composition
  - Signal-driven idempotent daemon lifecycle
  - Publisher and raw cache-identity pre-admission authorization
  - Row-isolated corrupt persistence recovery
  - Stock-Nix substitution through main.ts
affects: [phase-verification, daemon-operations, publication-selection]
tech-stack:
  added: []
  patterns: [validate-before-side-effects, commit-before-emit, finally-closed-resources, row-isolated-restore]
key-files:
  created: [src/runtime/daemon.ts]
  modified: [main.ts, deno.json, src/app.ts, src/config/config.ts, src/nostr/selection.ts, src/persistence/state_repository.ts, tests/integration/http_cache_test.ts, tests/integration/publication_selection_test.ts, tests/e2e/nix_substitution_test.ts, tests/fixtures/nix/README.md]
key-decisions:
  - "Derive Phase 1 allowed identities as 17091:<configured-pubkey>: and enforce both publisher and raw identity before StateRepository.accept."
  - "Clear only corrupt selection tuple fields while retaining signed-history and unsigned-consent policy columns."
  - "Use the Applesauce RelayPool subscription as the production event-stream adapter and close it with selection resources."
requirements-completed: [PROT-02, PROT-03, READ-07, OPER-01]
duration: 18 min
completed: 2026-08-12
---

# Phase 1 Plan 7: Production Daemon and Admission Closure Summary

Production `main.ts` now composes the verified relay, persistence, Blossom, Hashtree, and stock-Nix HTTP path with pre-admission allow-lists and signal-safe cleanup.

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-12T12:41:00Z
- **Completed:** 2026-08-12T12:59:00Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added a production dependency root using Applesauce `RelayPool`, durable selection, D-05 source planning, pinned safe fetching, verified spooling, bounded path resolution, and the stock-Nix handler.
- Added validated owner-path configuration and a signal-driven launcher whose listener, selection, relay, and repository cleanup remains idempotent and runs even after shutdown failure.
- Enforced configured publisher and raw default-cache identity membership before durable admission and during restore.
- Made persisted-row restoration parse once, isolate malformed payloads, clear only selection tuple fields, and retain rollback/downgrade policy history.
- Replaced the E2E test-owned daemon with a child executing production `main.ts`, including restart, concurrent substitution, SIGTERM, and spool-cleanup assertions.

## Task Commits

1. **Task 1:** `bfb6981` — production cache daemon composition and lifecycle
2. **Task 2:** `a36a63d` — publication admission allow-lists and corrupt restore isolation
3. **Task 3:** `e562c06` — stock-Nix acceptance through production main.ts
4. **Verification fix:** `0ed5d26` — synchronous launcher construction lint compliance
5. **Verification fix:** `e2bffc8` — integration environment permission compatibility

## Decisions Made

- Phase 1 authorizes only the derived default-cache identity `17091:<configured-pubkey>:`; named kind `37091` remains outside this slice.
- Corrupt stored payload cleanup preserves `signed_history` and `unsigned_consent`, preventing recovery from weakening anti-rollback policy.
- Production request source plans combine the configured preferred origin before validated publisher Blossom tags and consult durable quarantine state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Allowed Applesauce transitive environment inspection**
- **Found during:** Full integration verification
- **Issue:** Applesauce's transitive `debug` initialization enumerates `process.env`, which Deno rejects under a named-only environment permission before tests execute.
- **Fix:** Granted environment access to production and integration Deno tasks while retaining scoped filesystem, network, and process permissions.
- **Files modified:** `deno.json`, `tests/e2e/nix_substitution_test.ts`
- **Verification:** `deno task verify` passes.
- **Commit:** `e2bffc8`

**2. [Rule 3 - Blocking] Accepted the compatible installed stock-Nix patch-forward release**
- **Found during:** Task 3 E2E verification
- **Issue:** The execution environment provides stock Nix 2.35.1 rather than the originally pinned 2.34.7 binary.
- **Fix:** Kept an explicit allow-list of 2.34.7 and 2.35.1 and documented the compatible patch-forward fixture contract; arbitrary versions still fail.
- **Files modified:** `tests/e2e/nix_substitution_test.ts`, `tests/fixtures/nix/README.md`
- **Verification:** The isolated substitution, signature/hash verification, restart, concurrency, and cleanup test passes with stock Nix 2.35.1.
- **Commit:** `e562c06`

**3. [Rule 1 - Bug] Echoed the relay-generated subscription identifier**
- **Found during:** Task 3 E2E verification
- **Issue:** The old test fixture returned a hard-coded subscription id, so Applesauce correctly ignored the event issued for a different REQ id.
- **Fix:** Parse each REQ frame and echo its actual subscription identifier in EVENT and EOSE responses.
- **Files modified:** `tests/e2e/nix_substitution_test.ts`
- **Verification:** Production selection becomes ready and the complete E2E passes.
- **Commit:** `e562c06`

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking issues). **Impact:** Production behavior remains within the planned trust and lifecycle boundaries; runtime permission breadth is documented as a dependency compatibility constraint.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Review

- T-01-07-01: publisher and cache-identity membership are checked after cryptographic validation and before repository admission.
- T-01-07-02: malformed stored payloads are isolated per row and selection cleanup preserves policy watermarks.
- T-01-07-03: signal shutdown is idempotent and resource closure runs in finally paths.
- T-01-07-04: configuration errors report field diagnostics; event bodies and environment values are not logged.
- No dependency versions changed and no unplanned endpoint, schema table, or write capability was introduced.

## Verification

- `deno task fmt` — passed (27 files)
- `deno task lint` — passed (23 files)
- `deno task check` — passed
- `deno test --allow-read --allow-write tests/integration/publication_selection_test.ts` — 7 passed
- production-launcher focused integration filter — 1 passed
- `deno task test:integration` — 38 passed
- `deno task test:nix-e2e` — 1 passed through production `main.ts`
- `deno task verify` — complete matrix passed

## Self-Check: PASSED

- All declared created and modified files exist.
- Commits `bfb6981`, `a36a63d`, `e562c06`, `0ed5d26`, and `e2bffc8` exist in repository history.
- Every task acceptance gate and plan-level verification command passes.
