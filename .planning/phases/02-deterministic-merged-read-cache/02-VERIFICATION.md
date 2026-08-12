---
phase: 02-deterministic-merged-read-cache
verified: 2026-08-12T14:12:11Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 2: Deterministic Merged Read Cache Verification Report

**Phase Goal:** As a Nix cache operator, I want to expose several trusted publishers through one deterministic cache, so that overlaps are resolved predictably without hiding conflicts.
**Verified:** 2026-08-12T14:12:11Z
**Status:** passed
**Re-verification:** No — initial technical verification after the ROADMAP MVP goal was normalized.

## User Flow Coverage

User story: “As a Nix cache operator, I want to expose several trusted publishers through one deterministic cache, so that overlaps are resolved predictably without hiding conflicts.”

| Step | Expected | Codebase evidence | Status |
|---|---|---|---|
| Configure publishers | Supply an ordered list containing exact default and named identities | `parseCacheIdentity` and `parseConfig` preserve a bounded, duplicate-free `identities` array; production environment and no-side-effect tests pass | VERIFIED |
| Observe one cache | Independent selected roots appear at one daemon URL in configuration order | `CacheSelectionModel` maps selected publications through the frozen configured identity order; production handler consumes the complete snapshot | VERIFIED |
| Resolve compatible overlap | Nix receives the winner record plus every compatible `Sig` occurrence in stable order | `resolveMergedNarInfo` compares the complete semantic projection and `appendNarInfoSignatures` preserves occurrences; protocol/integration tests pass | VERIFIED |
| Resolve conflicting overlap | Nix receives the highest-priority record and its NAR while the operator receives a safe structured conflict warning | Conflict integration and winner-route tests pass; production injects a typed diagnostic sink | VERIFIED |
| Reuse local cache | Verified remote blobs populate optional local Blossom and later work with the remote unavailable | Hash-gated spool, leased population, local-first verified fallback, and stock-Nix remote-offline E2E pass | VERIFIED |
| Outcome | Overlaps resolve predictably without silently mixing conflicting publisher metadata and NAR bytes | Ordered winner selection, redacted diagnostics, and immutable route pins are production-wired and behaviorally tested | VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Ordered exact kind-17091 default and kind-37091 named identities are the sole publisher-priority source | VERIFIED | Config parser accepts exact raw identities, rejects malformed/duplicate/over-limit lists, derives authors secondarily, and passes configuration integration tests. |
| 2 | Each identity selects, expires, restores, and rejects rollback independently while exposing immutable ordered reactive snapshots | VERIFIED | `CacheSelectionModel` groups by exact identity and maps in configured order; the two-identity lifecycle test exercises update, expiry, stale withdrawal, restart, immutability, and rollback. |
| 3 | Production subscribes to both publication kinds and admits only authorized exact identities after durable acceptance | VERIFIED | `createPublicationEventStream` filters kinds 17091/37091; `startPublicationSelection` validates publisher and identity, calls `repository.accept`, then admits to EventStore. Ordering/admission tests pass. |
| 4 | Duplicate Narinfo records contribute all valid `Sig` occurrences only when every supported non-signature semantic field agrees | VERIFIED | Parser retains required fields plus optional Deriver/System/CA presence; comparison and duplicate-occurrence tests pass across all supported fields. |
| 5 | A semantic disagreement returns the byte-identical highest-priority record and emits one redacted typed diagnostic per loser | VERIFIED | Conflict test asserts unchanged winner text, one diagnostic, exact allow-listed fields, and absence of record secrets/signature content. Production wires the diagnostic to structured `console.warn`. |
| 6 | NAR requests remain pinned to the exact publication whose Narinfo won, even after reactive selection changes | VERIFIED | `WinnerRouteRegistry` stores immutable winner publication by normalized NAR URL with count/TTL bounds; selection-change/eviction behavioral test passes. |
| 7 | Optional local Blossom reads are local-first but undergo the same hash/size verification, with corrupt local data falling back remotely | VERIFIED | Source role/order and corrupt-local fallback test pass; local mismatches are diagnostic and repairable rather than trusted or permanently quarantined. |
| 8 | Only completed hash-verified remote spools populate local Blossom through leased streamed PUTs, and later reads can reuse them without the remote | VERIFIED | `BlobFetcher` calls population only after digest equality; `VerifiedBlob.open()` retains a lease; population/failure tests and stock-Nix remote-offline reuse E2E pass. |

