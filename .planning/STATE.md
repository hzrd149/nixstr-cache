---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Awaiting next milestone
stopped_at: Completed quick task 260813-lgb
last_updated: "2026-08-13T14:37:00.000Z"
last_activity: 2026-08-13
last_activity_desc: "Completed quick task 260813-lgb: Add CLI signer overrides with pre-bind ncryptsec unlocking"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 21
  completed_plans: 21
current_phase: 04
current_phase_name: Availability-Gated Publication Loop
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-12)

**Core value:** An unmodified Nix client can reliably read and publish a decentralized binary cache while preserving NIP.md trust, integrity, freshness, and bounded-resource guarantees.
**Current focus:** v1.0 MVP shipped; awaiting the next milestone. Human-readable console logging remains in the backlog.

## Current Position

Phase: Milestone v1.0 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-08-13 - Completed quick task 260813-nqe: update all applesauce dependencies to the alpha next build for bug fixes 0.0.0-next-20260813160224

## Performance Metrics

**Velocity:**

- Total plans completed: 21 (21 planned through Phase 4)
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 11 | - | - |
| 02 | 3 | - | - |
| 03 | 3 | - | - |
| 04 | 4 | - | - |

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
| Phase 02 P01 | 6 min | 2 tasks | 7 files |
| Phase 02 P02 | 12 min | 2 tasks | 7 files |
| Phase 02 P03 | 12 min | 3 tasks | 12 files |
| Phase 03 P01 | 28min | 2 tasks | 10 files |
| Phase 03 P02 | 8min | 2 tasks | 7 files |
| Phase 03 P03 | 15min | 2 tasks | 9 files |
| Phase 04 P01 | 6min | 2 tasks | 6 files |
| Phase 04 P02 | 9min | 2 tasks | 9 files |
| Phase 04 P03 | 8min | 2 tasks | 6 files |
| Phase 04 P04 | 11min | 3 tasks | 7 files |
| Phase quick P260812-obg | 35min | 3 tasks | 11 files |
| Phase quick P260812-osc | 24min | 3 tasks | 9 files |

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
- [Phase 02]: Keep NIXSTR_PUBLISHER_PUBKEYS as a default-cache compatibility input while NIXSTR_CACHE_IDENTITIES is the explicit ordered mixed-identity priority source. — Preserves Phase 1 deployments without weakening the new deterministic identity contract.
- [Phase 02]: Schedule only the nearest selected publication expiry and recompute the immutable snapshot when it fires. — Bounds timer work while retaining independent per-layer expiration.
- [Phase ?]: Compare every supported parsed Narinfo non-Sig field while preserving the winner's original scalar layout.
- [Phase ?]: Retain immutable NAR winner provenance in a count-and-TTL-bounded normalized route registry.
- [Phase ?]: Treat local Blossom as a source role rather than content authority; local mismatches remain repairable and do not quarantine the origin.
- [Phase ?]: Open population leases synchronously after remote verification and supervise them through daemon shutdown.
- [Phase ?]: Reject streamed upload redirects rather than replaying a consumed body.
- [Phase ?]: Expose only signer status and public-key ownership; cache-event signing remains unavailable until Phase 4.
- [Phase ?]: Reserve the configured per-body ceiling transactionally before opening a temp file to prevent concurrent aggregate oversubscription.
- [Phase ?]: Use same-filesystem hard-link creation for no-overwrite immutable promotion followed by transactional route metadata.
- [Phase ?]: Capture signer ownership, repository health, publication relays, and a current configured/BUD-03 Blossom destination as one PUT readiness fact.
- [Phase ?]: Treat only the current atomic signer overlay generation as readable; mutable staging is never a resolver input.
- [Phase ?]: Pin signer NAR routes to the immutable generation that supplied their Narinfo.
- [Phase ?]: Freeze publication batches by copying one immutable overlay generation into durable batch-entry rows before canonical tree construction.
- [Phase ?]: Keep pending candidate metadata and inventory transactionally separate from the committed signer overlay until Phase 4 availability succeeds.
- [Phase ?]: Use a serialized repository-authoritative publication coordinator so duplicate ticks cannot sign or publish a second event.
- [Phase ?]: Verify signed template equality and Nostr validity again at the persistence boundary.
- [Phase ?]: Archive each committed publication saga before cloning its immutable inventory into an expiration-refresh successor.
- [Phase ?]: A local relay is cache-only unless its canonical URL is explicitly configured as a publication relay.
- [Phase ?]: Use repository-driven nearest-due scheduling with stable target-derived retry jitter.
- [Phase ?]: Health providers receive only synchronous state readers and expose no network, signer, timer, or mutation capability.
- [Phase ?]: Operational JSON is constructed field-by-field from a closed union; unknown properties and recursive errors are never traversed.
- [Phase ?]: An empty write-ready cache returns 404 for stock Nix destination probes while read-only empty caches remain unavailable.
- [Phase ?]: Long publication-expiration timers clamp to the signed 32-bit timer ceiling and recompute on wake.
- [Quick 260812-nes]: Configured relay OK is the publication barrier; local relay forwarding follows selector admission and cannot delay saga admission.
- [Quick 260812-nes]: Reclaim candidate content only after transient run and durable batch/history ownership both reach zero.
- [Phase ?]: Candidate blob ownership is consolidated into WriteRepository so pending admission and durable batch ownership commit atomically.
- [Phase ?]: Signer route pins own exact-generation leases through response terminal state.
- [Phase ?]: Route registries are handler-owned disposable resources with timer-driven signer lease expiry.
- [Phase ?]: Writer run index cleanup uses durable tombstones until SQLite, WAL, and SHM paths are absent.

