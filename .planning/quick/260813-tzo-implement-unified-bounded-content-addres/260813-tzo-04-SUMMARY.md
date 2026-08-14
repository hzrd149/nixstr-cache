---
phase: 260813-tzo-implement-unified-bounded-content-addres
plan: 04
subsystem: runtime
tags: [blob-store, migration, blossom, nix, e2e]
requires:
  - phase: 260813-tzo-03
    provides: chunked writable routes and durable publication ownership
provides:
  - One daemon-owned BlobStore lifecycle with pre-bind legacy migration
  - Direct persistent-store reads without the obsolete loopback Blossom cache
  - Cold/warm stock-Nix substitution and writable publication restart coverage
affects: [runtime, configuration, nix-e2e, deployment]
tech-stack:
  added: []
  patterns: [pre-bind store reconciliation, authenticated BUD-03 destination gating]
key-files:
  created: []
  modified: [main.ts, src/runtime/daemon.ts, src/config/config.ts, src/blossom/source_plan.ts, tests/e2e/nix_substitution_test.ts, tests/e2e/nix_publication_roundtrip_test.ts]
key-decisions:
  - "The shared BlobStore is opened once during selection construction and its legacy migration is awaited before listener bind and signer activation."
  - "A loopback Blossom origin receives configured network trust only when the operator configured that origin and the signer independently advertised it through authenticated BUD-03 discovery."
patterns-established:
  - "Remote event, BUD-03, and configured fallback ordering feeds one persistent store; warm reads never add a second HTTP cache hop."
requirements-completed: []
coverage:
  - id: D1
    description: Daemon startup migrates one shared store before activation and drains it during shutdown.
    verification:
      - kind: integration
        ref: tests/integration/blob_store_migration_test.ts and tests/integration/operator_config_test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Obsolete local Blossom configuration, source role, and population sink are removed.
    verification:
      - kind: other
        ref: "negative rg over main.ts src tests docs examples"
        status: pass
    human_judgment: false
  - id: D3
    description: Stock Nix proves cold/warm substitution, writable publication, and restart readiness.
    verification:
      - kind: e2e
        ref: tests/e2e/nix_substitution_test.ts and tests/e2e/nix_publication_roundtrip_test.ts
        status: pass
    human_judgment: false
duration: 35min
completed: 2026-08-14
status: complete
---

# Quick Task 260813-tzo Plan 04: Runtime Cleanup and Stock-Nix Verification Summary

**One pre-bind migrated BlobStore now backs remote reads and writable publication, with obsolete loopback caching removed and stock Nix proving cold, warm, publication, and restart flows.**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-08-14
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments

- Constructed one shared store per daemon and awaited legacy reconciliation before binding the HTTP listener or activating the signer.
- Removed the local Blossom URL, environment mapping, HTTP population sink, special source role, tests, and deployment collateral while retaining event/BUD-03/configured ordering and SSRF enforcement.
- Proved cold remote substitution, warm direct-store reuse without another blob request, two writable publication generations, byte-identical Nix substitution, and restart readiness.

## Task Commits

1. **Task 1 RED:** `fdcda59` — defined removed configuration and migrated-route behavior.
2. **Task 1 GREEN:** `9093f2a` — finalized the unified store lifecycle and removed loopback caching.
3. **Task 2 regression proof:** `f6b85c8` — added cold/warm and publication restart stock-Nix coverage.
4. **Verification fixes:** `f4e62e5`, `71f6062`, `26cf68a`, `61e5638` — preserved destination gates and seeded authenticated BUD-03 E2E discovery.

## Files Created/Modified

- `src/runtime/daemon.ts` — owns store construction, migration readiness, injection, and shutdown.
- `src/config/config.ts`, `main.ts` — remove the obsolete configuration field and environment input.
- `src/blossom/source_plan.ts`, `src/blossom/blob_fetcher.ts` — retain only publisher/configured remote source semantics.
- `src/blossom/cache_sink.ts` — deleted obsolete loopback HTTP population sink.
- `tests/e2e/nix_substitution_test.ts` — cold fetch and warm restart proof.
- `tests/e2e/nix_publication_roundtrip_test.ts`, `tests/fixtures/publication.ts` — authenticated BUD-03 publication and restart proof.

## Decisions Made

- Legacy spool and staging directories remain migration inputs, not active byte stores.
- Explicit operator configuration may authorize a loopback transport origin, but it does not make that origin an upload destination; authenticated signer BUD-03 discovery remains mandatory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the writable destination readiness gate**
- **Found during:** Full integration verification
- **Issue:** A signer-only integration case still assumed the deleted loopback cache supplied write readiness.
- **Fix:** Removed that obsolete success assumption and retained fail-closed NIP-46 coverage.
- **Files modified:** `tests/integration/nip46_signer_test.ts`
- **Verification:** Focused integration test and repository integration suite pass.
- **Committed in:** `71f6062`, `26cf68a`

**2. [Rule 2 - Missing Critical] Seeded authenticated BUD-03 discovery in publication E2E**
- **Found during:** Stock-Nix publication verification
- **Issue:** The old fixture relied on the removed local URL to provide both SSRF trust and an upload destination.
- **Fix:** Seeded a valid kind-10063 signer event and allowed configured transport trust only for a matching independently discovered BUD-03 origin.
- **Files modified:** `src/runtime/daemon.ts`, `tests/fixtures/publication.ts`, `tests/e2e/nix_publication_roundtrip_test.ts`
- **Verification:** Stock-Nix publication, two generations, substitution, and restart readiness pass.
- **Committed in:** `61e5638`

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical test/runtime integration requirement).

## Verification

The full gate was executed with an equivalent tracked-path command sequence so untracked temporary operator data remained outside formatter discovery:

- `deno fmt --check main.ts src tests README.md NIP.md config.example.json deno.json nix`
- `deno lint`
- `deno task check`
- `deno task test`
- `deno task test:integration`
- `deno task test:nix-e2e`
- negative `rg` for removed configuration symbols
- `git diff --check`

All gates passed: 30 protocol tests, 155 integration tests, and both stock-Nix E2E tests.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

Quick task 260813-tzo is complete. The daemon has one bounded physical byte store and no obsolete local HTTP cache layer.

## Self-Check: PASSED

All task commits and key implementation/test files were verified on disk.

---
*Phase: 260813-tzo Plan 04*
*Completed: 2026-08-14*