**Score:** 8/8 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/config/config.ts` | Canonical bounded ordered identity configuration | VERIFIED | Substantive; exports `ValidatedConfig`, `parseConfig`, and `parseCacheIdentity`; production environment flows into it. |
| `src/nostr/selection.ts` | Independent reactive ordered publication selections | VERIFIED | Substantive; exports `MergedSelectionSnapshot`, `CacheSelectionModel`, and `startPublicationSelection`; wired through runtime. |
| `src/protocol/narinfo.ts` | Complete semantic projection and occurrence-preserving merge primitives | VERIFIED | Substantive and imported by merged cache/HTTP paths. |
| `src/nix/merged_cache.ts` | Ordered merge, typed conflicts, bounded route pins | VERIFIED | Substantive; all declared symbols exist and are consumed by the HTTP handler/runtime. |
| `src/nix/http_handler.ts` | Snapshot-bound merged Narinfo and winner-pinned NAR serving | VERIFIED | Substantive, production-wired, and exercised through GET/HEAD/integration/E2E paths. |
| `src/blossom/cache_sink.ts` | Post-verification streamed BUD-02 population | VERIFIED | Substantive; exports `BlobCacheSink` and `LocalCacheDiagnostic`; instantiated by production runtime. |
| `src/blossom/blob_fetcher.ts` | Verified spool lifetime and local-corruption fallback | VERIFIED | Substantive; population callback occurs only after exact SHA-256 match. |
| `src/blossom/source_plan.ts` | Local-first bounded source plan | VERIFIED | Substantive and used for every production resolver. |
| Phase 2 test files | Behavioral evidence across unit, integration, and stock Nix | VERIFIED | All enumerated tests run under `deno task verify`; 78 total tests passed. |

The generic artifact query incorrectly reported bracketed frontmatter export lists as single missing export names. Manual source inspection confirms every declared export exists.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Validated config | selection | `config.identities` passed to `startPublicationSelection` | WIRED | Array order is preserved; no priority Set replaces it. |
| Selection | durable state/EventStore | `repository.accept` precedes `store.add` | WIRED | Transaction-failure and unauthorized-admission tests pass. |
| Runtime relay | selection | kinds 17091, 37091, and configured authors | WIRED | Exact identity authorization still occurs before persistence. |
| HTTP handler | merged resolver | one captured snapshot, one budget, one abort signal | WIRED | Agreement test observes one shared `RequestBudget` across layers. |
| Merged resolver | Narinfo codec | semantic differences gate raw signature append | WIRED | Complete field matrix passes. |
| Narinfo winner | NAR resolver | normalized URL route pin carries exact winner publication | WIRED | Selection-update provenance test passes. |
| Source plan | verified fetcher | local source precedes publisher sources but retains configured transport policy | WIRED | Corrupt-local fallback and address-policy tests pass. |
| Verified spool | local sink | post-digest callback synchronously acquires population stream lease | WIRED | Owner-disposal/upload lifetime test passes. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Ordered selection | selected roots | validated relay events after durable repository admission | Yes | FLOWING |
| Merged Narinfo | records and signatures | verified Hashtree paths from every selected layer | Yes | FLOWING |
| Conflict diagnostics | winner/loser identities, event IDs, differing field names | parsed semantic comparison | Yes, redacted | FLOWING |
| Winner NAR route | immutable publication snapshot | winner record's normalized `URL` | Yes | FLOWING |
| Local read-through | content-addressed blob stream | configured local origin, then publisher sources | Yes, hash-gated | FLOWING |
| Local population | verified immutable blob | completed remote SHA-256 spool and retained file stream | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full quality and behavior gate | `deno task verify` | fmt 33 files; lint 29; check passed; 15 protocol, 62 integration, 1 stock-Nix E2E passed | PASS |
| MVP story format | centralized `user-story.validate` query | Valid; role, capability, and outcome extracted | PASS |
| Ordered independent lifecycle | named integration test in `publication_selection_test.ts` | Passed | PASS |
| Signature agreement/conflict/provenance | three named tests in `merged_cache_test.ts` | Passed | PASS |
| Local verification/population lifecycle | focused hostile-Blossom tests | Passed | PASS |
| Phase 1 regression | complete gate including stock-Nix substitution and hostile network suites | Passed | PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. Step 7c is not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PROT-01 | 02-01 | Ordered exact default/named publisher identities | SATISFIED | Configuration, production wiring, authorization, and two-identity lifecycle tests pass. |
| TREE-06 | 02-03 | Verified local Blossom read/write-through | SATISFIED | Local-first verification, corrupt fallback, post-verification leased population, failure diagnostics, and remote-offline reuse pass. |
| READ-05 | 02-02/02-03 | Union signatures only for fully agreeing duplicate Narinfo | SATISFIED | Complete semantic matrix and stable all-occurrence merge pass. |
| READ-06 | 02-02/02-03 | Priority winner plus structured warning on disagreement | SATISFIED | Byte-identical winner, redacted per-loser diagnostic, and winner-pinned NAR tests pass. |

No additional Phase 2 requirements are orphaned from plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `tests/e2e/nix_substitution_test.ts` | 23 | Test name/SUMMARY imply merged conflict coverage, but both publishers serve the same root and record | INFO | Stock Nix proves production multi-publisher selection and local reuse, while disagreement observability and provenance are proven only by integration tests. This does not invalidate the behavior, but the E2E claim should not be cited as conflict evidence. |

No unreferenced TBD, FIXME, or XXX debt markers, production placeholders, automatic publisher redirects, pre-verification local upload, public PUT route, or unbounded route registry were found.

Disconfirmation pass: the only partial evidence claim is the overstated E2E description above. The green integration conflict test is discriminating—it changes optional semantic fields, requires exact winner bytes, checks redaction, and separately proves post-update NAR provenance. The cache population rejection and corrupt-local error paths have direct tests; no uncovered phase-critical error path was found.

### Human Verification Required

None. All state transitions, ordering invariants, cleanup/lease behavior, conflict handling, and stock-Nix interoperability needed for this phase have passing automated behavioral evidence.

### Gaps Summary

No blocking gaps remain. The current code implements all four roadmap success criteria and requirements without regressing Phase 1 safety or substitution. The misleading E2E coverage label is informational because the same behaviors are directly and discriminatingly covered in production-wired integration tests.

---

_Verified: 2026-08-12T14:12:11Z_
_Verifier: the agent (gsd-verifier)_
