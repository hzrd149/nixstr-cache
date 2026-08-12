---
quick_id: 260812-mhi
phase: quick-milestone-integration-closure
plan: 01
status: complete
subsystem: publication-lifecycle
tags: [deno, nip46, sqlite, restart-recovery, diagnostics]
requirements-completed: [WRIT-02, WRIT-06, PUBL-01, PUBL-03, PUBL-04, OPER-02, OPER-04]
files_modified:
  - src/persistence/write_repository.ts
  - src/write/batch_scheduler.ts
  - src/write/eligibility.ts
  - src/runtime/daemon.ts
  - src/nix/http_handler.ts
  - src/operations/diagnostics.ts
  - tests/fixtures/nostr_connect.ts
  - tests/integration/nip46_signer_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/health_diagnostics_test.ts
commits: [bef5fec, 495bf94, b79030c]
completed: 2026-08-12
duration: 5min
coverage:
  - id: D1
    description: Production NIP-46 capability delegates verified remote event signing after exact ownership authorization.
    requirement: WRIT-02
    verification:
      - kind: integration
        ref: tests/integration/nip46_signer_test.ts#remote publication
        status: pass
      - kind: integration
        ref: tests/integration/publication_loop_test.ts#one complete replica publishes exact event through normal admission
        status: pass
    human_judgment: false
  - id: D2
    description: Durable dirty windows and complete staged objects autonomously resume after restart.
    requirement: PUBL-01
    verification:
      - kind: integration
        ref: tests/integration/publication_batch_test.ts#restart restores the durable quiet deadline without another dirty
        status: pass
      - kind: integration
        ref: tests/integration/writable_cache_test.ts#restart reconciliation admits complete staged content without a later write
        status: pass
    human_judgment: false
  - id: D3
    description: Staging and Hashtree build failures emit typed secret-safe diagnostics without changing authoritative behavior.
    requirement: OPER-02
    verification:
      - kind: integration
        ref: tests/integration/health_diagnostics_test.ts#staging failure diagnostic is typed secret-safe and non-authoritative
        status: pass
      - kind: integration
        ref: tests/integration/publication_batch_test.ts#batch build failure diagnostic is typed and preserves durable retry
        status: pass
    human_judgment: false
  - id: D4
    description: Both stock-Nix substitution and publication workflows remain compatible.
    requirement: OPER-04
    verification:
      - kind: e2e
        ref: deno task test:nix-e2e
        status: pass
    human_judgment: false
---

# Quick 260812-mhi: Milestone Integration Closure Summary

**Owned remote NIP-46 signing, durable restart recovery, and closed secret-safe write diagnostics now span the production daemon lifecycle.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-12T16:15:36Z
- **Completed:** 2026-08-12T16:19:51Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Retained and delegated `signEvent` on the production NIP-46 adapter while preserving exact owner and returned-event pubkey checks.
- Restored active publication timers from SQLite and subscribed before bounded startup eligibility reconciliation, dirtying each committed generation once.
- Added explicit staging/build failure diagnostic variants whose serializers expose only stable codes and bounded safe context.
- Passed the full Deno quality gate and an explicit rerun of both stock-Nix E2E workflows.

## Task Commits

1. **Task 1: Drive encrypted NIP-46 signing through production capability** — `bef5fec`
2. **Task 2: Recover durable dirty and staged work on restart** — `495bf94`
3. **Task 3: Emit typed secret-safe staging and batch diagnostics** — `b79030c`

## Decisions Made

- Subscribe to repository changes before startup reconciliation and rely on overlay/generation idempotence instead of callback timing.
- Seed the generation dedupe watermark from any active durable dirty window so restart recovery never manufactures a second dirty notification.
- Mark failed batches durably before attempting diagnostic emission; diagnostic sink failures remain non-authoritative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced obsolete Phase 3 source-text prohibition**

- **Found during:** Task 2 full focused verification
- **Issue:** A historical test prohibited any production signing/publication symbol after Phase 4 had intentionally shipped that functionality.
- **Fix:** Removed the stale source-text assertion; behavioral publication and recovery suites remain authoritative.
- **Files modified:** `tests/integration/publication_batch_test.ts`
- **Verification:** `deno task verify`
- **Commit:** `495bf94`

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** Removes a superseded test constraint without weakening behavioral coverage.

## Verification

- Focused NIP-46 remote publication test — passed.
- Focused restart suites — 5 passed.
- Focused failure diagnostic suites — 2 passed.
- `deno task verify` — 18 protocol, 93 integration, and 2 stock-Nix E2E tests passed.
- Explicit `deno task test:nix-e2e` rerun — 2 passed.

## Known Stubs

None.

## Threat Flags

None beyond the plan threat register. New network signing behavior retains NIP-44 transport, exact ownership checks, and local returned-event validation; diagnostics use closed field allow-lists.

## Self-Check: PASSED

- All listed source and test files exist.
- Task commits `bef5fec`, `495bf94`, and `b79030c` exist.
- Focused, full verification, and explicit E2E commands passed.
- Existing untracked research-cache files remained untouched.
