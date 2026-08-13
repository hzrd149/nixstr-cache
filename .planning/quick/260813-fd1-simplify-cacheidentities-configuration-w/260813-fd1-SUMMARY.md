---
quick_id: 260813-fd1
status: complete
subsystem: configuration
tags: [nostr, nip19, configuration, identity]
key_files:
  modified:
    - src/config/config.ts
    - tests/integration/operator_config_test.ts
    - config.example.json
    - .env.example
    - README.md
    - nix/module.nix
    - nix/example-vm.nix
    - nix/VM-EXAMPLE.md
completed: 2026-08-13
---

# Quick Task 260813-fd1 Summary

Expanded read-side cache identity configuration to accept bare lowercase hex
pubkeys, npub values, canonical identities, and kind-37091 naddr values while
keeping canonical identities throughout the daemon.

## Implementation

- Added NIP-19 decoding at the configuration boundary and normalized accepted
  inputs before duplicate detection, ordered identity output, and publisher
  derivation.
- Reused strict canonical name validation for decoded naddr identifiers and
  ignored embedded relay hints.
- Preserved the hex-only legacy publisher fallback and strict canonical
  writable identity parser.
- Added integration coverage for all accepted forms, JSON/environment parity,
  priority order, alias duplicates, malformed and unsupported inputs, naddr
  constraints, relay authority, maximum count, side-effect safety, and writable
  regressions.
- Updated JSON, environment, README, and Nix deployment examples to prefer the
  shorter forms.

## Verification

- Focused operator configuration suite: 23 passed, 0 failed.
- `deno fmt`, `deno lint`, and `deno check`: passed.
- `deno task verify`: passed (23 protocol, 108 integration, and 2 stock-Nix
  end-to-end tests; 0 failures).
- `git diff --check`: passed.

## Deviations from Plan

No commit was created because the worktree contains the user's existing
uncommitted JSON-configuration implementation, which this task intentionally
extends and must not split or capture without explicit authorization.

## Self-Check: PASSED

All planned behavior, documentation, and regression coverage are present.
