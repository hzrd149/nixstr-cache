---
quick_id: 260812-mw9
phase: quick-security-audit-closure
plan: 01
status: complete
subsystem: hashtree-security
tags: [deno, sqlite, streaming, hashtree, atomic-promotion, security-audit]
requirements-completed: [WRIT-04, PUBL-02, OPER-04]
commits: [1215839, e3e2889, bb6f64e, 2f82266, eed801a, 73dabe6]
completed: 2026-08-12
duration: 12min
coverage:
  - id: D1
    description: Frozen batch routes, directory runs, and inventory remain durable with maxLinks-bounded memory.
    requirement: PUBL-02
    verification:
      - kind: integration
        ref: tests/integration/publication_batch_test.ts#streams frozen batch rows directly into the writer
        status: pass
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts#durable directory runs keep link working set independent of route count
        status: pass
    human_judgment: false
  - id: D2
    description: Literal canonical chunk boundaries and immutable create-new staging promotion detect drift and overwrite failures.
    requirement: WRIT-04
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts#pinned canonical boundary hashes detect chunk grouping drift
        status: pass
      - kind: integration
        ref: tests/integration/writable_cache_test.ts#atomic promotion is create-new complete and retry-idempotent
        status: pass
    human_judgment: false
  - id: D3
    description: Phase 2 and 3 security reports classify closed, superseded, transferred, and accepted findings with evidence.
    requirement: OPER-04
    verification:
      - kind: other
        ref: rg security disposition audit plus deno task verify
        status: pass
    human_judgment: false
---

# Quick 260812-mw9: Security Audit Closure Summary

**Disk-backed canonical Hashtree construction with constant link working sets, literal boundary vectors, atomic staging evidence, and evidence-linked Phase 2/3 security dispositions.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-12T16:31:28Z
- **Completed:** 2026-08-12T16:43:40Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Removed the scheduler's frozen-entry array and passed an ordered cancellable SQLite iterator directly into candidate construction.
- Replaced the complete in-memory route trie and inventory collection with durable SQLite node/link/inventory state; only one `maxLinks` group is retained during folding.
- Proved a three-link measured working set stays constant across 150 routes while canonical roots remain byte-identical.
- Pinned literal roots and nhashes below, at, and above the 2,097,152-byte chunk boundary and retained repeat-build/COW reuse.
- Proved synced same-filesystem hard-link promotion is complete, create-new, conflict-safe, and retry-idempotent.
- Added Phase 2 and Phase 3 SECURITY.md reports with explicit closed, superseded, transferred, and accepted dispositions.

## Task Commits

1. **Task 1:** `1215839`, `2f82266`, `eed801a`
2. **Task 2:** `e3e2889`
3. **Task 3:** `bb6f64e`, `73dabe6`

## Decisions Made

- Use a per-build SQLite index beside immutable candidate blobs for route nodes, bounded intermediate runs, and hash-ordered inventory.
- Preserve the canonical grouping algorithm by folding durable levels in `maxLinks` pages rather than changing manifest shape.
- Expose inventory as a repeatable ordered iterator with a constant-time count, allowing pending/publication persistence to stream rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended durable iteration through the entire construction boundary**

- **Found during:** Task 1 security-criterion review
- **Issue:** Removing only the scheduler copy still left a complete route trie and inventory array in the writer.
- **Fix:** Added disk-backed nodes, intermediate runs, and inventory; changed frozen batch and publication inventory APIs to ordered iterators.
- **Files modified:** `src/hashtree/writer.ts`, `src/persistence/write_repository.ts`, `src/write/batch_scheduler.ts`, related tests.
- **Verification:** Constant three-link working set across 150 routes; full verification passed.
- **Commits:** `2f82266`, `eed801a`

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** Necessary architectural extension to meet the plan's non-negotiable no-whole-dataset guarantee.

## Verification

- Focused bounded iteration and frozen-batch streaming tests passed.
- Focused canonical boundary and atomic promotion tests passed.
- `deno task verify` passed: 21 protocol tests, 95 integration tests, and both stock-Nix E2Es.

## Known Stubs

None.

## Threat Flags

None beyond the plan register. SQLite files contain public route/blob metadata under the owner-only candidate directory; no new network or authorization surface was added.

## Self-Check: PASSED

- All production, test, and security-report files exist.
- All six task/evidence commits exist.
- Focused and full verification commands passed.
- Unrelated untracked research-cache files remained untouched.
