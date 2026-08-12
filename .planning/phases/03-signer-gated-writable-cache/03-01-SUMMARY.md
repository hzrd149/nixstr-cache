---
phase: 03-signer-gated-writable-cache
plan: 01
subsystem: writable-cache
tags: [deno, applesauce-signers, nip46, sqlite, streaming, nix-put]
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    provides: strict Narinfo parsing, bounded streaming primitives, durable SQLite state
  - phase: 02-deterministic-merged-read-cache
    provides: immutable request-entry cache snapshots and current BUD-03 destinations
provides:
  - Status-only signer lifecycle with exact writable-identity ownership
  - Owner-only, quota-reserved, restart-safe immutable upload staging
  - Fail-closed stock-Nix PUT routing for Narinfo and NAR bodies
affects: [03-02-eligibility-overlay, 03-03-hashtree-batching, 04-publication]
tech-stack:
  added: [applesauce-signers@6.2.2]
  patterns: [status-only secret boundary, request-entry write readiness snapshot, hard-link immutable promotion]
key-files:
  created: [src/signer/capability.ts, src/persistence/write_repository.ts, tests/integration/writable_cache_test.ts]
  modified: [deno.json, deno.lock, main.ts, src/config/config.ts, src/nix/http_handler.ts, src/runtime/daemon.ts, tests/integration/operator_config_test.ts]
key-decisions:
  - "Expose only signer status and public-key ownership; cache-event signing remains unavailable until Phase 4."
  - "Reserve the configured per-body ceiling transactionally before opening a temp file, preventing concurrent aggregate oversubscription."
  - "Use same-filesystem hard-link creation for no-overwrite immutable promotion, followed by transactional route metadata."
  - "Treat signer ownership, repository health, publication relays, and a current configured/BUD-03 Blossom destination as one captured PUT readiness fact."
patterns-established:
  - "Protected sources are mode-specific owner-only files read only during signer activation, with observable failures reduced to stable codes."
  - "PUT bodies stay on Web Streams and become visible only after hashing, fsync, immutable promotion, and SQLite commit."
requirements-completed: [WRIT-01, WRIT-02, WRIT-03, WRIT-04]
coverage:
  - id: D1
    description: "An exact-owner local signer transitions through a sanitized status-only lifecycle and enables staging without exposing a signing API."
    requirement: WRIT-01
    verification:
      - kind: integration
        ref: "tests/integration/writable_cache_test.ts#owned signer streams one NAR into durable staging"
        status: pass
    human_judgment: false
  - id: D2
    description: "Local and NIP-46 configuration requires exactly the matching protected source and derives the configured identity owner before readiness."
    requirement: WRIT-02
    verification:
      - kind: integration
        ref: "tests/integration/operator_config_test.ts#enabled signer requires exactly its protected source and staging limits"
        status: pass
    human_judgment: false
  - id: D3
    description: "PUT remains a 405 GET/HEAD-only capability until every signer, storage, relay, and Blossom prerequisite is ready."
    requirement: WRIT-03
    verification:
      - kind: integration
        ref: "tests/integration/writable_cache_test.ts#PUT is fail closed and stock routes are immutable"
        status: pass
    human_judgment: false
  - id: D4
    description: "Stock-Nix NAR and Narinfo uploads stream into bounded durable storage with restart persistence, idempotent retry, and immutable conflict handling."
    requirement: WRIT-04
    verification:
      - kind: integration
        ref: "tests/integration/writable_cache_test.ts"
        status: pass
    human_judgment: false
duration: 28min
completed: 2026-08-12
status: complete
---

# Phase 3 Plan 1: Signer-Owned Streamed PUT Staging Summary

**Exact-owner local/NIP-46 signer readiness gates bounded stock-Nix uploads into fsynced, immutable, restart-safe SQLite-backed staging.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-08-12T14:07:00Z
- **Completed:** 2026-08-12T14:35:44Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added a sanitized signer capability that validates owner-only local or NIP-46 session files and enables writes only for the exact configured cache pubkey.
- Added transactional aggregate reservations and streamed SHA-256 staging with body ceilings, fsync, owner-only files, no-overwrite promotion, restart recovery, idempotency, and immutable conflict rejection.
- Extended production configuration, daemon lifecycle, and HTTP routing so only exact stock-Nix PUT routes are admitted after one conjunctive readiness snapshot; incomplete or failed prerequisites retain the existing 405 GET/HEAD-only behavior.
- Kept Phase 4 side effects absent: no cache event signing, Blossom upload, or cache-root publication was introduced.

