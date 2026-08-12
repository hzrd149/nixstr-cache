---
phase: 02-deterministic-merged-read-cache
plan: 03
subsystem: blossom-cache
tags: [deno, web-streams, blossom, nix, sha256, ssrf]
requires:
  - phase: 02-01
    provides: ordered immutable multi-identity selection snapshots
  - phase: 02-02
    provides: deterministic Narinfo merging and winner-pinned NAR routing
provides:
  - exact optional local-first Blossom reads through the verified spool boundary
  - leased post-verification streamed BUD-02 population with nonfatal diagnostics
  - stock-Nix proof of merged compatible identities and remote-offline local reuse
affects: [phase-03, writable-cache, blossom-publication]
tech-stack:
  added: []
  patterns: [reference-counted verified spool leases, supervised nonfatal cache population]
key-files:
  created: [src/blossom/cache_sink.ts]
  modified: [src/blossom/blob_fetcher.ts, src/blossom/source_plan.ts, src/network/safe_fetcher.ts, src/runtime/daemon.ts, tests/e2e/nix_substitution_test.ts]
key-decisions:
  - "Treat local Blossom as a source role, never as content authority; local mismatches remain repairable and do not quarantine the origin."
  - "Open the population lease synchronously after remote verification and supervise its promise through daemon shutdown."
  - "Reject upload redirects because a streamed request body cannot be safely replayed; every local target still crosses address policy."
patterns-established:
  - "Verified fan-out: consumers retain independent spool streams and final release deletes the owner-only file exactly once."
  - "Best-effort local population reports allow-listed typed diagnostics without delaying or rejecting verified reads."
requirements-completed: [TREE-06, READ-05, READ-06]
coverage:
  - id: D1
    description: "Optional exact local Blossom is tried first, verified identically, and corrupt bytes fall back remotely."
    requirement: TREE-06
    verification:
      - kind: integration
        ref: "tests/integration/hostile_blossom_test.ts#local Blossom is first and corrupt local cache falls back without quarantine"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only verified leased spools populate local Blossom with bounded nonfatal outcomes."
    requirement: TREE-06
    verification:
      - kind: integration
        ref: "tests/integration/hostile_blossom_test.ts#populate uses a verified lease and owner disposal waits for upload"
        status: pass
    human_judgment: false
  - id: D3
    description: "Stock Nix accepts merged compatible identities and later substitutes from local bytes while remote is offline."
    requirement: READ-05
    verification:
      - kind: e2e
        ref: "tests/e2e/nix_substitution_test.ts#stock Nix substitutes merged winner and reuses populated local Blossom"
        status: pass
    human_judgment: false
  - id: D4
    description: "Conflict winner provenance and GET/HEAD-only public behavior remain deterministic."
    requirement: READ-06
    verification:
      - kind: integration
        ref: "tests/integration/merged_cache_test.ts#conflict returns byte-identical winner and emits one redacted diagnostic per loser"
        status: pass
      - kind: integration
        ref: "tests/integration/http_cache_test.ts#http cache maps methods, absence, availability, deadline and upstream errors"
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-08-12
status: complete
---

# Phase 2 Plan 3: Verified Local Blossom Read-Through Summary

**Exact local-first reads and leased verified BUD-02 population now let stock Nix reuse immutable cache bytes after remote Blossom becomes unavailable.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-12T13:54:00Z
- **Completed:** 2026-08-12T14:06:09Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added a distinct, side-effect-free `NIXSTR_LOCAL_BLOSSOM_URL` configuration and local-first source role without weakening SHA-256, size, redirect, or SSRF checks.
- Added reference-counted verified spool streams and supervised, backpressured BUD-02 population whose bounded typed failures cannot fail a read.
- Proved two priority-ordered compatible identities and a second remote-offline substitution through production `main.ts` using stock Nix.

## Task Commits

