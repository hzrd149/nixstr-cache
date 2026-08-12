---
phase: 01-verified-nix-substitution-walking-slice
plan: 02
subsystem: publication-control-plane
tags: [nostr, rxjs, sqlite, bech32, rollback-protection]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 01
    provides: pinned Deno dependency graph and bounded configuration foundation
provides:
  - Strict NIP-01 publication validation and canonical plaintext nhash decoding
  - Transactional publication selection with restart-safe tuple watermarks
  - Durable signed-to-unsigned downgrade consent and reactive expiry handling
affects: [01-03, 01-04, blossom-resolution, nix-http-serving]
tech-stack:
  added: [node:sqlite, nostr-tools, rxjs]
  patterns: [validate-before-admission, commit-before-emit, immutable-selection-snapshot]
key-files:
  created:
    - src/protocol/nhash.ts
    - src/protocol/publication.ts
    - src/persistence/state_repository.ts
    - src/nostr/selection.ts
    - tests/protocol/publication_test.ts
    - tests/integration/publication_selection_test.ts
  modified: [deno.json, deno.lock]
key-decisions:
  - "Use NIP-01's lowest-id equal-timestamp ordering and persist the full tuple so restarts reproduce selection exactly."
  - "Use Deno's built-in node:sqlite binding so the repository works under the plan's narrow read/write permission contract without environment access."
  - "Keep reactive admission private and expose only validated, durably committed immutable snapshots through RxJS."
requirements-completed: [PROT-02, PROT-03, PROT-04, PROT-05, PROT-06]
duration: 20 min
completed: 2026-08-12
---

# Phase 1 Plan 2: Verified Publication Control Plane Summary

Strict NIP-01 and plaintext nhash validation feeds a restart-safe SQLite selector that commits rollback and downgrade policy before emitting immutable RxJS snapshots.

## Performance

- **Duration:** 20 min
- **Completed:** 2026-08-12
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added canonical Bech32/TLV decoding that accepts exactly one 32-byte type-0 root and rejects BUD-15 keys, unknown records, duplicates, truncation, and legacy payloads.
- Added a branded immutable publication boundary covering NIP-01 verification, clock skew, expiration, identity/tag multiplicity, canonical Nix signing keys, bounded parsing, and ordered valid Blossom sources.
- Added atomic SQLite persistence for the complete selected event, `(created_at,id)` watermark, signed history, unsigned consent, and future source quarantine state.
- Added reactive commit-before-emit selection with restart restore, lowest-id tie handling, expiry clearing without rollback, explicit teardown, and transaction-failure containment.

## Task Commits

1. **Task 1 RED:** `4938fc6` — failing publication validation tests
2. **Task 1 GREEN:** `f03e2ef` — strict plaintext publication validator
3. **Task 2 RED:** `8d4de92` — failing durable selection tests
4. **Task 2 GREEN:** `a617921` — transactional reactive publication selection

## Decisions Made

- Equal-timestamp candidates use lexicographically lowest event id, matching NIP-01 replaceable-event ordering and making persisted restart behavior deterministic.
- The repository uses Deno's built-in `node:sqlite` API. The approved `@db/sqlite` package attempted to read `DENO_SQLITE_PATH`, which violated the plan's exact no-`--allow-env` verification command.
- The selector retains a private admitted-id view rather than importing Applesauce `EventStore` directly because Applesauce's `debug` dependency also requires environment permission at module initialization. RxJS remains the reactive public boundary, and unverified relay data cannot enter observable state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Defeated inherited nostr-tools verification cache**
- **Found during:** Task 1 GREEN verification
- **Issue:** `nostr-tools` memoizes verification using a symbol property; spreading a previously verified event after tampering retained the symbol.
- **Fix:** Reconstruct a fresh, explicit NIP-01 event object before every verification.
- **Files modified:** `src/protocol/publication.ts`
- **Verification:** Tampered-event fixture is rejected.
- **Commit:** `f03e2ef`

**2. [Rule 3 - Blocking] Preserved narrow test permissions for SQLite and reactive admission**
- **Found during:** Task 2 GREEN verification
- **Issue:** `@db/sqlite` and Applesauce `EventStore` transitively read environment variables during initialization, causing the mandated `--allow-read --allow-write` test to fail.
- **Fix:** Used Deno's built-in SQLite binding and a private validate-before-admission view, retaining RxJS composition and all durable selection guarantees without widening permissions.
- **Files modified:** `src/persistence/state_repository.ts`, `src/nostr/selection.ts`
- **Verification:** The exact plan-level integration test command passes without `--allow-env`.
- **Commit:** `a617921`

**Total deviations:** 2 auto-fixed (1 security, 1 blocking). **Impact:** The implementation strengthens the trust boundary and preserves the specified narrow runtime permissions; no public protocol behavior changed.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno fmt --check` — passed
- `deno lint` — passed
- `deno check src/protocol/nhash.ts src/protocol/publication.ts src/persistence/state_repository.ts src/nostr/selection.ts` — passed
- `deno test tests/protocol/publication_test.ts` — 4 passed, 0 failed
- `deno test --allow-read --allow-write tests/integration/publication_selection_test.ts` — 5 passed, 0 failed

## Self-Check: PASSED

- All six declared created files exist.
- Task commits `4938fc6`, `f03e2ef`, `8d4de92`, and `a617921` exist in repository history.
- All acceptance evidence and plan-level verification commands pass.
