---
phase: quick-milestone-review-closure
plan: 01
subsystem: publication-lifecycle
tags: [deno, sqlite, nostr, nix, streaming, cancellation, garbage-collection]
requires:
  - phase: 04-availability-gated-publication-loop
    provides: availability-gated publication and durable repair baseline
provides:
  - repeatable generation rollover with retained repair ownership
  - reference-counted writer and publication blob reclamation
  - lazy bounded file-manifest traversal
  - bounded cancellable signer, replica, and relay publication
  - two-generation stock-Nix publication and restoration proof
affects: [publication, writable-cache, hashtree, operations]
tech-stack:
  added: []
  patterns: [durable ownership ledger, admission watermark, abort-first shutdown]
key-files:
  created: []
  modified: [src/persistence/write_repository.ts, src/hashtree/writer.ts, src/write/publication_coordinator.ts, src/runtime/daemon.ts, tests/e2e/nix_publication_roundtrip_test.ts]
key-decisions:
  - "Configured relay OK is the publication barrier; auxiliary local-relay forwarding occurs only from admitted selector events."
  - "Candidate content is deleted only at zero durable and transient owners, with abandoned runs reconciled by process session."
  - "A relay-observed exact event satisfies selector admission without a duplicate EventStore insertion."
patterns-established:
  - "Publication generations transfer inventory ownership from writer run to batch, saga, and bounded history."
  - "External signer and relay operations race finite deadlines and the coordinator lifetime abort signal."
requirements-completed: [READ-03, WRIT-04, WRIT-06, PUBL-02, PUBL-03, PUBL-04, PUBL-05, PUBL-07, OPER-04]
coverage:
  - id: D1
    description: Distinct writable-cache generations publish sequentially and remain substitutable by stock Nix.
    requirement: PUBL-07
    verification:
      - kind: e2e
        ref: tests/e2e/nix_publication_roundtrip_test.ts#stock Nix uploads through production and substitutes from the newly published root
        status: pass
    human_judgment: false
  - id: D2
    description: Writer runs and admitted history reclaim only zero-owner content.
    requirement: PUBL-02
    verification:
      - kind: unit
        ref: tests/protocol/hashtree_writer_test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Publication shutdown aborts hanging external work without late durable promotion.
    requirement: PUBL-05
    verification:
      - kind: integration
        ref: tests/integration/publication_loop_test.ts#shutdown cancels hanging signer and rejects its late result
        status: pass
    human_judgment: false
duration: 2h
completed: 2026-08-12
status: complete
---

# Quick 260812-nes: Milestone Review Closure Summary

**Repeatable decentralized cache publication with transactional saga rollover, reference-counted reclamation, lazy traversal, bounded cancellation, and two-generation stock-Nix proof**

## Accomplishments

- Closed CR-01 through CR-03 with transactional newer-generation rollover, stable historical repair ownership, admission-safe snapshot leases, live quota accounting, and zero-owner cleanup.
- Closed WR-01 and WR-02 with pull-driven bounded DFS plus abort-first coordinator shutdown and finite signer/relay adapters.
- Closed WR-03 with discriminating lifecycle, cleanup, cancellation, restart, and two-distinct-generation real-Nix coverage.

## Task Commits

- `0af90dc`, `680866f`, `9f77e94`, `42bf54d`: generation rollover, stable repair IDs, and overlay leases.
- `05e9e9a`, `70b140a`: claimed-work restoration and bounded external cancellation.
- `fe0506f`, `4a824d0`, `91ca298`, `373ad7a`: lazy traversal, ownership ledger, pruning, and lazy startup reconciliation.
- `8b06d81`: production barrier correction and two-generation stock-Nix workflow.

## Decisions Made

- Preserve signed event history for anti-rollback evidence while releasing terminal archived inventories and repair rows.
- Treat ambiguous ownership conservatively; filesystem deletion follows committed zero-owner ledger state.
- Do not put local cache forwarding behind configured relay acknowledgement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed auxiliary local relay from the configured relay barrier**

- **Found during:** Production two-generation E2E
- **Issue:** Generation 2 became pending while generation 1 remained committed and unadmitted because auxiliary forwarding never returned.
- **Fix:** Forward local events from selector admission only and recognize an already-observed exact event.
- **Verification:** Two-generation stock-Nix E2E and full `deno task verify`.
- **Committed in:** `8b06d81`

**2. [Rule 1 - Bug] Deferred ownership-ledger creation until actual writer use**

- **Found during:** Full verification
- **Issue:** Failed signer startup created ledger artifacts despite the side-effect-free startup contract.
- **Fix:** Lazily initialize and reconcile the ledger on first build.
- **Committed in:** `373ad7a`

## Known Stubs

None.

## Self-Check: PASSED

- All modified production and test files exist.
- All listed commits are present in git history.
- `deno task verify` passed: 21 protocol, 97 integration, 2 stock-Nix E2E tests.

## Next Phase Readiness

The six milestone-review findings are closed with no known actionable blocker.
