---
phase: quick-260814-ff8
plan: 01
subsystem: configuration-and-runtime
tags: [deno, nostr, nip-65, nixos, writable-cache]
requires:
  - phase: 04-availability-gated-publication-loop
    provides: signer-gated writable overlay and publication lifecycle
provides:
  - Empty read-only startup with mandatory bootstrap discovery
  - Signer-derived reactive publication relay readiness
  - Optional cache and extra-relay NixOS configuration
affects: [configuration, nostr-runtime, write-readiness, nixos-module]
tech-stack:
  added: []
  patterns: [bootstrap metadata discovery, reactive effective relay readiness]
key-files:
  created: []
  modified:
    - src/config/config.ts
    - src/nostr/publications.ts
    - src/runtime/daemon.ts
    - tests/integration/operator_config_test.ts
    - tests/integration/nostr_runtime_test.ts
    - nix/module.nix
    - nix/example-vm.nix
    - README.md
key-decisions:
  - "Keep bootstrap relays mandatory while allowing read identities and extra relays to be empty."
  - "Use the latest signer relaySetFor emission for health, PUT readiness, and publication destinations."
patterns-established:
  - "Empty publisher sets do not open relay subscriptions with empty author filters."
requirements-completed: []
coverage:
  - id: D1
    description: Empty read-only configurations start and return 503 for cache misses without empty-author subscriptions.
    verification:
      - kind: integration
        ref: tests/integration/operator_config_test.ts#empty read-only config keeps bootstrap relays and serves 503
        status: pass
      - kind: integration
        ref: tests/integration/nostr_runtime_test.ts#empty publisher stream creates no metadata or relay subscription
        status: pass
    human_judgment: false
  - id: D2
    description: Writable-only startup discovers signer NIP-65 relays and requires a BUD-03 destination before becoming ready.
    verification:
      - kind: integration
        ref: tests/integration/operator_config_test.ts#writable-only signer NIP-65 discovery enables an empty cache
        status: pass
      - kind: integration
        ref: deno task test:integration (155 tests)
        status: pass
    human_judgment: false
  - id: D3
    description: NixOS and operator guidance treats caches and extra relays as optional.
    verification:
      - kind: other
        ref: nix flake check --no-build
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-08-14
status: complete
---

# Quick Task 260814-ff8: Remove startup requirements for non-empty cache inputs Summary

**Empty read-only and writable-only daemons now start through bootstrap discovery while preserving signer, relay, and Blossom readiness gates.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-14T10:12:08Z
- **Completed:** 2026-08-14T10:21:02Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Made `caches` and `extraRelays` optional without relaxing entry validation, limits, or the non-empty bootstrap-relay requirement.
- Prevented initial publication subscriptions when no publisher identities exist.
- Made signer NIP-65 metadata and the live effective relay set authoritative for publication, health, and PUT readiness.
- Removed NixOS assertions for optional inputs and documented empty and writable-only operating modes.

## Task Commits

1. **Task 1 RED: Empty startup regressions** - `f8e06ba`
2. **Task 1 GREEN: Empty read-only startup** - `afea8f3`
3. **Task 2 RED: Writable-only readiness regression** - `29d9633`
4. **Task 2 GREEN: Live signer relay readiness** - `93e3a92`
5. **Task 3: NixOS and operator documentation** - `7004d39`
6. **Formatting follow-up** - `33b97b8`

## Files Created/Modified

- `src/config/config.ts` - Allows omitted or empty cache and extra-relay lists.
- `src/nostr/publications.ts` - Skips initial no-author subscriptions.
- `src/runtime/daemon.ts` - Follows signer metadata and tracks the live write relay set.
- `tests/integration/operator_config_test.ts` - Covers empty read-only and writable-only production lifecycles.
- `tests/integration/nostr_runtime_test.ts` - Guards against empty publisher subscriptions.
- `nix/module.nix` - Removes obsolete mandatory-input assertions.
- `nix/example-vm.nix` - Demonstrates an intentionally empty deployment.
- `README.md` - Documents optional inputs, empty responses, and signer discovery.

## Decisions Made

- Retained the existing `NostrService` API because `followUserMetadata`, `relaySetFor`, and `currentRelaySet` already provide the required verified-store behavior; no change to `src/nostr/runtime.ts` was necessary.
- Snapshotted each emitted effective signer relay set in daemon runtime state so all write-readiness consumers observe the same value.

## Deviations from Plan

None - the plan was implemented with the existing Nostr runtime API and no scope expansion.

## Issues Encountered

- The plan's pipe-separated Deno filter matched zero tests in this Deno version. Focused tests were rerun with matching individual filters, followed by both complete target files and the full integration suite.
- The first full integration invocation exceeded its 120-second command timeout while unrelated concurrent work was changing the NIP-46 tests. A fresh full run completed in 7 seconds with 155 passing tests.

## Verification

- `deno fmt --check ...` - passed.
- `deno lint ...` - passed.
- `deno check main.ts tests/integration/operator_config_test.ts tests/integration/nostr_runtime_test.ts` - passed.
- Complete focused integration files - 34 passed.
- `deno task test:integration` - 155 passed.
- `nix flake check --no-build` - passed, including module and example VM evaluation without cache or extra-relay settings.

## Known Stubs

None.

## User Setup Required

None.

## Self-Check: PASSED

All eight modified implementation/test/documentation files exist, and all six task commits are present in Git history.

---
*Quick task: 260814-ff8*
*Completed: 2026-08-14*
