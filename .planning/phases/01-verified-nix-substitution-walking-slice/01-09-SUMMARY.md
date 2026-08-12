---
phase: 01-verified-nix-substitution-walking-slice
plan: 09
subsystem: hashtree-resource-bounds
tags: [hashtree, streaming, budgets, narinfo, backpressure]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 03
    provides: verified Blossom spooling and bounded Hashtree traversal
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 04
    provides: snapshot-bound Nix HTTP GET/HEAD serving
provides:
  - Authenticated-order iterative traversal for nested file manifests
  - Per-blob and aggregate transfer/output request ledgers
  - decodedMetadataBytes-bounded narinfo decoding with cancellation
affects: [nix-http-serving, blossom-resolution, resource-safety]
tech-stack:
  added: []
  patterns: [ordered-explicit-frames, progressive-byte-ledger, bounded-stream-decoder]
key-files:
  created: []
  modified:
    - src/config/config.ts
    - src/blossom/blob_fetcher.ts
    - src/hashtree/reader.ts
    - src/nix/http_handler.ts
    - tests/integration/hostile_blossom_test.ts
    - tests/integration/http_cache_test.ts
    - tests/e2e/nix_substitution_test.ts
key-decisions:
  - "Treat authenticated blob sizes only as equality requirements that may narrow operator transfer ceilings."
  - "Debit every received chunk at the BlobFetcher boundary and every delivered chunk before response enqueue."
  - "Materialize only bounded narinfo metadata; keep NAR bodies on the direct stream path."
requirements-completed: [TREE-04, TREE-05]
duration: 7 min
completed: 2026-08-12
---

# Phase 1 Plan 9: Ordered Traversal and Resource Bounds Summary

Ordered iterative file traversal, progressive transfer/output ledgers, and a cancelling bounded narinfo decoder close authenticated-size amplification paths without buffering NAR responses.

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-12T12:29:19Z
- **Completed:** 2026-08-12T12:35:37Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Replaced reversed stack/unshift collection with explicit traversal frames that preserve parent/child authenticated chunk order without recursive call-stack growth.
- Added compiled configuration ceilings and one request ledger for per-blob transfer, aggregate received bytes, and aggregate bytes delivered to callers.
- Counted manifest and raw transfer attempts through BlobFetcher progress callbacks while retaining owner-only spools and deterministic cancellation disposal.
- Rejected oversized narinfo descriptors and cancelled streams that cross `decodedMetadataBytes`, then performed fatal UTF-8 decoding within the bounded allocation.
- Preserved every syntactically valid `Sig` line byte-for-byte and left NAR responses direct, snapshot-bound, backpressured streams.

## Task Commits

1. **Task 1 RED:** `fbdcba6` — failing ordered traversal and request-budget regressions
2. **Task 1 GREEN:** `d2ce5ed` — ordered Hashtree streaming under transfer/output ledgers
3. **Task 2 RED:** `f35e8a5` — failing bounded narinfo decoding regressions
4. **Task 2 GREEN:** `2edf6cf` — decodedMetadataBytes-bounded narinfo handling

## Decisions Made

- Publisher-declared sizes are equality constraints and may only narrow the minimum of compiled per-blob and remaining aggregate policy.
- Manifest nodes are cached and visited once, while every actual network attempt and received byte remains charged to the request.
- File output size is validated as a safe integer and against remaining output capacity before raw chunks begin fetching.
- Narinfo uses a dedicated bounded byte reader; NAR delivery never enters that materialization path.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno task fmt` — passed (26 files)
- `deno task lint` — passed (22 files)
- `deno task check` — passed
- focused ordered/transfer/output hostile Blossom tests — 3 passed
- complete hostile Blossom integration suite — 14 passed
- focused metadata-bound GET/HEAD tests — 3 passed
- complete HTTP cache integration suite — 7 passed

## Threat Review

- T-01-09-01: ordered explicit frames and nested A/B/C/D regression preserve authenticated file order.
- T-01-09-02: operator ceilings bound each blob, aggregate received bytes, and delivered output; publisher sizes cannot raise policy.
- T-01-09-03: descriptor precheck and cancelling bounded reader protect the narinfo parser boundary.
- T-01-09-04: existing owner-only spool permissions and cancellation disposal remain intact.
- No new unplanned endpoint, authorization, filesystem, schema, or dependency trust boundary was introduced.

## Self-Check: PASSED

- All seven modified files exist.
- All four task commits exist in repository history.
- Both task acceptance gates and the complete plan verification matrix pass.