## Task Commits

Each task was committed atomically using TDD gates:

1. **Task 1 RED: signer and durable staging behavior** - `4798a9a` (test)
2. **Task 1 GREEN: owned signer to durable staging tracer** - `5c9bdae` (feat)
3. **Task 2 RED: production PUT routing behavior** - `1775b2d` (test)
4. **Task 2 GREEN: fail-closed stock-Nix PUT lifecycle** - `142462e` (feat)
5. **Task 2 correction: exact approved local signer API** - `3ea708c` (fix)

## Files Created/Modified

- `src/signer/capability.ts` - Protected secret providers and status-only signer ownership lifecycle.
- `src/persistence/write_repository.ts` - SQLite reservations, streamed staging, immutable content promotion, and conflict-safe route metadata.
- `src/nix/http_handler.ts` - Request-entry PUT readiness gate and strict stock-Nix upload routing.
- `src/runtime/daemon.ts` - Local/NIP-46 signer activation, destination-aware readiness, and ordered shutdown.
- `src/config/config.ts` and `main.ts` - Protected-source and staging configuration validation/environment mapping.
- `deno.json` and `deno.lock` - Exact `applesauce-signers@6.2.2` dependency pin.
- `tests/integration/writable_cache_test.ts` - End-to-end signer, streaming, restart, quota, idempotency, conflict, and route tests.
- `tests/integration/operator_config_test.ts` - Mode-specific protected-source and production lifecycle tests.

## Decisions Made

- The `[SUS]` dependency provenance checkpoint was resolved by explicit developer approval against the installed exact 6.2.2 API and the official `hzrd149/applesauce` monorepo; execution continued without a human checkpoint.
- NIP-46 uses explicit relay subscription/publish transport methods, a headless sanitized authorization notification, and only the configured kind-17091 or kind-37091 permission.
- The local `PrivateKeySigner` instance remains internal behind a public-key-only interface. Its owned key bytes are zeroed on failure or shutdown; no publication method crosses the capability boundary.
- Narinfo is parsed only after a bounded spool completes. A parse or route-hash mismatch discards its staged row and unreferenced blob before returning an error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the no-environment permission boundary while instantiating the approved signer**
- **Found during:** Task 1 tracer verification
- **Issue:** The package's transitive Node `debug` entrypoint enumerated `process.env` at module initialization, causing the plan's no-`--allow-env` tracer command to fail before tests ran.
- **Fix:** Load the exact pinned `PrivateKeySigner` lazily while temporarily presenting an empty Node environment object, then restore the environment facade immediately; signer construction and `fromKey()` remain the upstream 6.2.2 implementation.
- **Files modified:** `src/signer/capability.ts`
- **Verification:** The exact tracer command passes without environment permission; lint and full type-check also pass.
- **Committed in:** `3ea708c`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** The correction preserves both required package use and the narrower runtime permission contract without expanding scope.

## Issues Encountered

- The dependency checkpoint was already approved by the developer and was recorded rather than re-presented.
- The tracer feedback gate passed end to end before production routing expansion.

## User Setup Required

Enabled write mode requires the new protected source and staging environment values: `NIXSTR_LOCAL_KEY_PATH` or `NIXSTR_NIP46_SESSION_PATH` (matching mode), `NIXSTR_STAGING_DIRECTORY`, and optional positive `NIXSTR_STAGING_BODY_BYTES` / `NIXSTR_STAGING_AGGREGATE_BYTES` ceilings. Secret files must be owner-only (`0600`).

## Next Phase Readiness

- Plan 03-02 can consume durable NAR/Narinfo rows in either arrival order to compute dependency-closed eligibility and a signer-first overlay.
- No Phase 4 network upload, replica completeness, cache-root signing, or publication behavior exists yet.

## Self-Check: PASSED

- All created files exist.
- Task commits `4798a9a`, `5c9bdae`, `1775b2d`, `142462e`, and `3ea708c` exist.
- Focused integration tests, formatting, lint, type-check, and the no-publication source assertion pass.

---
*Phase: 03-signer-gated-writable-cache*
*Completed: 2026-08-12*
