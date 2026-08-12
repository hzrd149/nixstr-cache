---
phase: 02-deterministic-merged-read-cache
plan: 02
subsystem: nix-http-serving
tags: [narinfo, deterministic-merge, diagnostics, route-pinning, deno]
requires:
  - phase: 02-deterministic-merged-read-cache
    plan: 01
    provides: ordered immutable multi-identity selection snapshots
provides:
  - Complete semantic Narinfo agreement with normative all-occurrence signature concatenation
  - Redacted typed conflict diagnostics with deterministic priority winners
  - Count-and-TTL-bounded winner-pinned NAR routing
affects: [02-03, nix-http-serving, stock-nix-e2e]
tech-stack:
  added: []
  patterns: [lossless-winner-serialization, shared-request-budget, immutable-route-pin]
key-files:
  created: [src/nix/merged_cache.ts, tests/integration/merged_cache_test.ts]
  modified: [src/protocol/narinfo.ts, src/nix/http_handler.ts, src/runtime/daemon.ts, tests/protocol/narinfo_test.ts, tests/integration/http_cache_test.ts]
key-decisions:
  - "Compare parsed values for every supported non-Sig field, including optional-field presence, while retaining the winner's original layout."
  - "Append every valid Sig occurrence without filtering or deduplication only when all discovered records agree."
  - "Pin normalized NAR paths to immutable winner publications in a finite insertion-ordered TTL registry."
patterns-established:
  - "Merged metadata probes share one request-captured selection, RequestBudget, and abort signal."
  - "Conflict observability uses an allow-listed discriminated diagnostic rather than untrusted record contents."
requirements-completed: [READ-05, READ-06]
coverage:
  - id: D1
    description: Compatible Narinfo records retain winner scalar layout and concatenate every signature occurrence in priority order.
    requirement: READ-05
    verification:
      - kind: integration
        ref: tests/integration/merged_cache_test.ts#agreement preserves duplicate signature occurrence order and exact HEAD length
        status: pass
      - kind: unit
        ref: tests/protocol/narinfo_test.ts#every supported non-signature field participates in agreement
        status: pass
    human_judgment: false
  - id: D2
    description: Semantic conflicts serve the unchanged priority winner with one redacted typed diagnostic per loser.
    requirement: READ-06
    verification:
      - kind: integration
        ref: tests/integration/merged_cache_test.ts#conflict returns byte-identical winner and emits one redacted diagnostic per loser
        status: pass
    human_judgment: false
  - id: D3
    description: Subsequent NAR requests remain pinned to the exact Narinfo winner across reactive selection changes.
    requirement: READ-06
    verification:
      - kind: integration
        ref: tests/integration/merged_cache_test.ts#winner route remains pinned across selection update and registry evicts deterministically
        status: pass
      - kind: e2e
        ref: deno task test:nix-e2e
        status: pass
    human_judgment: false
duration: 12 min
completed: 2026-08-12
status: complete
---

# Phase 2 Plan 2: Narinfo Merge and Winner Routing Summary

**Full-semantic Narinfo agreement preserves every signature occurrence while typed conflicts and bounded route pins keep metadata and NAR bytes on one deterministic publisher provenance.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-12T13:41:00Z
- **Completed:** 2026-08-12T13:53:24Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added lossless semantic projection for all required Narinfo fields plus optional `Deriver`, `System`, and `CA`, including presence versus absence and parsed numeric equivalence.
- Probed every available ordered layer with one captured snapshot and shared request budget, preserving the winner layout and concatenating all raw `Sig` occurrences only on complete agreement.
- Added nonfatal, redacted conflict diagnostics and a deterministic count/TTL-bounded registry that pins later NAR GET/HEAD requests to the exact winning publication.
- Preserved stock-Nix status mappings, streamed NAR delivery, disabled PUT behavior, and exact merged HEAD content length.

## Task Commits

1. **Task 1 RED:** `61d11a1` — failing complete-semantics, signature, conflict, and provenance regressions
2. **Task 1 GREEN:** `46b5ce4` — compatible Narinfo merge and merged HTTP GET/HEAD
3. **Task 2:** `1573696` — production bounded route registry and typed diagnostic sink
4. **Task 2 coverage:** `8642eaa` — every supported semantic conflict field regression

## Files Created/Modified

- `src/protocol/narinfo.ts` — complete parsed semantic projection, field differences, and raw signature append.
- `src/nix/merged_cache.ts` — ordered merged resolver, typed diagnostics, and bounded winner route registry.
- `src/nix/http_handler.ts` — merged Narinfo GET/HEAD and winner-pinned NAR serving.
- `src/runtime/daemon.ts` — production ordered selection, registry bounds, and safe diagnostic sink.
- `tests/protocol/narinfo_test.ts` — semantic and all-occurrence preservation matrix.
- `tests/integration/merged_cache_test.ts` — agreement, conflict, shared-budget, HEAD, eviction, and provenance tests.
- `tests/integration/http_cache_test.ts` — existing HTTP behavior adapted to merged selection snapshots.

## Decisions Made

- A disagreement from any discovered lower-priority record suppresses all signature merging and returns the complete winner unchanged.
- Numeric fields compare by validated numeric meaning; scalar line order and spelling do not affect compatibility.
- Missing direct NAR pins use bounded ordered lookup, while live pins are never replaced from a newer selection.
- Production route pins are capped at 4,096 entries with a five-minute TTL and oldest-entry deterministic eviction.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The existing HTTP integration suite imports npm packages that inspect the environment at module load, so its established execution requires `--allow-env`; it passed with that permission alongside its existing read/write permissions.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Review

- T-02-02-01: every supported non-signature field is compared before raw signature occurrences are appended.
- T-02-02-02: immutable route pins retain exact publication provenance across selection updates.
- T-02-02-03: diagnostics contain only stable codes, store-path hash, identity/event references, and differing field names.
- T-02-02-04: probes share one request budget and the route registry requires finite count/TTL bounds.
- T-02-02-SC: no dependency or lockfile changes were introduced.

## Verification

- `deno task fmt` — passed
- `deno task lint` — passed
- `deno task check` — passed
- `deno test tests/protocol/narinfo_test.ts` — 7 passed
- `deno test --allow-read --allow-write tests/integration/merged_cache_test.ts` — 3 passed
- `deno test --allow-env --allow-read --allow-write tests/integration/http_cache_test.ts` — 8 passed
- `deno task test:nix-e2e` — 1 passed against production `main.ts`

## Next Phase Readiness

Plan 02-03 can place verified local Blossom read-through below the winner-pinned resolution boundary without changing merge or provenance semantics.

## Self-Check: PASSED

- All seven created or modified implementation/test files exist.
- Commits `61d11a1`, `46b5ce4`, `1573696`, and `8642eaa` exist in repository history.
- All focused, integration, type/lint/format, and stock-Nix E2E gates pass.

---
*Phase: 02-deterministic-merged-read-cache*
*Completed: 2026-08-12*
