---
phase: 01-verified-nix-substitution-walking-slice
plan: 10
subsystem: nostr-control-plane
tags: [applesauce, eventstore, rxjs, nostr, blossom, bud-03]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plans: [03, 07]
    provides: durable publication policy and production daemon composition
provides:
  - EventStore-backed custom reactive cache selection model
  - Authenticated kind-10063 BUD-03 server discovery
  - Production D-05 source ordering with immutable request snapshots
affects: [phase-verification, blossom-resolution, publication-selection]
tech-stack:
  added: []
  patterns: [commit-before-store-admission, custom-eventstore-model, immutable-source-snapshot]
key-files:
  created: [src/nostr/blossom_servers.ts, tests/integration/blossom_discovery_test.ts]
  modified: [src/nostr/selection.ts, src/runtime/daemon.ts, tests/integration/publication_selection_test.ts]
key-decisions:
  - "Keep StateRepository authoritative for rollback and downgrade policy; EventStore receives only verified, authorized, durably accepted cache publications."
  - "Project BUD-03 data inside CacheSelectionModel and preserve publisher trust when constructing each request source plan."
requirements-completed: [PROT-03, TREE-01]
coverage:
  - id: D1
    description: Durable publications drive an EventStore-backed custom selection model without a BehaviorSubject authority
    requirement: PROT-03
    verification:
      - kind: integration
        ref: tests/integration/publication_selection_test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Authenticated publisher kind-10063 replacements reactively supply strict ordered BUD-03 URLs
    requirement: TREE-01
    verification:
      - kind: integration
        ref: tests/integration/blossom_discovery_test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Production source plans order configured, publication-tag, and BUD-03 origins while retaining publisher trust
    requirement: TREE-01
    verification:
      - kind: integration
        ref: tests/integration/blossom_discovery_test.ts#production BUD-03 wiring
        status: pass
      - kind: e2e
        ref: deno task test:nix-e2e
        status: pass
    human_judgment: false
duration: 8 min
completed: 2026-08-12
---

# Phase 1 Plan 10: Reactive Selection and BUD-03 Discovery Summary

Applesauce EventStore now owns the reactive cache view, with durable admission gates and authenticated BUD-03 replacements feeding production source plans.

## Performance

- **Duration:** 8 min
- **Started:** 2026-08-12T13:02:12Z
- **Completed:** 2026-08-12T13:10:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Replaced the standalone selection subject with a project custom `CacheSelectionModel` obtained through `EventStore.model`, while retaining synchronous immutable snapshots and explicit expiry clearing.
- Enforced publication validation, publisher/identity authorization, and durable repository acceptance before EventStore admission; rejected and transaction-failed events never reach the model.
- Added strict authenticated kind-10063 projection and production wiring in configured, event-tag, then BUD-03 order with deduplication and publisher network trust.
- Preserved restart restoration, NIP-01 lowest-id ties, rollback/downgrade policy, request snapshot immutability, and idempotent selector/store/relay disposal.

## Task Commits

1. **Task 1 RED:** `65cf30f` — failing EventStore admission and lifecycle test
2. **Task 1 GREEN:** `36cfeda` — durable EventStore-backed custom selection model
3. **Task 2:** `f4e542d` — authenticated reactive BUD-03 projection coverage
4. **Task 3:** `552dd7c` — production relay and source-plan wiring

## Files Created/Modified

- `src/nostr/selection.ts` — durable admission and custom EventStore model lifecycle.
- `src/nostr/blossom_servers.ts` — strict ordered BUD-03 `server` tag projection.
- `src/runtime/daemon.ts` — unified 17091/10063 relay subscription and BUD-03 source wiring.
- `tests/integration/publication_selection_test.ts` — store admission ordering and terminal disposal evidence.
- `tests/integration/blossom_discovery_test.ts` — authenticated projection, replacement, immutability, and production-order evidence.

## Decisions Made

- The domain repository remains the sole anti-rollback and downgrade-policy authority; Applesauce is the reactive view over admitted events.
- EventStore uses retained replaceable history so the custom model, rather than generic replacement ordering, applies NIP-01 lowest-id ties.
- BUD-03 entries are projected narrowly and remain `publisher`-trusted candidates subject to the existing D-15 DNS and redirect controls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Made the production selection wrapper idempotent**
- **Found during:** Task 3 production lifecycle test
- **Issue:** Direct repeated disposal called the relay stream disposer twice even though the selector itself was terminal and idempotent.
- **Fix:** Added a wrapper-level disposed guard before selector/store and relay cleanup.
- **Files modified:** `src/runtime/daemon.ts`
- **Verification:** Production BUD-03 wiring test calls dispose twice and observes one relay disposal.
- **Committed in:** `552dd7c`

**Total deviations:** 1 auto-fixed bug. **Impact:** Shutdown invariants are stronger without expanding scope.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno task fmt` — passed, 29 files checked.
- `deno task lint` — passed, 25 files checked.
- `deno task check` — passed across main, protocol, integration, and E2E modules.
- Publication selection integration suite — 8 passed.
- BUD-03 production-wiring integration suite — 2 passed.
- `deno task test:nix-e2e` — 1 passed with stock Nix through production `main.ts`.

## Threat Review

- T-01-10-01/02: cryptographic, authorization, repository, ordering, expiry, and disposal boundaries have focused integration coverage.
- T-01-10-03/04: strict URL projection and publisher trust preserve D-15 network enforcement and existing bounded source attempts.
- No security-relevant surface outside the plan threat model was introduced.

## Next Phase Readiness

- PROT-03 and TREE-01 now have production-connected reactive evidence.
- Plan 01-11 can complete the remaining signer/write-configuration gap closure.

## Self-Check: PASSED