1. **Task 1 RED: local read behavior** - `c0a80c5`
2. **Task 1 GREEN: verified local-first reads** - `b379ad3`
3. **Task 2 RED: population lease behavior** - `313a722`
4. **Task 2 GREEN: leased BUD-02 population** - `0e25ef5`
5. **Task 3 RED: stock-Nix population assertion** - `c3032a1`
6. **Task 3 GREEN: merged substitution and local reuse** - `9475069`

## Files Created/Modified

- `src/blossom/cache_sink.ts` - Streams verified leases into bounded local BUD-02 uploads and returns typed outcomes.
- `src/blossom/blob_fetcher.ts` - Tracks local source role, local corruption diagnostics, verified source provenance, and reference-counted spool lifetime.
- `src/blossom/source_plan.ts` - Prepends the explicit local cache while retaining configured and publisher ordering.
- `src/network/safe_fetcher.ts` - Supports address-pinned streamed PUT requests and refuses upload redirects.
- `src/runtime/daemon.ts` - Wires local reads, starts population only after remote verification, and drains supervised tasks on shutdown.
- `src/config/config.ts`, `main.ts` - Validate and map the optional local Blossom origin.
- `src/app.ts` - Awaits asynchronous resource disposal during shutdown.
- `tests/integration/hostile_blossom_test.ts` - Covers corruption fallback, safe diagnostics, leases, upload headers, and failure isolation.
- `tests/e2e/nix_substitution_test.ts` - Proves merged stock-Nix acceptance and local reuse with remote bytes disabled.

## Decisions Made

- Locality changes source order and private-network permission only; every byte still requires the same complete hash and size verification.
- Local corruption is diagnostic and retryable rather than a persistent quarantine, allowing a later verified remote fetch to repair the cache.
- Population begins from an independently opened verified lease, so response disposal and background upload cannot race spool deletion.
- Public HTTP handling remains GET/HEAD-only and no signer or inbound upload authorization was introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the pinned HTTP transport for streamed PUT**
- **Found during:** Task 2
- **Issue:** The existing safe transport supported only GET, so BUD-02 population could not reuse its DNS pinning and redirect policy.
- **Fix:** Added method/header/body support, retained backpressure, and rejected upload redirects rather than attempting to replay a consumed stream.
- **Files modified:** `src/network/safe_fetcher.ts`
- **Verification:** Full integration suite and `deno task verify`
- **Committed in:** `0e25ef5`

**2. [Rule 1 - Bug] Preserved configured-source compatibility during local-origin separation**
- **Found during:** Task 2 full integration verification
- **Issue:** Initially treating the preferred Blossom source as publisher trust broke its established exact configured-origin policy.
- **Fix:** Address policy now accepts the explicit finite set of configured origins while local cache remains a distinct source role.
- **Files modified:** `src/blossom/source_plan.ts`, `src/network/safe_fetcher.ts`, `src/runtime/daemon.ts`
- **Verification:** 62 integration tests pass.
- **Committed in:** `0e25ef5`

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes were required to retain the existing security boundary and compatibility while adding safe population.

## Issues Encountered

- The plan's combined Deno `--filter "local cache|local Blossom"` string matches literally rather than as a regular expression. Both focused names were run separately, followed by the complete integration and phase verification suites.

## User Setup Required

Set `NIXSTR_LOCAL_BLOSSOM_URL` to the exact HTTP(S) origin of the operator-controlled local Blossom service when read-through population is desired. Omitting it preserves existing behavior.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: outbound-upload | src/network/safe_fetcher.ts | New streamed PUT surface is limited to exact configured origins, address-pinned, bounded, and redirect-refusing. |

## Next Phase Readiness

- Verified local cache reads and immutable population are ready for Phase 3's signer-authorized inbound write work.
- No public PUT, signer construction, or publication behavior exists yet.

## Self-Check: PASSED

- All created and modified files exist.
- All six task commits exist in repository history.
- `deno task verify` passes, including 15 protocol tests, 62 integration tests, and the stock-Nix E2E.

---
*Phase: 02-deterministic-merged-read-cache*
*Completed: 2026-08-12*
