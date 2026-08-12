---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 2
current_phase_name: Deterministic Merged Read Cache
status: planning
stopped_at: Completed 01-11-PLAN.md
last_updated: "2026-08-12T13:24:23.118Z"
last_activity: 2026-08-12
last_activity_desc: Phase 01 complete, transitioned to Phase 2
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 11
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-12)

**Core value:** An unmodified Nix client can reliably read and publish a decentralized binary cache while preserving NIP.md trust, integrity, freshness, and bounded-resource guarantees.
**Current focus:** Phase 01 — verified-nix-substitution-walking-slice

## Current Position

Phase: 2 — Deterministic Merged Read Cache
Plan: Not started
Status: Ready to plan
Last activity: 2026-08-12 — Phase 01 complete, transitioned to Phase 2

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 11
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 11 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 25 min | 2 tasks | 5 files |
| Phase 01 P02 | 20 min | 2 tasks | 8 files |
| Phase 01 P03 | 8 min | 3 tasks | 8 files |
| Phase 01 P04 | 14 min | 3 tasks | 8 files |
| Phase 01 P05 | 6 min | 2 tasks | 5 files |
| Phase 01 P06 | 3 min | 2 tasks | 2 files |
| Phase 01 P08 | 4 min | 2 tasks | 4 files |
| Phase 01 P09 | 7 min | 2 tasks | 7 files |
| Phase 01 P07 | 18 min | 3 tasks | 11 files |
| Phase 01 P10 | 8 min | 3 tasks | 5 files |
| Phase 01 P11 | 3min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

- [Roadmap]: Use four coarse vertical MVP phases rather than the research summary's horizontal subsystem sequence.
- [Phase 1]: The first real-Nix read slice includes strict protocol validation, rollback protection, hostile-network controls, verified streaming, and bounded traversal.
- [v2]: BUD-15 self-encryption and production-grade operational hardening remain out of scope.
- [Phase 01]: Use Deno.connect to bind the approved IP and Deno.startTls with the URL hostname for SNI and certificate validation. — Closes DNS TOCTOU without weakening TLS hostname verification.
- [Phase ?]: Use NIP-01 lowest-id equal-timestamp ordering and persist the full selection tuple.
- [Phase ?]: Use node:sqlite and private RxJS admission to preserve the narrow no-environment permission contract.
- [Phase ?]: Reject non-canonical MessagePack before using authenticated Hashtree data.
- [Phase ?]: Quarantine canonical origins only for complete SHA-256 mismatches.
- [Phase ?]: HEAD authenticates the final link without acquiring the final content blob.
- [Phase ?]: Preserve authenticated narinfo text exactly and classify publisher endorsement separately by Ed25519 key bytes.
- [Phase ?]: Capture selection once at HTTP handler entry and pass the immutable snapshot through resolution.
- [Phase ?]: Generate signed Nix E2E fixtures ephemerally so private signing keys never enter the repository.
- [Phase ?]: Use a fresh isolated destination store for every stock-Nix substitution proof.
- [Phase ?]: Use the exact corrected ROADMAP goal as the User Flow Coverage contract; do not infer a different outcome.
- [Phase ?]: Assign a passing verdict only after fresh full-matrix probes and repository traceability support every must-have and requirement.
- [Phase ?]: Require one unambiguous supported HTTP response framing mode before exposing publisher bytes.
- [Phase ?]: Normalize IPv4-mapped IPv6 into IPv4 bytes before forbidden CIDR evaluation.
- [Phase ?]: Keep transport socket and abort ownership active through body terminal state.
- [Phase ?]: Treat authenticated blob sizes only as equality requirements that may narrow operator transfer ceilings.
- [Phase ?]: Debit every received chunk at the BlobFetcher boundary and every delivered chunk before response enqueue.
- [Phase ?]: Materialize only bounded narinfo metadata; keep NAR bodies on the direct stream path.
- [Phase ?]: Phase 1 derives allowed identities as 17091:<configured-pubkey>: and enforces publisher plus identity before durable admission.
- [Phase ?]: Corrupt stored selections clear only event tuple fields and preserve signed-history and downgrade-consent policy.
- [Phase ?]: Keep StateRepository authoritative for rollback and downgrade policy; EventStore receives only verified, authorized, durably accepted cache publications.
- [Phase ?]: Project authenticated BUD-03 data inside CacheSelectionModel and preserve publisher trust in each request source plan.
- [Phase ?]: Represent configured write capability as a discriminated writeIntent union; signer ownership and readiness remain Phase 3 responsibilities.
- [Phase ?]: Parse writable cache identities into exact kind, lowercase pubkey, and raw identifier fields at startup.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Pin current BUD-16/17/18 revisions and supported Nix version during planning; proposal and CLI details may have changed.
- [Phase 1]: Confirm an address-bound outbound transport strategy that closes DNS rebinding gaps while preserving HTTP Host and TLS SNI.
- [Phase 3]: Confirm daemon-safe NIP-46 authorization and protected local-key lifecycle before enabling PUT.
- [Phase 4]: Define concrete Blossom upload/completeness evidence and relay acknowledgement/reconciliation policy before publication.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260812-igi | Wire supported NIXSTR limit environment variables | 2026-08-12 | a7b6958 | [260812-igi-wire-supported-nixstr-limit-environment-](./quick/260812-igi-wire-supported-nixstr-limit-environment-/) |

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Protocol | BUD-15 self-encrypted Hashtree reads and writes | v2 | Initial roadmap |
| Operations | Metrics, quotas, crash-injection, and advanced readiness/draining | v2 | Initial roadmap |

## Session Continuity

Last session: 2026-08-12T13:13:06.423Z
Stopped at: Completed 01-11-PLAN.md
Resume file: None
