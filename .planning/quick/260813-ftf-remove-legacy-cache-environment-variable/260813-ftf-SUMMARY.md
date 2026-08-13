---
quick_id: 260813-ftf
status: complete
subsystem: configuration
tags: [configuration, environment, cleanup]
key_files:
  modified:
    - main.ts
    - src/config/config.ts
    - tests/integration/operator_config_test.ts
    - tests/integration/http_cache_test.ts
    - tests/integration/address_pinning_test.ts
    - tests/e2e/nix_substitution_test.ts
    - tests/e2e/nix_publication_roundtrip_test.ts
    - README.md
    - .env.example
    - nix/module.nix
    - nix/example-vm.nix
    - nix/VM-EXAMPLE.md
completed: 2026-08-13
---

# Quick Task 260813-ftf Summary

Made `caches` and `NIXSTR_CACHES` the only operator-facing read-cache inputs.

## Implementation

- Removed `RawConfig.publisherPubkeys` and its implicit default-cache fallback.
- Removed collection and mapping of `NIXSTR_PUBLISHER_PUBKEYS` and
  `NIXSTR_CACHE_IDENTITIES`.
- Removed the `publisherPubkeys` JSON input; derived publisher filters remain
  internal to `ValidatedConfig`.
- Updated configuration, integration, E2E, environment-template, README, and
  Nix deployment usage to `NIXSTR_CACHES`.
- Added regressions proving the removed JSON and environment inputs are not
  accepted.

## Verification

- Focused operator configuration suite: 23 passed, 0 failed.
- Targeted lint and type checking: passed.
- `git diff --check`: passed.

Repository-wide verification remains blocked by unrelated concurrent
writable-configuration work noted in quick task 260813-frn.

## Deviations from Plan

No commit was created because the shared worktree contains multiple in-progress
configuration changes.

## Self-Check: PASSED

Only `caches`/`NIXSTR_CACHES` now reaches read-cache configuration.
