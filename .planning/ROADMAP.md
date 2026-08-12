# Roadmap: nixstr-cache

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4, 21 plans, 48 tasks (shipped 2026-08-12) — [archive](milestones/v1.0-ROADMAP.md)

## Completed Phases

<details>
<summary>v1.0 MVP — 4 phases</summary>

- **Phase 1: Verified Nix Substitution Walking Slice** — Strict, bounded Nostr/Blossom resolution served to stock Nix.
- **Phase 2: Deterministic Merged Read Cache** — Ordered multi-publisher merging, conflict handling, and verified local caching.
- **Phase 3: Signer-Gated Writable Cache** — Authorized streamed PUT staging, immutable overlays, and deterministic Hashtree construction.
- **Phase 4: Availability-Gated Publication Loop** — Complete-replica proof, signing, relay publication, repair, health diagnostics, and real-Nix round trips.

Full phase history: [v1.0 roadmap archive](milestones/v1.0-ROADMAP.md)

</details>

## Backlog

### Phase 999.1: Human-readable console logging for MVP debugging (BACKLOG)

**Goal:** Replace JSON-formatted console output with concise human-readable messages so operators and developers can debug the MVP directly from its terminal output, while preserving structured internal diagnostic types and secret-redaction guarantees.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with `$gsd-review-backlog` when ready)
