---
phase: 01-verified-nix-substitution-walking-slice
verified: 2026-08-12T12:00:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Phase 1: Verified Nix Substitution Walking Slice Verification Report

**Phase Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Verified:** 2026-08-12
**Status:** passed
**Re-verification:** Yes — the corrected canonical roadmap contract and current repository behavior were re-evaluated.

## User Flow Coverage

The exact `Goal` value above was extracted from `.planning/ROADMAP.md`. `gsd-tools user-story validate` returned `valid: true` and extracted the intended role (`Nix cache operator`), capability (point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache), and outcome (use a decentralized binary cache without modifying Nix).

| Step | Operator-visible outcome | Evidence | Status |
|---|---|---|---|
| Start | Validated configuration composes durable selection before binding | `tests/integration/address_pinning_test.ts`, `tests/integration/http_cache_test.ts` | PASS |
| Discover/select | A verified plaintext publication is admitted reactively and persists without rollback/downgrade | `tests/protocol/publication_test.ts`, `tests/integration/publication_selection_test.ts` | PASS |
| Resolve | Publisher sources are ordered, address-pinned, bounded, hash-verified, and traversed lazily | `tests/integration/address_pinning_test.ts`, `tests/integration/hostile_blossom_test.ts` | PASS |
| Serve | Snapshot-bound GET/HEAD serves cache info, lossless narinfo, and streamed NAR bytes | `tests/protocol/narinfo_test.ts`, `tests/integration/http_cache_test.ts` | PASS |
| Substitute | Stock Nix 2.34.7 realizes and verifies an initially absent path with fallback disabled | `tests/e2e/nix_substitution_test.ts` | PASS |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Valid startup reactively selects only the latest eligible plaintext publication across restart | PASS | Configuration/address tests plus five publication-selection integration cases cover invalid input, stale/equal events, expiry, restart, transaction failure, and explicit downgrade consent. |
| 2 | Stock Nix GET/HEAD metadata, narinfo, and NAR behavior preserves every valid signature while classifying endorsement separately | PASS | Four narinfo protocol tests and five HTTP integration tests prove lossless ordered `Sig` bytes, unsigned records, strict parsing, byte-key endorsement, route/status semantics, and immutable snapshots. |
| 3 | Publisher-controlled fetching is network/traversal bounded and rejects corrupt or oversized input before use | PASS | Six address-pinning and seven hostile-Blossom tests cover DNS/private ranges, redirects/rebinding, ordered fallback, hash mismatch quarantine, oversize cleanup, absence, and budget overflow. |
| 4 | Manifest, chunk, NAR, hashing, spool, and response paths remain streaming and bounded | PASS | `VerifiedBlob` spooling and `PathResolver` compose verified file streams under a mandatory request ledger; slow/cancelled/oversized and HEAD-without-final-fetch cases pass. |
| 5 | A real Nix CLI substitutes and verifies an uncached store path through the daemon | PASS | Stock Nix 2.34.7 E2E passes after proving absence, disabling fallback, restarting the daemon, and exercising repeat/concurrent fresh destination stores. |

**Score:** 5/5 truths verified.

### Required Artifacts

| Artifact | Purpose | Status |
|---|---|---|
| `src/config.ts`, `src/net/safe_fetcher.ts` | Side-effect-free validation and address-pinned transport | VERIFIED |
| `src/protocol/publication.ts`, `src/nostr/selection.ts`, `src/persistence/state_repository.ts` | Verified reactive selection and durable freshness/downgrade state | VERIFIED |
| `src/protocol/hashtree.ts`, `src/blossom/blob_fetcher.ts`, `src/hashtree/reader.ts` | Strict bounded Hashtree acquisition and streaming traversal | VERIFIED |
| `src/protocol/narinfo.ts`, `src/nix/http_handler.ts`, `src/app.ts` | Lossless metadata and snapshot-bound HTTP serving | VERIFIED |
| `tests/e2e/nix_substitution_test.ts`, `deno.json` | Real-client acceptance and comprehensive verification entry point | VERIFIED |

### Key Link Verification

| From | To | Link | Status |
|---|---|---|---|
| `.planning/ROADMAP.md` | this report | Exact canonical role/capability/outcome story drives User Flow Coverage | WIRED |
| relay event admission | SQLite repository / reactive selection | Validation precedes store admission; transaction commit precedes frozen snapshot emission | WIRED |
| selected publication | source plan / Hashtree reader | Immutable root and ordered sources feed one bounded request ledger | WIRED |
| HTTP handler | resolver | Selection is captured once at handler entry and retained through completion | WIRED |
| narinfo | referenced NAR | Strict parsed URL is resolved through the same authenticated snapshot | WIRED |
| `deno.json` | this report | `deno task verify` supplies fresh protocol, integration, and stock-Nix evidence | WIRED |

