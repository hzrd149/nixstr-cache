---
phase: 03-signer-gated-writable-cache
date: 2026-08-12
verdict: secured
threats_open: 0
asvs_level: 1
---

# Phase 3 Security Review

## Scope and threat inventory

Phase 3 added protected signer activation, signer-gated PUT, bounded durable staging, dependency-closed eligibility, immutable overlay generations, and canonical pending-candidate construction. Boundaries include protected signer material, hostile HTTP bodies, staging-to-content-addressed promotion, SQLite frozen batches, and authenticated tree bytes.

## Mitigation evidence

| Threat | Disposition | Production evidence | Discriminating verification |
|---|---|---|---|
| Signer spoofing or premature PUT | closed | `src/signer/capability.ts` checks exact ownership; `src/runtime/daemon.ts` and `src/nix/http_handler.ts` require one conjunctive signer/repository/relay/destination snapshot | `tests/integration/nip46_signer_test.ts`, `tests/integration/operator_config_test.ts` |
| Partial or overwritten staging content | closed | `src/persistence/write_repository.ts` streams to an owner-only temp inode, syncs it, then uses same-filesystem atomic create-new hard-link promotion before SQLite admission | `tests/integration/writable_cache_test.ts` atomic promotion and immutable-conflict tests |
| Aggregate staging oversubscription | closed for integrity; availability tradeoff accepted | SQLite reserves the full per-body ceiling transactionally before file creation and releases it on every terminal path | `tests/integration/writable_cache_test.ts` concurrent ceiling and cleanup coverage |
| Full frozen-batch/trie/inventory materialization | closed | `WriteRepository.publicationBatchFiles` exposes ordered single-pass SQLite iteration; `PublicationBatchScheduler` forwards it directly with cancellation; `src/hashtree/writer.ts` persists route nodes, intermediate link runs, and deduplicated inventory in SQLite and folds only one `maxLinks` group at a time | `tests/integration/publication_batch_test.ts` “streams frozen batch”; `tests/protocol/hashtree_writer_test.ts` “durable directory runs keep link working set independent of route count” proves a three-link working set across 150 routes |
| Canonical tree drift | closed | `src/hashtree/writer.ts` fixes chunking/grouping and enforces entry/route/depth/inventory bounds while durable page/run boundaries preserve identical roots | `tests/protocol/hashtree_writer_test.ts` bounded iteration, literal pinned canonical boundary hashes, repeat-build and COW tests |
| No signing/replication/relay promotion in Phase 3 | superseded temporal constraint | Phase 4 implemented availability-gated publication: same-server inventory proof, locally verified signed event, exact configured-relay OK, durable commit/admission, and repair in `src/write/publication_coordinator.ts`. It is not an unresolved defect. | `tests/integration/publication_loop_test.ts`, `tests/integration/publication_recovery_test.ts`, `tests/e2e/nix_publication_roundtrip_test.ts` |

## Residual-risk register

| Risk | Severity | Disposition | Rationale | Owner / review condition |
|---|---|---|---|---|
| Full-per-body reservation rejects some otherwise safe concurrent uploads | low | accepted | This conservative availability tradeoff prevents aggregate oversubscription and affects neither integrity nor confidentiality. | operator; revisit only with measured concurrency pressure |
| Raw local-key bytes exist in process memory while enabled | low | accepted | Owner-only source permissions, narrow lifetime, buffer zeroing where owned, and secret-safe state reduce likelihood; v1 does not claim hardware isolation. | signer subsystem; review if multi-user/hardware-backed keys enter scope |
| Coarse eligibility diagnostics in original Phase 3 | low | transferred | Phase 4 operational diagnostics provide closed typed allow-listed records without secret-bearing errors. | Phase 4; verified by `tests/integration/health_diagnostics_test.ts` |
| BUD proposals may change | low | accepted | Canonical literal boundary vectors and strict decoders make drift visible; dependency revisions remain pinned. | protocol owner; review on upstream proposal revision |

## Verification

Focused bounded iteration, canonical boundary, and atomic promotion tests passed. `deno task verify` passed on 2026-08-12 across formatting, lint, type checking, protocol, integration, and both stock-Nix E2E workflows.