### Pending Todos

None yet.

### Blockers/Concerns

None for the shipped v1.0 milestone.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260812-igi | Wire supported NIXSTR limit environment variables | 2026-08-12 | a7b6958 | [260812-igi-wire-supported-nixstr-limit-environment-](./quick/260812-igi-wire-supported-nixstr-limit-environment-/) |
| 260812-kuw | Add deterministic in-process NIP-46 integration coverage | 2026-08-12 | 1209236 | [260812-kuw-add-deterministic-in-process-nip-46-inte](./quick/260812-kuw-add-deterministic-in-process-nip-46-inte/) |
| 260812-mhi | Close milestone integration gaps for signing, restart recovery, and diagnostics | 2026-08-12 | b79030c | [260812-mhi-close-milestone-integration-gaps-nip-46-](./quick/260812-mhi-close-milestone-integration-gaps-nip-46-/) |
| 260812-mw9 | Close bounded writer and staging security audit blockers | 2026-08-12 | 73dabe6 | [260812-mw9-close-security-audit-blockers-bounded-st](./quick/260812-mw9-close-security-audit-blockers-bounded-st/) |
| 260812-nes | Close all actionable milestone review findings | 2026-08-12 | 8b06d81 | [260812-nes-close-all-actionable-milestone-review-fi](./quick/260812-nes-close-all-actionable-milestone-review-fi/) |
| 260813-eh3 | Remove obsolete `@db/sqlite` dependency and update active stack documentation | 2026-08-13 | ea932eb | [260813-eh3-remove-obsolete-db-sqlite-dependency-and](./quick/260813-eh3-remove-obsolete-db-sqlite-dependency-and/) |
| 260813-el3 | Update the local Blossom default port to `24242` | 2026-08-13 | ecf8ac6 | [260813-el3-update-the-default-port-for-the-local-bl](./quick/260813-el3-update-the-default-port-for-the-local-bl/) |
| 260813-ecz | Add JSON config file support with `--config`, environment overrides, and local development defaults | 2026-08-13 | uncommitted | [260813-ecz-add-json-config-file-support-with-config](./quick/260813-ecz-add-json-config-file-support-with-config/) |
| 260813-fd1 | Simplify read-side cache identity configuration with npub and naddr normalization | 2026-08-13 | uncommitted | [260813-fd1-simplify-cacheidentities-configuration-w](./quick/260813-fd1-simplify-cacheidentities-configuration-w/) |
| 260813-frn | Rename the read-cache configuration field from `cacheIdentities` to `caches` | 2026-08-13 | uncommitted | [260813-frn-rename-cacheidentities-configuration-fie](./quick/260813-frn-rename-cacheidentities-configuration-fie/) |
| 260813-ftf | Remove legacy cache inputs and use `NIXSTR_CACHES` exclusively | 2026-08-13 | uncommitted | [260813-ftf-remove-legacy-cache-environment-variable](./quick/260813-ftf-remove-legacy-cache-environment-variable/) |
| 260813-gte | Add ncryptsec PasswordSigner support with secure startup unlocking | 2026-08-13 | uncommitted | [260813-gte-add-support-for-an-ncryptsec-signer-type](./quick/260813-gte-add-support-for-an-ncryptsec-signer-type/) |
| 260813-fhz | Replace flat writable configuration with nested groups and signer-derived durable ownership | 2026-08-13 | uncommitted | [260813-fhz-replace-flat-writable-configuration-with](./quick/260813-fhz-replace-flat-writable-configuration-with/) |
| 260813-lgb | Add CLI signer overrides with pre-bind ncryptsec unlocking | 2026-08-13 | uncommitted | [260813-lgb-add-cli-signer-overrides-for-nsec-ncrypt](./quick/260813-lgb-add-cli-signer-overrides-for-nsec-ncrypt/) |
| 260813-nqe | update all applesauce dependencies to the alpha next build for bug fixes 0.0.0-next-20260813160224 | 2026-08-13 | 0de0416 | [260813-nqe-update-all-applesauce-dependencies-to-th](./quick/260813-nqe-update-all-applesauce-dependencies-to-th/) |
| 260813-o14 | Expand logging for reactive write relay discovery and changes | 2026-08-13 | 0e1e1a1 | [260813-o14-expand-logging-to-report-when-effective-](./quick/260813-o14-expand-logging-to-report-when-effective-/) |
| 260813-o5i | Add reactive cache selection, package load, and Hashtree NAR provenance logging | 2026-08-13 | 4639a7d | [260813-o5i-add-reactive-logging-for-cache-selection](./quick/260813-o5i-add-reactive-logging-for-cache-selection/) |

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Protocol | BUD-15 self-encrypted Hashtree reads and writes | v2 | Initial roadmap |
| Operations | Metrics, quotas, crash-injection, and advanced readiness/draining | v2 | Initial roadmap |

## Session Continuity

Last session: 2026-08-13T16:27:00.000Z
Stopped at: Completed quick task 260813-o5i
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
