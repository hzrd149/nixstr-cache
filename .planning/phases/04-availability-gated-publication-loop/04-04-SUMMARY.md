---
phase: 04-availability-gated-publication-loop
plan: 04
subsystem: testing
tags: [nix, e2e, blossom, nostr, streaming, backpressure]
requires:
  - phase: 04-availability-gated-publication-loop
    plans: [01, 02, 03]
    provides: availability-gated saga, repair, promotion, diagnostics, and health
provides:
  - Stock Nix upload through production signing, publication, promotion, and published-root substitution
  - Hostile Blossom possession and bounded-stream fixture matrix
  - Exact NIP-01 relay acknowledgement and local relay forwarding matrix
affects: [milestone-verification, release-readiness]
tech-stack:
  added: []
  patterns: [ephemeral owner-only keys, source-store destruction, programmable hostile loopback peers]
key-files:
  created: [tests/fixtures/publication.ts, tests/e2e/nix_publication_roundtrip_test.ts, tests/integration/blossom_publication_test.ts, tests/integration/relay_publication_test.ts]
  modified: [deno.json, src/nix/http_handler.ts, src/nostr/selection.ts]
key-decisions:
  - "An empty write-ready cache returns 404 for stock Nix destination probes so upload can begin; read-only empty caches remain 503 unavailable."
  - "Long publication-expiration timers clamp to the signed 32-bit timer ceiling and recompute on wake."
patterns-established:
  - "Publication E2E acceptance waits for the exact newly signed event and root, destroys the source store, and restores into a fresh destination with fallback disabled."
requirements-completed: [PUBL-03, PUBL-04, PUBL-05, PUBL-06, PUBL-07, OPER-02, OPER-03, OPER-04]
coverage:
  - id: D1
    description: "Stock Nix uploads to the production daemon and substitutes solely from its newly signed promoted root after source destruction."
    requirement: PUBL-07
    verification:
      - kind: e2e
        ref: "tests/e2e/nix_publication_roundtrip_test.ts#stock Nix uploads through production and substitutes from the newly published root"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hostile Blossom descriptors, truncated proofs, false possession, backpressure, and concurrency ceilings cannot weaken the complete-replica barrier."
    requirement: PUBL-03
    verification:
      - kind: integration
        ref: "tests/integration/blossom_publication_test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Relay acknowledgements are correlated to the exact event id while foreign, false, absent, and duplicate frames remain safe."
    requirement: PUBL-04
    verification:
      - kind: integration
        ref: "tests/integration/relay_publication_test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The full narrow-permission repository acceptance matrix remains green."
    requirement: OPER-04
    verification:
      - kind: other
        ref: "deno task verify && deno task test:nix-e2e"
        status: pass
    human_judgment: false
duration: 11min
completed: 2026-08-12
status: complete
---

# Phase 4 Plan 4: Publication Acceptance Matrix Summary

**A fresh stock Nix object now traverses production PUT staging, immutable Hashtree construction, complete Blossom proof, Nostr signing and acknowledgement, normal promotion, source destruction, and sole-substituter restoration.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-12T15:53:59Z
- **Completed:** 2026-08-12T16:05:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added an owner-only, ephemeral-key stock Nix upload/publication/substitution E2E through production `main.ts`, with source-store removal and a fresh destination store.
- Added programmable Blossom and minimal NIP-01 relay peers covering false possession, descriptor mismatch, truncation, streamed backpressure, concurrency, and exact acknowledgement correlation.
- Preserved the existing substitution lane and passed formatting, lint, typechecking, 18 protocol tests, 89 integration tests, and both stock Nix workflows under narrow permissions.

## Task Commits

1. **Task 1 RED: Stock Nix publication roundtrip** - `dd6301d` (test)
2. **Task 1 GREEN: Production publication and restore** - `e5982d6` (feat)
3. **Task 2 RED: Hostile publication matrix** - `9953f8e` (test)
4. **Task 2 GREEN: Hostile fixtures and assertions** - `1f79a41` (test)
5. **Task 3: Unchanged acceptance matrix** - `08d2c29` (chore)

## Files Created/Modified

- `tests/fixtures/publication.ts` - Reusable success and hostile Blossom/relay controls with public-only captures.
- `tests/e2e/nix_publication_roundtrip_test.ts` - Fresh upload-to-new-root-to-restore proof and read-only Nix-store cleanup.
- `tests/integration/blossom_publication_test.ts` - Complete-replica integrity and bounded streaming assertions.
- `tests/integration/relay_publication_test.ts` - Exact acknowledgement and verified local-cache forwarding assertions.
- `src/nix/http_handler.ts` - Correct writable empty-cache destination-probe semantics.
- `src/nostr/selection.ts` - Safe scheduling for expiration delays beyond the JavaScript timer ceiling.
- `deno.json` - Both stock Nix workflows in the existing E2E lane.

## Decisions Made

- A write-ready empty cache reports route absence to stock Nix while retaining fail-closed unavailability for read-only empty caches.
- E2E teardown recursively restores owner permissions before deleting isolated Nix roots, preventing read-only store residue and temporary-filesystem leaks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Allowed stock Nix destination probes against an empty writable cache**
- **Found during:** Task 1
- **Issue:** The production handler returned 503 before stock Nix could issue its first PUT.
- **Fix:** Return 404 for absent routes only while the configured write capability is ready.
- **Files modified:** `src/nix/http_handler.ts`
- **Verification:** Real stock Nix roundtrip and full HTTP integration suite pass.
- **Committed in:** `e5982d6`

**2. [Rule 1 - Bug] Prevented 30-day expiration timer overflow**
- **Found during:** Task 1
- **Issue:** A 30-day expiry exceeded the runtime's signed 32-bit timer range and was coerced to 1ms.
- **Fix:** Clamp the delay to the timer ceiling; selection recomputes and schedules the remainder when it wakes.
- **Files modified:** `src/nostr/selection.ts`
- **Verification:** E2E completes without timer overflow and selection integration tests pass.
- **Committed in:** `e5982d6`

**3. [Rule 3 - Blocking] Made fixture factories lint-clean**
- **Found during:** Task 3
- **Issue:** The unchanged verification command rejected synchronous fixture factories declared `async`.
- **Fix:** Removed the unnecessary `async` declarations.
- **Files modified:** `tests/fixtures/publication.ts`
- **Verification:** `deno task verify && deno task test:nix-e2e` passes.
- **Committed in:** `08d2c29`

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 3).
**Impact on plan:** The fixes are required for real stock Nix interoperability and bounded production scheduling; no unrelated scope was added.

## Issues Encountered

Nix creates read-only store paths in isolated roots. Teardown now recursively restores owner permissions before deletion, so successful or failed E2E runs leave no tmpfs residue.

## Known Stubs

None.

## Threat Flags

None. The loopback HTTP/WebSocket surfaces and ephemeral key handling are explicitly covered by the plan threat model.

## User Setup Required

None.

## Verification

- `deno task verify` — formatting, lint, check, 18 protocol tests, 89 integration tests, and 2 stock Nix E2E tests passed.
- `deno task test:nix-e2e` — both stock Nix tests passed again explicitly.

## Next Phase Readiness

Phase 4 and the v1 implementation acceptance matrix are complete with no blockers.

## Self-Check: PASSED

- All seven key files exist.
- All five task commits exist in git history.
- No stubs, skipped tests, or unrun verification steps remain.

---
*Phase: 04-availability-gated-publication-loop*
*Completed: 2026-08-12*
