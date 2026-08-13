---
phase: 01-verified-nix-substitution-walking-slice
date: 2026-08-12
verdict: secured
threats_open: 0
asvs_level: 1
---

# Phase 1 Security Review

## Scope and verdict

Phase 1 introduced the hostile network, signed-event, persistent selection, strict protocol, bounded Hashtree, and stock-Nix HTTP boundaries. The ASVS L1 audit verified all implementation mitigations. The only initially open items were explicit `accept` dispositions that required this durable risk log; none represents an unmitigated high-severity production threat.

## Mitigation evidence

| Threat group | Status | Production evidence | Verification |
|---|---|---|---|
| SSRF, rebinding, redirects, deadlines, and framing | closed | `src/network/safe_fetcher.ts`, `src/blossom/blob_fetcher.ts` | `tests/integration/address_pinning_test.ts`, `tests/integration/hostile_blossom_test.ts` |
| Event authenticity, anti-rollback, downgrade, and plaintext-only roots | closed | `src/protocol/publication.ts`, `src/persistence/state_repository.ts`, `src/nostr/selection.ts` | protocol and publication-selection suites |
| Bounded lazy tree traversal and streamed serving | closed | `src/hashtree/reader.ts`, `src/nix/http_handler.ts` | hostile-Blossom and HTTP-cache suites |
| Exact Narinfo signatures and immutable request snapshots | closed | `src/protocol/narinfo.ts`, `src/nix/http_handler.ts` | Narinfo protocol and HTTP integration suites |
| Dependency/fixture integrity and real-client provenance | closed | exact `deno.json` pins, `deno.lock`, fixture provenance documents | protocol vectors and stock-Nix E2E |

## Accepted risks log

| Risk | Threat refs | Severity | Rationale | Review condition |
|---|---|---:|---|---|
| Phase 1 error mapping was less detailed than final operations telemetry | T-01-15 | low | Deterministic statuses and rejection diagnostics preserved safety; Phase 4 now supplies typed allow-listed operational diagnostics. | Reopen only if new error classes bypass Phase 4 diagnostics. |
| Documentation-only verification plan changed no runtime authority | T-01-22, T-01-SC (01-06) | low/high administrative | The accepted disposition records that no dependency install or authority change occurred; committed lockfile and diff history provide evidence. | Reopen if verification tooling mutates dependencies or runtime code. |
| Initial signer config carried only public intent | T-01-11-04 | low | Phase 1 introduced no secret field; Phase 3 protected key/session sources and gates readiness by exact ownership. | Reopen for any new secret-bearing configuration field. |

## Audit trail

| Date | Registered threats | Blocking open | Result |
|---|---:|---:|---|
| 2026-08-12 | 53 | 0 | secured |

The accepted entries above close the documentation dispositions. `threats_open: 0` is confirmed.
