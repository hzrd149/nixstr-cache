---
quick_id: 260812-kuw
status: complete
subsystem: signer-lifecycle
tags: [deno, nip46, nostr, websocket, integration-test]
files_modified:
  - tests/fixtures/nostr_connect.ts
  - tests/integration/nip46_signer_test.ts
commits:
  - 8f9561f
  - 1209236
completed: 2026-08-12
---

# Deterministic production NIP-46 lifecycle verification

A bounded in-process NIP-01 relay now drives the shipped Applesauce
`NostrConnectSigner` and `RelayPool` boundary with verified kind-24133 events and
real NIP-44 encryption. Production-launch integration coverage proves default
and named owner readiness, exact ownership gating, fail-closed remote failures,
pre-ready PUT denial, staging isolation, idempotent shutdown, socket release,
and secret-safe diagnostics without external network access.

## Verification

- Focused NIP-46 test — 2 passed
- Format, lint, and type checks for both changed files — passed
- `deno task test:integration` — 74 passed
- `deno task verify` — protocol and integration gates passed; the unrelated
  stock-Nix E2E test then failed initializing its temporary SQLite store with a
  disk I/O error. Recorded in `.planning/WINDOWS.md` as an unrun full-verify item.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Coordinated authorization completion explicitly**

- **Found during:** Task 1 GREEN implementation
- **Issue:** Back-to-back auth URL and completion responses could race the
  client's asynchronous headless authorization callback.
- **Fix:** The fixture retains the pending request and the test completes it only
  after observing the sanitized production authorization notice.
- **Files modified:** `tests/fixtures/nostr_connect.ts`,
  `tests/integration/nip46_signer_test.ts`
- **Commit:** `1209236`

## Known Stubs

None.

## Threat Flags

None. The new server is a loopback-only test fixture with bounded lifecycle.

## Self-Check: PASSED

- Both changed test files exist.
- TDD RED commit `8f9561f` and GREEN commit `1209236` exist.
- Focused and full integration verification passed.
- Existing untracked `03-VERIFICATION.md` remained untouched.
