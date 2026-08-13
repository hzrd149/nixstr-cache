---
status: resolved
trigger: "User reports write readiness remains no_blossom_destination after signer activation. Prior investigation established production relay and selector authorization freeze, coupled BUD-03 lookup, wrong upload trust, unrelated readiness destinations, dropped base paths, and absent diagnostics."
created: 2026-08-13
updated: 2026-08-13
---

# Write readiness remains no_blossom_destination

## Symptoms

- Expected: Activating an authorized signer discovers that signer's BUD-03 Blossom destinations and makes writing ready when a valid destination exists.
- Actual: Write readiness remains `no_blossom_destination` after signer activation.
- Reproduction: Start with read publishers configured, then activate a signer whose pubkey is not among those publishers.

## Current Focus

- hypothesis: Runtime discovery and write destination state are incorrectly derived from the immutable read-publisher selection path rather than the active signer identity.
- test: Trace signer activation, relay filters, BUD-03 selection, upload trust, URL construction, readiness, health, and diagnostics.
- expecting: Signer identity must independently drive dynamic BUD-03 discovery and write-only destination state.
- next_action: Resolution verified; no further action.

## Evidence

- timestamp: 2026-08-13T00:00:00Z
  observation: Prior investigation identified six coupled defects in signer destination discovery and reporting.
  implication: The smallest coherent fix must separate read publisher destinations from signer-owned write destinations end to end.
- timestamp: 2026-08-13T14:35:25Z
  observation: Dynamic signer BUD-03 authorization/following, signer-only readiness state, publisher trust, and base-path-safe upload URLs pass focused, type, lint, and end-to-end tests.
  implication: Write readiness now follows the active signer rather than unrelated selected read publishers.

## Eliminated

## Resolution

- root_cause: Signer-owned BUD-03 discovery was frozen behind startup read-publisher filters and selected publications, while readiness and upload handling reused unrelated read destinations, configured trust, and origin-only URLs.
- fix: Added dynamic signer kind-10063 following, signer publication authorization, and independent reactive write-server state; readiness/health now use one normalized signer destination list; uploads preserve base paths and select publisher/configured trust correctly; sanitized effective server-list transitions include endpoints.
- verification: `deno task verify` passes: formatting, lint, type checks, 23 protocol tests, 128 integration tests, and both stock-Nix end-to-end tests. Focused discovery, upload, publication-loop, diagnostics, and NIP-46 tests also pass.
- files_changed: `src/nostr/selection.ts`, `src/runtime/daemon.ts`, `src/blossom/publication_uploader.ts`, `src/operations/diagnostics.ts`, `tests/integration/blossom_discovery_test.ts`, `tests/integration/blossom_publication_test.ts`, `tests/integration/health_diagnostics_test.ts`

## Prevention

- why_not_caught: No production-path test covered a signer pubkey outside the configured read-publisher set together with BUD-03-only write destinations.
- guard: Regression tests now independently exercise signer server-list authorization/change notification, first-publication admission, diagnostic URL redaction, and base-path/publisher-trust upload construction; existing NIP-46 and full publication E2E verify write activation.
