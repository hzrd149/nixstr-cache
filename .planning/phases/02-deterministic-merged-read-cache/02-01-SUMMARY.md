---
phase: 02-deterministic-merged-read-cache
plan: 01
subsystem: nostr-selection
tags: [deno, typescript, applesauce, rxjs, nostr, nix-cache]
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    provides: verified publication admission, durable anti-rollback state, and scalar reactive selection
provides:
  - Bounded canonical ordered default and named cache identity configuration
  - Frozen reactive multi-identity publication snapshots in operator priority order
  - Independent per-layer freshness, expiry, restoration, and rollback protection
  - Production relay subscriptions for kinds 17091 and 37091
affects: [02-02-merged-narinfo, 02-03-local-blossom-cache, phase-3-write-path]
tech-stack:
  added: []
  patterns: [configuration-order priority, per-identity durable admission, nearest-expiry refresh]
key-files:
  created: []
  modified:
    - src/config/config.ts
    - main.ts
    - src/nostr/selection.ts
    - src/runtime/daemon.ts
    - tests/integration/operator_config_test.ts
    - tests/integration/publication_selection_test.ts
    - tests/integration/blossom_discovery_test.ts
key-decisions:
  - "Keep NIXSTR_PUBLISHER_PUBKEYS as a default-cache compatibility input while NIXSTR_CACHE_IDENTITIES becomes the explicit ordered default/named priority source."
  - "Schedule only the nearest selected publication expiry and recompute the whole immutable snapshot when it fires."
patterns-established:
  - "Identity parsing: one shared canonical parser enforces exact kind, lowercase pubkey, and raw bounded identifier rules."
  - "Merged selection: independently choose each identity, then map winners solely through frozen configuration order."
requirements-completed: [PROT-01]
coverage:
  - id: D1
    description: Ordered exact default and named identities validate and reach selection without priority loss.
    requirement: PROT-01
    verification:
      - kind: integration
        ref: "tests/integration/operator_config_test.ts#operator config preserves canonical ordered default and named identities"
        status: pass
      - kind: integration
        ref: "tests/integration/publication_selection_test.ts#ordered default and named publications form a frozen production snapshot"
        status: pass
    human_judgment: false
  - id: D2
    description: Each configured layer updates, expires, restores, and rejects rollback independently.
    requirement: PROT-01
    verification:
      - kind: integration
        ref: "tests/integration/publication_selection_test.ts#two identities update expire and restore independently without snapshot mutation"
        status: pass
    human_judgment: false
  - id: D3
    description: The Phase 1 stock-Nix substitution path remains operational through production main.ts.
    requirement: PROT-01
    verification:
      - kind: e2e
        ref: "deno task test:nix-e2e"
        status: pass
    human_judgment: false
duration: 6 min
completed: 2026-08-12
status: complete
---

# Phase 02 Plan 01: Ordered Multi-Identity Selection Summary

**Bounded canonical cache identities now drive a frozen Applesauce snapshot whose independently fresh layers always retain operator-configured priority.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-12T13:39:55Z
- **Completed:** 2026-08-12T13:45:13Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `NIXSTR_CACHE_IDENTITIES` and a shared strict parser for bounded, duplicate-free default and named cache identities, deriving relay authors without losing priority order.
- Generalized scalar selection into frozen ordered snapshots with independent NIP-01 selection, durable admission, expiry, restoration, and rollback enforcement per identity.
- Added both publication kinds to production relay filters while retaining the read-only HTTP surface and verified Phase 1 stock-Nix path.

## Task Commits

1. **Task 1 RED: ordered configuration and snapshot coverage** - `c2d3217` (test)
2. **Task 1 GREEN: ordered multi-cache production selection** - `6cb4b7e` (feat)
3. **Task 2 RED: independent layer lifecycle coverage** - `5fefa69` (test)
4. **Task 2 GREEN: nearest-expiry independent lifecycle** - `c64aa48` (feat)
5. **Post-merge fix: merged BUD-03 production assertion** - `373c8c3` (test)

## Files Created/Modified

- `src/config/config.ts` - Canonical identity type/parser, explicit bounded ordered configuration, and author derivation.
- `main.ts` - Production environment mapping for `NIXSTR_CACHE_IDENTITIES`.
- `src/nostr/selection.ts` - Frozen ordered merged snapshots and nearest-expiry reactive refresh.
- `src/runtime/daemon.ts` - Both-kind relay subscription and temporary highest-priority adapter for the Phase 1 HTTP handler.
- `tests/integration/operator_config_test.ts` - Canonical, duplicate, malformed, cardinality, and environment configuration evidence.
- `tests/integration/publication_selection_test.ts` - Ordering, immutability, independent freshness, expiry, restoration, and rollback evidence.
- `tests/integration/blossom_discovery_test.ts` - Existing BUD-03 assertions adapted to the merged snapshot API.

