---
quick_id: 260813-qy6
status: complete
completed: 2026-08-13
subsystem: operator-debugging
tags: [debug, reactive-state, hashtree, nhash]
commit: 706d0b2
---

# Quick Task 260813-qy6 Summary

Added opt-in compact DEBUG state transitions with canonical, copyable `nhash`
identifiers for both the ordered reactive read-cache selection and the durable
writable Hashtree candidate.

The cache logger consumes the already-distinct `selected$` snapshots and emits
only a transition label, count, and ordered identity/root entries. The batch
scheduler logs only after `recordPending` succeeds, restores an existing pending
candidate once at startup, and suppresses unchanged roots while retaining only
the last root string. Logging failures remain non-authoritative.

## Commits

- `c2ea056` — RED tests for exact compact state-debug contracts
- `9bcc37e` — compact cache and writable-Hashtree DEBUG namespaces
- `922595f` — RED tests for durable root transitions and failed builds
- `706d0b2` — reactive cache and durable writable-root integration

## Verification

- Scoped format and lint checks passed for all five planned files.
- Focused debug and publication-batch suite: 13 passed, 0 failed.
- Full type check passed.
- Full protocol suite: 28 passed, 0 failed.
- Full integration suite: 144 passed, 0 failed.
- Stock-Nix E2E rerun: 2 passed, 0 failed. The first combined verification run
  had one transient signed-publication timeout; the isolated test and complete
  E2E task both subsequently passed.

## Deviations from Plan

None — the plan was executed as written.

## Known Stubs

None.

## Self-Check: PASSED

All five planned source/test files exist and all four task commits are present.
