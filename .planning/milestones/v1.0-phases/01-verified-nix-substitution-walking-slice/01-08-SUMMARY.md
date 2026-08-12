---
phase: 01-verified-nix-substitution-walking-slice
plan: 08
subsystem: hostile-network-transport
tags: [ssrf, ipv6, http-framing, streaming, deadlines, cleanup]
status: complete
requires:
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 01
    provides: exact-peer pinned HTTP transport and redirect revalidation
  - phase: 01-verified-nix-substitution-walking-slice
    plan: 03
    provides: hash-verified Blossom spooling and quarantine classification
provides:
  - Lifecycle-bound total and idle response-body deadlines
  - Strict Content-Length and incremental chunked HTTP/1.1 framing
  - Canonical byte-based IPv4 and IPv6 CIDR enforcement
  - Exceptional spool cancellation and deterministic partial-file cleanup
affects: [blossom-resolution, nix-http-serving, hostile-network-controls]
tech-stack:
  added: []
  patterns: [canonical-address-policy, lifecycle-owned-stream, strict-http-framing, cancel-before-release]
key-files:
  created: []
  modified:
    - src/network/safe_fetcher.ts
    - src/blossom/blob_fetcher.ts
    - tests/integration/address_pinning_test.ts
    - tests/integration/hostile_blossom_test.ts
key-decisions:
  - "Require exactly one valid Content-Length or exactly one chunked transfer coding before exposing a response body."
  - "Normalize IPv4-mapped IPv6 to IPv4 bytes before applying the forbidden CIDR policy."
  - "Keep the socket and abort listener owned by the returned stream until close, cancel, or error."
requirements-completed: [TREE-03, TREE-05]
duration: 4 min
completed: 2026-08-12
---

# Phase 1 Plan 8: Hostile Transport Gap Closure Summary

Canonical address parsing, lifecycle deadlines, strict decoded HTTP framing, and cancellation-first spool cleanup close the remaining hostile transport bypasses.

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-12T12:23:40Z
- **Completed:** 2026-08-12T12:27:44Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Kept the total request deadline and resetting body-idle deadline active through response EOF, cancellation, or error while retaining socket ownership and backpressure.
- Rejected ambiguous or unsupported HTTP response framing and incrementally decoded valid chunked bodies before hashing and spooling.
- Replaced textual prefix checks with strict IPv4/IPv6 parsing and explicit CIDR matching, including expanded and IPv4-mapped IPv6 representations.
- Cancelled response readers on every exceptional spool read before releasing the lock and deterministically removed partial owner-only files without misclassifying failures as hash quarantine events.

## Task Commits

1. **Task 1:** `7e8e029` — response lifecycle deadlines, strict framing, and exceptional spool cleanup
2. **Task 2:** `f5d2628` — canonical IP parsing and forbidden CIDR enforcement

## Decisions Made

- Responses without a single unambiguous supported framing mode fail closed; connection-close delimiting is not accepted for publisher-controlled bodies.
- Chunk extensions are bounded as part of the size line, trailers are bounded and syntactically validated, and framing-defining trailer fields are forbidden.
- Configured local-network authorization remains restricted to an exact origin match; all publisher and redirect answer sets reject if any answer is forbidden or malformed.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

No security-relevant surface outside the plan threat model was introduced. The modified network, socket, and spool trust boundaries correspond directly to T-01-08-01 through T-01-08-04.

## Verification

- `deno task fmt` — passed, 26 files checked
- `deno task lint` — passed, 22 files checked
- `deno task check` — passed for main, protocol, integration, and E2E modules
- `deno task test:address-pinning` — 9 passed, 0 failed
- full hostile Blossom integration suite — 11 passed, 0 failed
- hostile deadline/chunked/cancel filter — 4 passed, 0 failed

## Next Phase Readiness

- Address pinning, body deadlines, HTTP framing, and spool cleanup now satisfy the Phase 1 hostile-transport verification gaps.
- Plan 01-09 can complete the remaining resource-budget and cache-snapshot gap closure without relying on permissive transport behavior.

## Self-Check: PASSED

- All four declared modified files exist.
- Task commits `7e8e029` and `f5d2628` exist in repository history.
- Every task and plan-level verification command passes.