## Decisions Made

- Retained `NIXSTR_PUBLISHER_PUBKEYS` as a backwards-compatible shorthand for ordered default identities; explicit mixed default/named priority uses `NIXSTR_CACHE_IDENTITIES`.
- Kept the existing HTTP handler on the first selected layer until Plan 02-02 adds merged narinfo resolution; the production selection object itself exposes the complete ordered snapshot.
- Scheduled one timer for the nearest layer expiry rather than one timer per active layer, bounding timer work while refreshing all independently selected identities.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted BUD-03 regression coverage to the merged snapshot API**
- **Found during:** Task 1
- **Issue:** Full typechecking correctly found scalar `current().bud03Servers` assertions after `current()` became an ordered snapshot.
- **Fix:** Updated the existing integration test to address the first configured layer while preserving captured-snapshot immutability assertions.
- **Files modified:** `tests/integration/blossom_discovery_test.ts`
- **Verification:** `deno task check` and the full focused integration suite pass.
- **Committed in:** `6cb4b7e`

**2. [Rule 3 - Blocking] Used the dependency-required environment permission for the focused selection test**
- **Found during:** Task 2 verification
- **Issue:** The exact narrow command fails during npm `debug` module initialization because the pinned dependency reads `process.env` before tests run.
- **Fix:** Ran the combined plan-focused command with `--allow-env`, matching the existing Task 1 permission envelope; no application environment values are consumed by the selection tests.
- **Files modified:** None
- **Verification:** 22 focused tests passed, plus lint, check, and stock-Nix E2E.
- **Committed in:** N/A (verification-only adjustment)

**3. [Rule 1 - Bug] Corrected the production BUD-03 regression's scalar snapshot assumption**
- **Found during:** Post-merge cumulative integration gate
- **Issue:** The test cast the new ordered `current()` result as one publication, so its source-plan probe read array properties as `undefined` and observed only the configured source.
- **Fix:** Selected `current()[0]` explicitly and retained assertions that the highest-priority layer carries immutable event and reactive BUD-03 sources into production resolution.
- **Files modified:** `tests/integration/blossom_discovery_test.ts`
- **Verification:** `deno task test:integration` passes all 55 tests and `deno task test:nix-e2e` passes.
- **Committed in:** `373c8c3`

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking issues). **Impact:** No feature scope increase; the adjustments preserve existing coverage and accommodate the pinned dependency graph.

## Issues Encountered

The pinned npm dependency graph requires environment permission during module initialization. The plan-level focused command with `--allow-env` passed all 22 tests. A post-merge cumulative test exposed a stale scalar type assertion in BUD-03 coverage; production code already selected the highest-priority layer correctly, and the corrected regression now proves its event and BUD-03 source propagation.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno task fmt` - passed, 30 files checked.
- `deno task lint` - passed, 26 files checked.
- `deno task check` - passed across production, protocol, integration, and E2E modules.
- `deno task test:integration` - 55 passed.
- `deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts tests/integration/publication_selection_test.ts` - 22 passed.
- `deno task test:nix-e2e` - 1 passed with stock Nix through production `main.ts`.

## Threat Review

- T-02-01-01: canonical exact parsing, duplicate rejection, deduplicated author derivation, both-kind filtering, and pre-persistence identity authorization are enforced.
- T-02-01-02: selection maps winners only through immutable configuration order; arrival order and cross-identity timestamps cannot alter priority.
- T-02-01-03: the compiled maximum of 32 identities rejects excessive configuration before startup side effects.
- T-02-01-04: repository watermarks remain per identity and expiry removes only the unavailable layer without restoring stale events.
- T-02-01-SC: no dependency or lockfile changes occurred.
- No security-relevant surface outside the plan threat model was introduced.

## Next Phase Readiness

- Plan 02-02 can consume the ordered snapshot to resolve and merge duplicate narinfo records while pinning NAR bytes to the winning layer.
- No blockers remain.

## Self-Check: PASSED

- All seven modified implementation/test files exist.
- All four task commits and the post-merge regression fix are present in git history.
- All task acceptance criteria and plan-level verification commands passed under the documented dependency permission envelope.
