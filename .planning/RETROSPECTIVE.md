# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-08-12
**Phases:** 4 | **Plans:** 21 | **Tasks:** 48

### What Was Built

- A bounded, verified Nostr and Blossom read path compatible with an unmodified Nix client.
- A deterministic merged cache with publisher priority, semantic conflict handling, signature preservation, and verified local reuse.
- A signer-gated writable overlay with streamed staging, durable dependency closure, canonical Hashtree generation, and resource-safe reclamation.
- An availability-gated publication saga with Blossom proof, local and NIP-46 signing, relay acknowledgement, repair, health diagnostics, and two-generation stock-Nix round trips.

### What Worked

- Vertical phases kept each increment demonstrable through the production entry point and stock Nix.
- Threat-led design produced concrete limits, durable ownership boundaries, exact event validation, SSRF defenses, and cancellation behavior.
- Re-verification and independent integration, security, and deep code reviews found lifecycle defects that ordinary happy-path tests missed.
- Durable SQLite state machines made restart and retry behavior explicit and testable.

### What Was Inefficient

- Early green suites did not exercise a second publication generation, so rollover and resource-lifecycle defects survived until milestone review.
- Writer ownership, cleanup, and quota semantics needed several iterations because their transaction boundaries crossed repository and filesystem state.
- Stock-Nix E2E fixtures occasionally left exact `nixstr-e2e-*` temporary directories on tmpfs, causing misleading SQLite disk I/O failures until those artifacts were diagnosed.

### Patterns Established

- Keep reactive control-plane state separate from backpressured Web Stream byte transport.
- Admit immutable content only after hash verification, then bind every route and response to an exact generation lease.
- Model publication as a durable monotone saga: prove availability, persist one exact signed event, obtain configured-relay acknowledgement, commit, then admit through the normal selector.
- Track filesystem content with durable owners and cleanup tombstones so crashes cannot create authoritative dangling references or unretryable orphans.
- Require multi-generation production E2E coverage for lifecycle-sensitive state machines.

### Key Lessons

1. A single successful end-to-end cycle proves compatibility, but not lifecycle correctness; test rollover, shutdown, restart, expiry, and reclamation explicitly.
2. Resource cleanup is part of the durable protocol. Its intent must be persisted before fallible deletion and retried after restart.
3. Security controls should be verified against their promised property, allowing stronger equivalent primitives when the evidence is explicit.
4. Separate environmental fixture failures from product regressions with targeted diagnostics before changing production code.

### Cost Observations

- The most valuable extra effort was spent on adversarial review and production-wiring E2E tests, not additional unit-test volume.
- Quick gap-closure plans worked well when each had an explicit failing test, bounded ownership, and a canonical full-suite gate.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 4 | 21 | Established verification, security audit, deep review, and multi-generation E2E as release gates. |

### Cumulative Quality

| Milestone | Protocol Tests | Integration Tests | Stock-Nix E2E |
|-----------|----------------|-------------------|---------------|
| v1.0 | 23 | 100 | 2 |

### Top Lessons (Verified Across Milestones)

1. Production lifecycle tests expose defects that isolated repository tests cannot.
2. Durable ownership and cleanup need the same transactional rigor as publication and selection.
