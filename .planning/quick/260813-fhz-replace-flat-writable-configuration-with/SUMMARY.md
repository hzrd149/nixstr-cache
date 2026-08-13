---
quick_id: 260813-fhz
status: complete
completed: 2026-08-13
---

# Nested writable configuration and signer-derived ownership

Replaced the flat writable settings with a closed nested contract, recursively merged `NIXSTR_WRITABLE_*` leaves, signer-derived publication identity, and durable fail-closed owner binding.

## Implemented

- Added disabled/root/named writable validation with nested signer, staging, and publication groups.
- Removed configured writable pubkeys and derive ownership from local or NIP-46 signer readiness.
- Added atomic durable repository owner binding; signer or cache-identity changes cannot relabel existing write state.
- Split repository schema opening from activation: recovery mutations and staging cleanup occur only after canonical ownership binding succeeds.
- Kept overlay loading, eligibility reconciliation, batching, publication recovery, coordinator startup, and PUT unavailable until signer readiness and repository binding both succeed.
- Added signer identity assertions before signing, after signing, before relay publication, and before accepting staged work; publication uses one immutable bound identity.
- Added identity authorization before publication and repair ticks can claim durable work, and immediately before PUT body staging.
- Made write activation transactional at the runtime boundary: provisional overlay, scheduler, reconciliation, and coordinator resources are not exposed until startup succeeds and are independently cleaned on failure.
- Effective `writable.enabled: false` environment configuration now bypasses malformed and unknown nested JSON siblings after recursive merge.
- Updated active environment examples, JSON example, README, NixOS module guidance, VM guide, and stock-Nix publication E2E configuration.

## Verification

- Focused signer/write/recovery integration after final review fixes: 16 passed.
- `deno task verify`: passed (format, lint, check, 23 protocol tests, 117 integration tests, and 2 stock-Nix E2E tests).
- Final blocker-only code review: no blocking findings.
- `git diff --check`: passed.

## Deviations

- Updated additional active tests (`publication_loop_test.ts`, `blossom_discovery_test.ts`) required by the changed types and removal of legacy read aliases already present in the shared dirty worktree.
- No commits or staging were performed, as required.

## Known Stubs

None.
