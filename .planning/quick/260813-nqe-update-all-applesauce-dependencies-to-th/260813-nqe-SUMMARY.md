---
quick_id: 260813-nqe
status: complete
subsystem: dependencies
tags: [deno, applesauce, nostr-tools]
key-files:
  modified: [deno.json, deno.lock]
commit: 0de0416
completed: 2026-08-13
---

# Quick Task 260813-nqe Summary

Pinned all five direct Applesauce packages to the coordinated `0.0.0-next-20260813160224` build and aligned the direct `nostr-tools` dependency to compatible version `2.24.1`.

## Changes

- Updated `applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay`, and `applesauce-signers` to the exact requested prerelease.
- Updated `nostr-tools` from `2.19.4` to `2.24.1` to prevent duplicate branded `VerifiedEvent` types.
- Regenerated `deno.lock` from the manifest. The just-published prerelease required a one-time resolution with `--minimum-dependency-age=0`; no repository policy was changed.

## Verification

- `deno task check` — passed.
- `deno task verify` — passed: formatting, lint, type checking, 23 protocol tests, 134 integration tests, and 2 stock-Nix E2E tests.
- Exact manifest pin assertion — passed.
- Lockfile stale-version scan — passed.
- `git diff --check` — passed.

## Deviations from Plan

The original five-package update exposed incompatible `nostr-tools` branded event types because the alpha graph uses `2.24.1` while the project directly pinned `2.19.4`. After explicit user authorization, the direct pin was aligned to `2.24.1`. No source changes were required.

## Self-Check: PASSED

- Dependency changes are committed atomically in `0de0416`.
- Commit contains only `deno.json` and `deno.lock`.
- Planning artifacts remain uncommitted for the orchestrator.
