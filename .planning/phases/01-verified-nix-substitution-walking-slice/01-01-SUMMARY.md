---
phase: 01-verified-nix-substitution-walking-slice
plan: 01
subsystem: network-safety
tags: [deno, ssrf, dns-pinning, tls, configuration]
status: complete
requires: []
provides:
  - Side-effect-free aggregate daemon configuration validation with compiled resource ceilings
  - Address-pinned HTTP and HTTPS transport preserving logical Host and TLS certificate identity
  - Redirect-by-redirect DNS resolution and network policy enforcement
affects: [01-02, 01-03, blossom-client, daemon-startup]
tech-stack:
  added:
    - Deno low-level TCP and TLS socket transport
    - Exact approved Phase 1 dependency pins and lockfile
  patterns:
    - Validate all configuration before side effects
    - Resolve, classify, and bind the selected address before every connection
    - Preserve logical hostname independently from the connected peer address
key-files:
  created:
    - deno.lock
    - src/config/config.ts
    - src/network/safe_fetcher.ts
    - tests/integration/address_pinning_test.ts
  modified:
    - deno.json
key-decisions:
  - "Use Deno.connect to bind the approved IP and Deno.startTls with the URL hostname for SNI and certificate validation."
  - "Grant private-address access only when configured trust exactly matches the environment-authorized Blossom origin."
  - "Reject a publisher DNS answer set when any answer is forbidden rather than selecting only a public member."
requirements-completed: [TREE-03, OPER-01]
coverage:
  - deliverable: Address-pinned HTTP and HTTPS transport
    verification:
      - kind: test
        ref: tests/integration/address_pinning_test.ts#HTTP-transport-connects-to-approved-peer-and-preserves-Host
        status: pass
      - kind: test
        ref: tests/integration/address_pinning_test.ts#HTTPS-pins-peer-while-certificate-identity-remains-hostname
        status: pass
    human_judgment: false
  - deliverable: Redirect, rebinding, mixed-answer, and configured-origin policy
    verification:
      - kind: test
        ref: tests/integration/address_pinning_test.ts#redirects-are-re-approved-and-rebinding-cannot-change-peer
        status: pass
      - kind: test
        ref: tests/integration/address_pinning_test.ts#publisher-policy-rejects-forbidden-and-mixed-DNS-answers
        status: pass
    human_judgment: false
  - deliverable: Aggregate configuration validation with no side effects
    verification:
      - kind: test
        ref: tests/integration/address_pinning_test.ts#configuration-aggregates-diagnostics-without-performing-I-O
        status: pass
    human_judgment: false
duration: 25 min
completed: 2026-08-12
---

# Phase 1 Plan 1: Address-Pinned Network Foundation Summary

Low-level Deno TCP/TLS transport closes the DNS approval-to-connection gap while aggregate configuration validation prevents invalid startup side effects.

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-12T10:18:00Z
- **Completed:** 2026-08-12T10:43:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added a side-effect-free configuration parser that reports all diagnostics together and enforces nonzero defaults plus compiled ceilings for every Phase 1 resource bound.
- Implemented a publisher-safe address policy that rejects forbidden or mixed DNS answers while narrowly authorizing the exact environment-configured Blossom origin.
- Implemented streaming HTTP/1.1 over an exact approved TCP peer, upgrading that socket with the logical URL hostname for HTTPS SNI and certificate verification.
- Added manual redirect handling with fresh resolution, classification, address pinning, explicit deadlines, and response-body cancellation on every hop.
- Locked the exact approved dependency graph and proved the network boundary with six deterministic integration tests.

## Task Commits

1. **Task 2 RED: Failing address-pinning integration suite** - `325e97d`
2. **Task 2 GREEN: Configuration and safe pinned transport** - `d663b25`

Task 1 was a blocking package-legitimacy approval checkpoint and intentionally produced no repository commit.

## Files Created/Modified

- `deno.json` - Exact dependency pins, narrow test tasks, and code-focused formatter scope.
- `deno.lock` - Reproducible exact dependency resolution.
- `src/config/config.ts` - Raw/validated configuration types, aggregate diagnostics, defaults, and hard ceilings.
- `src/network/safe_fetcher.ts` - Address classification, exact-peer socket transport, TLS hostname preservation, redirects, deadlines, and cancellation.
- `tests/integration/address_pinning_test.ts` - Controlled HTTP/TLS fixtures plus hostile DNS, redirect, rebinding, and invalid-config cases.

## Decisions Made

- Connect to the approved literal IP first, then call `Deno.startTls` with the logical hostname; this keeps DNS out of the connection path while retaining SNI and certificate validation.
- Treat the entire publisher DNS answer set as hostile if any member is forbidden, preventing address-selection ambiguity and mixed-answer bypasses.
- Scope configured private-network authorization to an exact origin match, including scheme and port.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced invalid TLS test leaf**
- **Found during:** Task 2 GREEN verification
- **Issue:** The first self-signed fixture was marked as a CA and rustls correctly rejected it as an end-entity certificate.
- **Fix:** Used a dedicated test CA and a CA-signed `CA:false` server leaf for `pinned.test`.
- **Files modified:** `tests/integration/address_pinning_test.ts`
- **Verification:** HTTPS address-pinning integration test passes with hostname validation enabled.
- **Commit:** `d663b25`

**2. [Rule 3 - Blocking] Scoped formatter away from generated planning artifacts**
- **Found during:** Plan-level verification
- **Issue:** `deno fmt --check` included pre-existing generated `.planning` documents and failed on 42 unrelated files.
- **Fix:** Added formatter exclusions for planning/protocol instruction documents so the mandated gate checks executable and test sources.
- **Files modified:** `deno.json`
- **Verification:** `deno fmt --check`, `deno lint`, and targeted `deno check` all pass.
- **Commit:** `d663b25`

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking issue). **Impact:** Both changes strengthen verification without altering the planned production architecture.

## Authentication Gates

None.

## Known Stubs

None.

## Issues Encountered

None.

## Verification

- `deno fmt --check` — passed
- `deno lint` — passed
- `deno check src/config/config.ts src/network/safe_fetcher.ts` — passed
- `deno test --allow-net=127.0.0.1 --allow-read --allow-write tests/integration/address_pinning_test.ts` — 6 passed, 0 failed
- Human tracer review — approved

## Next Phase Readiness

- The verified `SafeFetcher`/`PinnedTransport` boundary is ready for publication selection and Blossom blob retrieval plans.
- The local runtime is Deno 2.9.4 while the project target is 2.9.5; CI/deployment pinning remains a phase-level concern but does not invalidate the demonstrated Deno 2.9 socket API contract.

## Self-Check: PASSED

- All four declared created files exist.
- Task commits `325e97d` and `d663b25` exist in repository history.
- All task acceptance evidence and plan-level verification commands pass.
