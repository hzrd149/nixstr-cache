---
phase: 01-verified-nix-substitution-walking-slice
plan: 05
subsystem: end-to-end-verification
tags: [nix, deno, nostr, blossom, hashtree, sqlite, streaming]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 04
    provides: snapshot-bound Nix HTTP cache routes and daemon lifecycle
provides:
  - Stock Nix 2.34.7 substitution through the complete verified walking slice
  - Ephemeral signed fixture generation without committed private material
  - One narrow-permission Phase 1 verification command
affects: [phase-verification, read-path-regression, operator-runbook]
tech-stack:
  added: []
  patterns: [isolated-local-nix-stores, ephemeral-signing-keys, child-daemon-e2e]
key-files:
  created:
    - tests/e2e/nix_substitution_test.ts
    - tests/fixtures/nix/README.md
    - README.md
  modified:
    - deno.json
    - deno.lock
key-decisions:
  - "Generate the signed cache fixture at test runtime so the repository never contains a reusable private Nix signing key."
  - "Use separate local-root Nix stores for every substitution so ambient store contents cannot satisfy the acceptance gate."
requirements-completed: [READ-07]
duration: 6 min
completed: 2026-08-12
---

# Phase 1 Plan 5: Stock Nix Substitution Acceptance Summary

Pinned Nix 2.34.7 now accepts a signed uncached store object exclusively through relay-selected, SQLite-persisted, Blossom-fetched, Hashtree-resolved daemon streams.

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-12T11:07:26Z
- **Completed:** 2026-08-12T11:12:43Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added an isolated stock-Nix acceptance harness that creates separate source and destination stores, proves absence, disables fallback, trusts one exact ephemeral public key, and independently verifies the realized path.
- Exercised a child daemon through a real loopback WebSocket relay, durable SQLite selection, address-pinned Blossom acquisition, canonical Hashtree traversal, exact narinfo preservation, and streamed compressed NAR delivery.
- Proved restart persistence plus repeat and concurrent substitutions using fresh destination stores and access-log assertions that prevent bypass false positives.
- Added `deno task verify`, covering format, lint, type checking, 12 protocol tests, 23 permission-scoped integration tests, and the stock-Nix E2E.

## Task Commits

1. **Task 1 RED:** `efd31b4` — failing stock Nix substitution acceptance gate
2. **Task 1 GREEN:** `73db7b8` — verified stock Nix substitution walking slice
3. **Task 2:** `9a5df0c` — comprehensive narrow-permission verification matrix

## Decisions Made

- Generate the Nix binary-cache signing key only inside a mode-0700 temporary directory, then delete it; fixture documentation records generation inputs and protocol revisions instead of committing a secret.
- Use `local?root=...` stores for the source and each destination, and explicitly set the daemon as the sole substituter with fallback disabled.
- Start the E2E daemon as a child Deno process while loopback relay and Blossom fixtures remain controlled by the test process, proving process, network, persistence, and client boundaries together.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Canonically sorted generated root-manifest entries**
- **Found during:** Task 1 GREEN verification
- **Issue:** The first generated root manifest placed the store-hash entry before `nar`, violating the codec's bytewise directory-name ordering and returning HTTP 502.
- **Fix:** Ordered `nar` before the store-hash narinfo entry, matching canonical BUD-16 directory encoding.
- **Files modified:** `tests/e2e/nix_substitution_test.ts`
- **Verification:** `deno task test:nix-e2e` passes with stock Nix 2.34.7.
- **Commit:** `73db7b8`

**2. [Rule 3 - Blocking] Completed approved lockfile resolutions**
- **Found during:** Task 1 verification
- **Issue:** Previously declared exact dependencies for the full verification graph were not yet resolved in `deno.lock`.
- **Fix:** Let Deno record the exact integrity entries already pinned in `deno.json`; no package names or versions changed.
- **Files modified:** `deno.lock`
- **Verification:** The complete clean-environment `deno task verify` succeeds without installation or lock updates.
- **Commit:** `73db7b8`

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking issue). **Impact:** The fixes enforce canonical authenticated data and reproducible dependency resolution without expanding product scope.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno task test:nix-e2e` — 1 passed, stock Nix 2.34.7 substitution verified after restart and under concurrent fresh stores
- clean-environment `deno task verify` — format/lint/check passed; 12 protocol, 23 integration, and 1 E2E tests passed
- Repository secret contract — no private fixture key is committed; the private key exists only below the temporary test root

## Next Phase Readiness

- Phase 1's complete read-only walking slice is reproducible with one command and ready for phase verification.
- Later phases can extend the same trust boundaries with merged publishers, verified local cache fill, signer-gated PUT, and publication.

## Self-Check: PASSED

- All three declared created files and both modified files exist.
- Commits `efd31b4`, `73db7b8`, and `9a5df0c` exist in repository history.
- All task acceptance evidence and plan-level verification commands pass.
