# Roadmap: nixstr-cache

## Overview

The v1 journey starts with the smallest safe walking slice: a stock Nix client substitutes from one Nostr-published plaintext cache through strict event validation, rollback protection, verified bounded streaming, and hostile-network defenses. It then expands that same read path into the deterministic merged cache, adds signer-gated streamed staging without publication risk, and finally closes the loop with availability-gated Blossom replication and Nostr publication that a real Nix CLI can upload to and substitute back from.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Verified Nix Substitution Walking Slice** - A real Nix client safely substitutes from one selected Nostr/Blossom cache through a bounded, verified stream. (completed 2026-08-12)
- [ ] **Phase 2: Deterministic Merged Read Cache** - Multiple whitelisted publishers appear as one stable priority-ordered cache with safe conflict handling and local verified caching.
- [ ] **Phase 3: Signer-Gated Writable Cache** - A connected signer can stream complete store objects into a private writable overlay while incomplete data remains invisible.
- [ ] **Phase 4: Availability-Gated Publication Loop** - Eligible writes become retrievable signed roots and pass a complete real-Nix upload, publish, and substitute-back workflow.

## Phase Details

### Phase 1: Verified Nix Substitution Walking Slice

**Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: PROT-02, PROT-03, PROT-04, PROT-05, PROT-06, TREE-01, TREE-02, TREE-03, TREE-04, TREE-05, READ-01, READ-02, READ-03, READ-04, READ-07, OPER-01
**Success Criteria** (what must be TRUE):

  1. Operator can start the daemon from validated read configuration and see the latest eligible plaintext publication selected reactively, while invalid, expired, stale, rollback, downgrade, and BUD-15 candidates remain unselected across restarts.
  2. Nix client can GET or HEAD cache metadata, `.narinfo`, and its referenced NAR from the daemon, with every syntactically valid signature preserved unchanged and publisher-endorsed signatures identified independently.
  3. Every publisher-controlled fetch is constrained by the configured network and traversal limits, and corrupt or oversized content is rejected before it can be parsed, cached, or served.
  4. Large manifests, chunks, and NARs pass through hashing, verification, temporary storage, and HTTP responses with backpressure and bounded memory.
  5. A real `nix` CLI substitutes an uncached store path through the daemon and successfully verifies the returned metadata and NAR.

**Plans:** 11/11 plans complete

Plans:

- [x] 01-06-PLAN.md

**Wave 1**

- [x] 01-01-PLAN.md — Prove address-pinned transport and validated startup configuration.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Select one verified publication durably and reactively.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Resolve verified bounded Hashtree paths from hostile Blossom sources.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Serve snapshot-bound stock Nix GET/HEAD semantics.
- [x] 01-08-PLAN.md — Close hostile transport, deadline, framing, cancellation, and canonical SSRF gaps.

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Prove the walking slice with pinned stock Nix 2.34.7.
- [x] 01-09-PLAN.md — Preserve ordered Hashtree streaming under bounded transfer, output, and metadata budgets.

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-07-PLAN.md — Ship the production launcher, enforce live allow-lists, recover persisted state safely, and run stock Nix through `main.ts`.

**Wave 7** *(gap closure; blocked on the completed production walking slice)*

- [x] 01-10-PLAN.md — Move durable selection into an Applesauce custom model and wire authenticated BUD-03 discovery into production source resolution.
- [x] 01-11-PLAN.md — Validate explicit read-only and complete signer/writable-identity configuration without enabling Phase 3 write behavior.

### Phase 2: Deterministic Merged Read Cache

**Goal**: An operator can expose several trusted publishers as one predictable binary cache without hiding overlap conflicts.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PROT-01, TREE-06, READ-05, READ-06
**Success Criteria** (what must be TRUE):

  1. Operator can configure an ordered whitelist of default and exact named cache identities and observe their selected roots through one stable daemon URL in that priority order.
  2. Nix receives the union of syntactically valid signatures when duplicate `.narinfo` records agree on every non-signature semantic field.
  3. When duplicate records disagree, Nix receives the highest-priority record and the operator receives a structured conflict warning identifying the disagreement.
  4. Operator can enable a local Blossom read/write-through cache, and only hash-verified immutable blobs are placed in it or reused from it.

**Plans**: 2/3 plans executed

Plans:

- [x] 02-01-PLAN.md — Establish ordered exact identities and independent immutable reactive selections.
- [x] 02-02-PLAN.md — Merge compatible Narinfo signatures, report conflicts, and pin NARs to winners.
- [ ] 02-03-PLAN.md — Add verified local Blossom read-through/population and prove the full slice with stock Nix.

### Phase 3: Signer-Gated Writable Cache

**Goal**: An authorized signer can safely stage complete Nix store objects into a signer-first local cache without exposing incomplete objects or publishing prematurely.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: WRIT-01, WRIT-02, WRIT-03, WRIT-04, WRIT-05, WRIT-06, PUBL-01, PUBL-02
**Success Criteria** (what must be TRUE):

  1. Operator can use either a NIP-46 signer or a protected local-key signer for exactly one owned default or named writable identity; PUT readiness stays disabled when ownership, signer, or destination prerequisites are absent.
  2. Nix client can stream standard binary-cache PUT paths into durable staging with bounded memory, and repeating identical content succeeds idempotently.
  3. Complete staged objects become readable from the highest-priority signer overlay, while objects missing their `.narinfo`, NAR, or declared references remain invisible.
  4. After five quiet seconds or sixty seconds of sustained writes, the daemon freezes one dependency-closed batch and deterministically builds its plaintext copy-on-write Hashtree without disturbing the committed read view.

**Plans**: TBD

### Phase 4: Availability-Gated Publication Loop

**Goal**: A staged Nix object becomes a signed, retrievable decentralized cache update and remains observable and recoverable when some replicas or relays fail.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: PUBL-03, PUBL-04, PUBL-05, PUBL-06, PUBL-07, OPER-02, OPER-03, OPER-04
**Success Criteria** (what must be TRUE):

  1. The daemon publishes no signed root until at least one currently advertised Blossom server proves it holds the complete reachable tree; failed additional replicas remain visible and retry asynchronously afterward.
  2. After the availability barrier passes, the correct signed default or named event reaches configured relays and optional local relay cache, then its root appears reactively in the signer-first read view.
  3. Operator can diagnose event rejection, conflicts, upstream failures, signer and batch state, replication, and publication through secret-safe structured logs and a health endpoint that distinguishes process, read, and write availability.
  4. Automated protocol, hostile-input, streaming, relay/Blossom integration, and real-Nix tests demonstrate the v1 safety and interoperability guarantees.
  5. A real `nix` CLI can upload a store object, trigger publication, delete its local copy, and substitute it back from the newly published cache root.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Verified Nix Substitution Walking Slice | 11/11 | Complete    | 2026-08-12 |
| 2. Deterministic Merged Read Cache | 2/3 | In Progress|  |
| 3. Signer-Gated Writable Cache | 0/TBD | Not started | - |
| 4. Availability-Gated Publication Loop | 0/TBD | Not started | - |
