---
phase: 04-availability-gated-publication-loop
date: 2026-08-12
verdict: secured
threats_open: 0
asvs_level: 1
---

# Phase 4 Security Review

## Scope and verdict

Phase 4 introduced the replica-completeness barrier, event signing and relay acknowledgement, durable repair/refresh, local relay forwarding, diagnostics, health, and the stock-Nix publication round trip. The ASVS L1 audit closed 22 implementation threats and found one explicitly accepted low-severity diagnostic-sink availability risk. No threat at or above the configured high threshold remains open.

## Mitigation evidence

| Threat group | Status | Production evidence | Verification |
|---|---|---|---|
| False or split replica proof | closed | proof matrix plus post-upload GET/hash verification in `src/persistence/write_repository.ts` and `src/write/publication_uploader.ts` | hostile Blossom publication tests |
| Signer/event mutation and false relay acknowledgement | closed | exact template validation, local event verification, configured-relay ID/OK correlation in `src/write/publication_coordinator.ts` | publication-loop and relay suites |
| Premature promotion | closed | complete same-server proof → persist signed event → relay OK → commit → normal admission | stock-Nix publication E2E |
| Retry amplification and refresh rollback | closed | durable bounded endpoint work, capped backoff, exact-inventory refresh saga | publication-recovery suite |
| Secret-bearing or recursive diagnostics | closed | closed union and field-by-field serializer in `src/operations/diagnostics.ts` | hostile diagnostic tests |
| Work-producing health checks | closed | pure bounded projection in `src/operations/health.ts` | dependency tripwire health tests |

## Accepted risks log

| Risk | Threat ref | Severity | Rationale | Review condition |
|---|---|---:|---|---|
| Diagnostic sink failure can lose an individual non-authoritative record | T-04-03-05 | low | Sink exceptions are contained so observability cannot mutate cache/publication state or crash the daemon. Integrity state remains durable and health remains queryable. | Revisit when durable log shipping or metrics enter the operations milestone. |

## Audit trail

| Date | Registered threats | Closed/accepted | Blocking open | Result |
|---|---:|---:|---:|---|
| 2026-08-12 | 23 | 23 | 0 | secured |

`threats_open: 0` is confirmed.
