---
phase: 01-verified-nix-substitution-walking-slice
plan: 03
subsystem: hashtree-resolution
tags: [msgpack, blossom, sha256, streaming, backpressure, resource-budgets]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 01
    provides: address-pinned SafeFetcher and compiled resource ceilings
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 02
    provides: validated publications and durable SQLite quarantine storage
provides:
  - Strict revision-pinned plaintext BUD-16/17 manifest decoder
  - Ordered source planning and hash-verified owner-only spooling
  - Lazy path resolution under one mandatory request budget
affects: [01-04, nix-http-serving, blossom-resolution]
tech-stack:
  added: ["@msgpack/msgpack@3.1.3", "@noble/hashes@2.3.0"]
  patterns: [verify-before-decode, typed-integrity-failures, request-local-budget, verified-file-streaming]
key-files:
  created:
    - src/protocol/hashtree.ts
    - src/blossom/source_plan.ts
    - src/blossom/blob_fetcher.ts
    - src/hashtree/reader.ts
    - tests/protocol/hashtree_test.ts
    - tests/integration/hostile_blossom_test.ts
  modified: [deno.lock]
key-decisions:
  - "Reject any MessagePack encoding that does not round-trip to the canonical pinned representation before schema use."
  - "Quarantine the canonical origin only for a complete SHA-256 mismatch; every other attempt failure remains transient."
  - "Authenticate HEAD through the final manifest link while reserving final blob acquisition for GET."
requirements-completed: [TREE-01, TREE-02, TREE-03, TREE-04, TREE-05]
coverage:
  - id: D1
    description: Strict pinned plaintext Hashtree manifest grammar
    requirement: TREE-04
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Ordered verified spooling with durable cryptographic quarantine
    requirement: TREE-02
    verification:
      - kind: integration
        ref: tests/integration/hostile_blossom_test.ts#source-plan-verified-spool-quarantine
        status: pass
    human_judgment: false
  - id: D3
    description: Lazy bounded traversal with backpressured GET and link-only HEAD
    requirement: TREE-05
    verification:
      - kind: integration
        ref: tests/integration/hostile_blossom_test.ts#traversal-backpressure-HEAD
        status: pass
    human_judgment: false
duration: 8 min
completed: 2026-08-12
---

# Phase 1 Plan 3: Verified Hashtree Resolution Summary

Canonical BUD-16/17 decoding, hash-verified restrictive spools, and a lazy request-budgeted walker turn selected roots into backpressured verified path streams.

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-12T10:50:34Z
- **Completed:** 2026-08-12T10:58:28Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Pinned BUD-16, BUD-17, and BUD-18 proposal revisions and implemented a strict canonical MessagePack grammar for file, directory, and fanout manifests.
- Implemented stable configured/event/BUD-03 source ordering, incremental SHA-256 spooling to owner-only temporary files, deterministic cleanup, and restart-safe quarantine/release behavior.
- Implemented lazy path lookup, authenticated absence, hash-deduplicated manifest reuse, mandatory depth/link/node/byte/attempt/redirect/time/concurrency budgets, HEAD final-blob omission, and verified GET streams.

## Task Commits

1. **Task 1 RED:** `381dff7` — failing pinned Hashtree codec tests
2. **Task 1 GREEN:** `4b11a34` — strict canonical plaintext manifest decoder
3. **Task 2 RED:** `67387cd` — failing hostile Blossom acquisition tests
4. **Task 2 GREEN:** `74809e4` — ordered verified spooling and quarantine
5. **Task 3 RED:** `3000466` — failing bounded traversal tests
6. **Task 3 GREEN:** `7360780` — request-budgeted lazy path resolver
7. **Verification fixes:** `02bf413` — formatter/linter-safe cleanup
8. **Dependency lock:** `dadbfcb` — approved MessagePack and SHA-256 resolutions

## Decisions Made

- Compare decoded MessagePack against its canonical re-encoding before accepting authenticated data, catching trailing bytes, non-shortest integers, and non-canonical field encodings.
- Keep verified blobs as lifecycle-owning filesystem objects; consumers can reopen streams only after the spool is closed and its full hash matches.
- Debit source attempts inside `BlobFetcher`, where fallback actually occurs, while the resolver owns the single request ledger passed through the traversal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Made literal plan filters execute their intended test groups**
- **Found during:** Task 2 verification
- **Issue:** Deno treats the plan's quoted `--filter 'a|b|c'` value as a literal substring, so ordinary descriptive test names produced zero executed tests.
- **Fix:** Gave each group the exact filter marker prefix while retaining descriptive suffixes.
- **Files modified:** `tests/integration/hostile_blossom_test.ts`
- **Verification:** Both exact plan commands execute four source/spool tests and three traversal tests.
- **Commit:** `02bf413`

**2. [Rule 3 - Blocking] Completed lockfile resolution and repository lint compliance**
- **Found during:** Plan-level verification
- **Issue:** The approved dependencies were declared but unresolved in `deno.lock`, and cleanup error propagation directly inside `finally` violated `no-unsafe-finally`.
- **Fix:** Recorded exact integrity entries and moved remove-if-present behavior into a helper that preserves errors without unsafe control flow.
- **Files modified:** `deno.lock`, `src/blossom/blob_fetcher.ts`
- **Verification:** `deno fmt --check`, `deno lint`, and targeted `deno check` pass.
- **Commits:** `02bf413`, `dadbfcb`

**Total deviations:** 2 auto-fixed blocking issues. **Impact:** Verification now exercises the intended cases and dependency resolution is reproducible; no scope expansion.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno fmt --check` — passed
- `deno lint` — passed
- `deno check src/protocol/hashtree.ts src/blossom/source_plan.ts src/blossom/blob_fetcher.ts src/hashtree/reader.ts` — passed
- `deno test tests/protocol/hashtree_test.ts` — 4 passed
- hostile Blossom source/spool/quarantine filter — 4 passed
- hostile Blossom traversal/backpressure/HEAD filter — 3 passed

## Next Phase Readiness

- Plan 01-04 can consume `PathResolver` to implement strict stock-Nix HTTP GET/HEAD semantics over immutable selection snapshots.
- BUD-15 encrypted roots remain intentionally unsupported; verified upstream blob write-back remains Phase 2 scope.

## Self-Check: PASSED

- All seven declared created files exist and the dependency lock is updated.
- All eight plan commits exist in repository history.
- All task acceptance evidence and plan-level verification commands pass.