### Data-Flow Trace (Level 4)

`validated config → relay event → signature/tag/nhash validation → atomic SQLite freshness policy → reactive immutable selection → ordered safe Blossom fetch → restrictive hash-verified spool → canonical bounded Hashtree traversal → lossless narinfo + referenced NAR stream → snapshot-bound Deno HTTP response → stock Nix signature/hash verification and realization`.

No stage admits unauthenticated publisher data after its trust boundary. Hash mismatch alone creates durable source quarantine; ordinary availability failures remain per-path. HEAD authenticates the final link without acquiring its content blob. GET exposes bytes only after complete blob hash verification and retains stream backpressure.

### Behavioral Spot-Checks

- D-01–D-04: expiry clears availability, restart keeps the newer root, missing/corrupt paths do not roll selection back, and unrelated paths survive.
- D-05–D-08: configured/event/BUD-03 ordering, canonical deduplication, hash-only durable quarantine, and no Phase 1 write-back are implemented.
- D-09–D-12: authenticated absence is 404; typed failures map separately; HEAD omits final acquisition; one snapshot spans a request; valid signatures remain unchanged.
- D-13–D-16: invalid configuration aggregates errors before I/O; limits have defaults/ceilings; publisher private addresses are denied; only the configured origin receives explicit local authorization.

### Probe Execution

Fresh execution of the unchanged `deno task verify` passed:

- `deno fmt --check`, `deno lint`, and full `deno check`: passed.
- Protocol suites: 12 passed, 0 failed.
- Permission-scoped integration suites: 23 passed, 0 failed.
- Stock Nix 2.34.7 E2E: 1 passed, 0 failed.

### Requirements Coverage

| Requirement | Evidence | Status |
|---|---|---|
| PROT-02 | Strict event/signature/time/tag/nhash protocol tests | SATISFIED |
| PROT-03 | Reactive validate-before-admission selection and equal-time ordering tests | SATISFIED |
| PROT-04 | SQLite watermark/tie persistence and restart/stale tests | SATISFIED |
| PROT-05 | Durable signed-history consent tests | SATISFIED |
| PROT-06 | Strict plaintext type-0 acceptance and typed BUD-15 rejection | SATISFIED |
| TREE-01 | Configured/event/BUD-03 stable ordering and dedup tests | SATISFIED |
| TREE-02 | Incremental SHA-256 verified spool, mismatch discard/fallback tests | SATISFIED |
| TREE-03 | Address-pinning, private/mixed DNS, redirect/rebinding tests | SATISFIED |
| TREE-04 | Canonical manifest codec and lazy shared-budget traversal tests | SATISFIED |
| TREE-05 | Verified file streams, slow-sink/cancellation/size bounds | SATISFIED |
| READ-01 | Stock-compatible `nix-cache-info` GET/HEAD tests | SATISFIED |
| READ-02 | Strict narinfo/NAR GET/HEAD route tests | SATISFIED |
| READ-03 | Capture-before-await, root-swap, empty, and concurrent snapshot tests | SATISFIED |
| READ-04 | Byte-identical ordered signatures and independent key-byte endorsement tests | SATISFIED |
| READ-07 | Isolated stock Nix 2.34.7 substitution and verification E2E | SATISFIED |
| OPER-01 | Aggregate validation, bind-last startup, restore, and shutdown tests | SATISFIED |

All 16 Phase 1 requirement IDs are present in `.planning/REQUIREMENTS.md`, mapped to Phase 1, and backed by current automated evidence.

### Anti-Patterns Found

None in the Phase 1 goal path. The verification matrix found no skipped tests, placeholder implementation, whole-body conversion, unbounded request ledger, or bypass of the real Nix client.

### Human Verification Required

None. This read-only protocol walking slice is fully observable through deterministic automated probes and the real stock Nix client.

### Gaps Summary

No Phase 1 goal-achievement gaps remain. Local Blossom write-through belongs to Phase 2; BUD-15 and production-grade operational hardening remain v2 scope and are not regressions against this phase contract.

---

_Re-verified: 2026-08-12_
_Verifier: GSD executor using fresh canonical-story and full-matrix evidence_
