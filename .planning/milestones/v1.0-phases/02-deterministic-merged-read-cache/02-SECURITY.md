---
phase: 02-deterministic-merged-read-cache
date: 2026-08-12
verdict: secured
threats_open: 0
asvs_level: 1
---

# Phase 2 Security Review

## Scope and threat inventory

Phase 2 introduced ordered multi-publisher selection, deterministic merging, bounded source planning, and signer-overlay-compatible reads. Trust boundaries cover signed Nostr events, publisher Blossom origins, strict Narinfo metadata, and merged route selection.

## Mitigation evidence

| Threat | Disposition | Production evidence | Discriminating verification |
|---|---|---|---|
| Unauthorized or stale publisher state | closed | `src/nostr/selection.ts`, `src/persistence/state_repository.ts` validate identity and persist anti-rollback state before admission | `tests/integration/publication_selection_test.ts` |
| Cross-publisher semantic confusion | closed | `src/nix/merged_cache.ts` requires semantic agreement and strips unsupported endorsements | `tests/integration/merged_cache_test.ts` |
| Unbounded hostile fetch/traversal | closed | `src/hashtree/reader.ts` and `src/network/safe_fetcher.ts` apply byte, link, redirect, address, and deadline bounds | `tests/integration/hostile_blossom_test.ts`, `tests/integration/address_pinning_test.ts` |
| GET-only HTTP surface | superseded temporal constraint | Phase 2 intentionally exposed GET/HEAD only. Phase 3 added signer-gated PUT through the conjunctive readiness snapshot in `src/nix/http_handler.ts` and `src/runtime/daemon.ts`; it is not an accepted live vulnerability. | `tests/integration/writable_cache_test.ts`, `tests/integration/operator_config_test.ts` |

## Residual-risk register

| Risk | Severity | Disposition | Rationale | Owner / review condition |
|---|---|---|---|---|
| BUD-15 self-encrypted roots unsupported | low | accepted | v1 rejects the proposal explicitly; no downgrade or ambiguous interpretation occurs. | v2 protocol review after proposal stabilization |
| Single-user local availability depends on configured upstreams | low | accepted | Bounded fallback and typed failure preserve integrity; loss of all sources is visible as unavailable. | operator; review for shared-gateway milestone |
| Write capability absent during Phase 2 | none current | transferred | Phase 3 implemented signer-gated PUT with exact ownership, durable staging, and immutable overlay controls. | Phase 3; verified by writable-cache integration tests |

## Verification

`deno task verify` passed on 2026-08-12: formatting, lint, type checking, protocol tests, integration tests, and both stock-Nix E2Es.
