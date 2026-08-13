---
phase: 01-verified-nix-substitution-walking-slice
plan: 11
subsystem: configuration
tags: [deno, typescript, signer-intent, validation, nix]
requires:
  - phase: 01-07
    provides: validated startup composition and side-effect ordering
provides:
  - Explicit disabled, NIP-46, and local signer configuration modes
  - Strict typed writable kind-17091 and kind-37091 identity parsing
  - Production environment mapping while retaining read-only HTTP behavior
affects: [phase-03-signers-and-write-api, operator-configuration]
tech-stack:
  added: []
  patterns: [discriminated capability intent, aggregate pure startup validation]
key-files:
  created: [tests/integration/operator_config_test.ts]
  modified: [src/config/config.ts, main.ts]
key-decisions:
  - "Represent configured write capability as a discriminated writeIntent union, while treating it only as intent until Phase 3 proves signer ownership and readiness."
  - "Parse writable identities into exact kind, lowercase pubkey, and identifier fields at the environment validation boundary."
patterns-established:
  - "Capability intent is validated before repository, relay, filesystem, signer, or listener side effects."
requirements-completed: [OPER-01]
coverage:
  - id: D1
    description: "Explicit read-only defaults and strict typed signer/write-identity validation"
    requirement: OPER-01
    verification:
      - kind: integration
        ref: "tests/integration/operator_config_test.ts#operator config defaults and write intents"
        status: pass
    human_judgment: false
  - id: D2
    description: "Production environment mapping with PUT remaining disabled"
    requirement: OPER-01
    verification:
      - kind: integration
        ref: "tests/integration/operator_config_test.ts#environment mapping, no-side-effects, and PUT 405"
        status: pass
      - kind: e2e
        ref: "deno task test:nix-e2e"
        status: pass
    human_judgment: false
duration: 3min
completed: 2026-08-12
status: complete
---

# Phase 01 Plan 11: Signer Write-Intent Configuration Summary

**Strict discriminated signer intent and writable cache identity validation at startup, with stock-Nix reads unchanged and PUT still disabled**

## Performance

- **Duration:** 3 min
- **Started:** 2026-08-12T13:10:00Z
- **Completed:** 2026-08-12T13:12:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added explicit read-only, NIP-46, and local signer modes with fail-closed mode/identity pairing.
- Strictly parsed default and named writable cache identities into typed immutable data while aggregating diagnostics before startup side effects.
- Mapped both operator environment variables without constructing a signer or changing the GET/HEAD-only HTTP surface.

## Task Commits

1. **Task 1 RED: failing write-intent config tests** - `fafb374` (test)
2. **Task 1 GREEN: validate explicit signer write intent** - `a1c7739` (feat)
3. **Task 2 RED: failing signer environment tests** - `c664a5b` (test)
4. **Task 2 GREEN: map signer environment fields** - `3ed7041` (feat)

## Files Created/Modified

- `src/config/config.ts` - Raw signer fields, strict writable identity parser, and validated write-intent union.
- `main.ts` - Production environment mapping and allowlist entries for signer mode and writable identity.
- `tests/integration/operator_config_test.ts` - Read-only defaults, complete/malformed intent, aggregate diagnostics, startup tripwires, environment mapping, and PUT-disabled coverage.

## Decisions Made

- Configuration proves only syntactic capability intent; active signer ownership, destination readiness, and write authorization remain Phase 3 responsibilities.
- Named cache identifiers use the publication boundary's raw, non-normalized, bounded label rules and reject extra identity separators.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno test --allow-read --allow-write tests/integration/operator_config_test.ts` — 4 passed after Task 1.
- `deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts` — 7 passed.
- `deno task fmt` — passed, 30 files checked.
- `deno task lint` — passed, 26 files checked.
- `deno task check` — passed across production, protocol, integration, and E2E modules.
- `deno task test:nix-e2e` — 1 passed with stock Nix through production `main.ts`.

## Threat Review

- T-01-11-01/02: closed signer mode enumeration, exact identity grammar, and a discriminated intent union prevent configuration from becoming authorization.
- T-01-11-03: aggregate validation and startup tripwires prove malformed intent cannot reach filesystem, repository, relay, or listener setup.
- T-01-11-SC: no dependencies or lockfiles changed.
- No security-relevant surface outside the plan threat model was introduced.

## Next Phase Readiness

- Phase 3 can consume `writeIntent` without reinterpreting raw environment strings.
- Signer lifecycle, pubkey ownership proof, staging, destination readiness, and PUT authorization remain intentionally unimplemented.

## Self-Check: PASSED
