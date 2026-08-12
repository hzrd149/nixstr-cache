---
phase: 01-verified-nix-substitution-walking-slice
plan: 04
subsystem: nix-http-serving
tags: [narinfo, ed25519, streaming, snapshot-consistency, deno]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 02
    provides: immutable validated publication snapshots
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 03
    provides: bounded verified path resolution
provides:
  - Strict lossless narinfo parsing and byte-key endorsement classification
  - Snapshot-bound stock Nix GET/HEAD adapter with typed status mapping
  - Validate/restore/compose/bind lifecycle with ordered shutdown
affects: [01-05, nix-e2e, daemon-runtime]
tech-stack:
  added: ["@noble/curves Ed25519"]
  patterns: [capture-once snapshot, lossless repeatable fields, bind-listener-last]
key-files:
  created: [src/protocol/narinfo.ts, src/nix/http_handler.ts, src/app.ts, tests/protocol/narinfo_test.ts, tests/integration/http_cache_test.ts]
  modified: [main.ts, deno.json, deno.lock]
key-decisions:
  - "Preserve the complete authenticated narinfo text and classify publisher endorsement separately by Ed25519 key bytes."
  - "Capture selection before route-specific work and pass the immutable snapshot into resolver construction."
requirements-completed: [READ-01, READ-02, READ-03, READ-04, OPER-01]
duration: 14 min
completed: 2026-08-12
---

# Phase 1 Plan 4: Nix HTTP Walking Slice Summary

Strict lossless narinfo handling and snapshot-bound streamed HTTP routes expose verified trees through stock Nix semantics while listener binding remains the final startup side effect.

## Performance

- **Duration:** 14 min
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added strict scalar/repeatable narinfo parsing, canonical Ed25519 signature syntax, exact ordered `Sig` preservation, and name-independent publisher endorsement metadata.
- Added fixed `nix-cache-info`, strict narinfo/NAR route grammar, GET/HEAD behavior, verified streaming, request cancellation propagation, and precise 404/502/503/504/405 mapping.
- Proved concurrent requests retain their own captured roots and HEAD authenticates presence without acquiring final content.
- Added side-effect-free composition that validates all configuration before durable resources, creates restored selection before the handler, binds last, and tears resources down after listener shutdown.

## Task Commits

1. **Task 1 RED:** `c76bdda`
2. **Task 1 GREEN:** `dc5f9c4`
3. **Task 2 RED:** `1bdc6bf`
4. **Task 2 GREEN:** `f7c89cd`
5. **Task 3:** `0483978`
6. **Verification fix:** `8e1c45d`

## Decisions Made

- Preserve authenticated narinfo source text as the serialization authority so every valid signature line remains byte-identical and ordered.
- Match endorsements against the Nix fingerprint and decoded Ed25519 key bytes; signature/key labels never influence endorsement.
- Capture selection at handler entry, before path parsing or asynchronous work, so overlapping old/new requests cannot splice roots.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Routed Noble Curves through the pinned import map**
- **Found during:** Plan-level lint verification
- **Issue:** Direct versioned npm specifiers violated the repository `no-import-prefix` lint gate.
- **Fix:** Added the exact `@noble/curves@2.3.0` import-map entry and used its bare subpath.
- **Files modified:** `deno.json`, `deno.lock`, `src/protocol/narinfo.ts`, `tests/protocol/narinfo_test.ts`
- **Verification:** `deno lint` and all targeted checks/tests pass.
- **Commit:** `8e1c45d`

**Total deviations:** 1 auto-fixed blocking issue. **Impact:** Dependency resolution is explicit and reproducible; protocol behavior is unchanged.

## Authentication Gates

None.

## Known Stubs

None.

## Verification

- `deno fmt --check` — passed
- `deno lint` — passed
- `deno check main.ts src/app.ts src/nix/http_handler.ts src/protocol/narinfo.ts` — passed
- `deno test tests/protocol/narinfo_test.ts` — 4 passed
- `deno test --allow-net=127.0.0.1 --allow-read --allow-write tests/integration/http_cache_test.ts` — 5 passed

## Self-Check: PASSED

- All five declared created files exist.
- All six plan commits exist in repository history.
- Task acceptance evidence and plan-level verification commands pass.
