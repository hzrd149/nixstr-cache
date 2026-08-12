---
phase: 01-verified-nix-substitution-walking-slice
verified: 2026-08-12T13:23:07Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed:
    - "The production main.ts executable now collects every supported NIXSTR_LIMIT_* variable through the same tested environment boundary used by import.meta.main."
  gaps_remaining: []
  regressions: []
---

# Phase 1: Verified Nix Substitution Walking Slice Verification Report

**Phase Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Verified:** 2026-08-12T13:23:07Z
**Status:** passed
**Re-verification:** Yes — after the production environment-boundary gap fix.

## User Flow Coverage

| Step | Expected | Codebase evidence | Status |
|---|---|---|---|
| Configure and start | Valid operator configuration, including custom resource limits, reaches the production daemon before side effects | `main.ts` uses one exported collector for all base, signer, and 15 limit variables; production-boundary tests pass | VERIFIED |
| Select publication | Latest eligible plaintext event becomes a durable reactive snapshot; invalid, stale, expired, rollback, downgrade, and BUD-15 candidates remain unavailable | Strict publication validation, SQLite state, and EventStore-backed selection; 8 selection integration tests pass | VERIFIED |
| Discover and resolve | Configured, event-tag, and authenticated BUD-03 sources are ordered and constrained | Production source-plan wiring plus address-pinning and hostile-Blossom suites pass | VERIFIED |
| Serve to Nix | GET/HEAD metadata, narinfo, and NAR use one immutable snapshot and verified bounded streams | HTTP cache and Hashtree tests pass | VERIFIED |
| Outcome | Unmodified stock Nix substitutes an absent path solely through production `main.ts` | `tests/e2e/nix_substitution_test.ts` passed in the independent full verification run | VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Operator starts the shipped daemon from validated read configuration, including enforceable operator-selected resource limits | VERIFIED | `SUPPORTED_ENVIRONMENT_NAMES` contains all 15 mapped limit names; `import.meta.main` calls `collectRawConfigFromEnvironment`; valid and invalid production-boundary tests pass. |
| 2 | Nix GET/HEAD serves cache metadata, narinfo, and NAR while preserving valid signatures and classifying endorsements independently | VERIFIED | 4 narinfo protocol tests and 8 HTTP integration tests pass. |
| 3 | Publisher-controlled fetches are constrained and reject corrupt or oversized content before use | VERIFIED | 9 address-pinning and 14 hostile-Blossom tests pass, covering peer pinning, forbidden CIDRs, redirect revalidation, framing, deadlines, hashes, and budgets. |
| 4 | Large manifests, chunks, and NARs remain ordered, backpressured, and bounded | VERIFIED | Ordered traversal, transfer/output ledgers, bounded metadata decoding, cancellation, and direct NAR streaming are behaviorally exercised. |
| 5 | A real stock Nix client substitutes through the production daemon | VERIFIED | The stock-Nix E2E passed through production `main.ts`. |
| 6 | Selection is exposed through an Applesauce EventStore custom model after durable admission | VERIFIED | Repository acceptance precedes `store.add`; EventStore model admission/disposal and restart behavior pass focused tests. |
| 7 | Production discovers authenticated BUD-03 kind-10063 Blossom sources | VERIFIED | Relay subscription and verified BUD-03 projection feed immutable production source ordering; 2 discovery tests pass. |
| 8 | Configuration covers explicit signer mode and writable identity without enabling premature writes | VERIFIED | Discriminated write intent, strict identity parsing, no-side-effect diagnostics, and PUT-405 behavior pass. |

**Score:** 8/8 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `main.ts` | Complete production environment boundary and launcher | VERIFIED | Substantive and production-wired; one collector covers base, signer, and all 15 limit variables. |
| `src/config/config.ts` | Aggregate validated configuration and hard ceilings | VERIFIED | Every limit has a nonzero default and compiled ceiling; invalid input fails before startup. |
| `src/nostr/selection.ts` | Durable EventStore-backed reactive selection | VERIFIED | Authoritative custom model, production-wired, and behaviorally tested. |
| `src/nostr/blossom_servers.ts`, `src/runtime/daemon.ts` | Authenticated BUD-03 projection and runtime composition | VERIFIED | Real relay data feeds immutable source-plan snapshots. |
| `src/network/safe_fetcher.ts`, `src/blossom/blob_fetcher.ts` | Pinned, bounded, verified transport/spooling | VERIFIED | Substantive, wired, and exercised by hostile-network tests. |
| `src/hashtree/reader.ts`, `src/nix/http_handler.ts` | Lazy bounded traversal and stock Nix HTTP semantics | VERIFIED | Selected roots flow through verified spools into streamed responses. |
| `tests/e2e/nix_substitution_test.ts` | Stock-Nix production acceptance | VERIFIED | Launches `main.ts`, isolates store/substituter state, and passes. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Process environment | `RawConfig.limits` | `collectRawConfigFromEnvironment` → `rawConfigFromEnvironment` | WIRED | All 15 names map to exact fields; test supplies distinct non-default values and asserts `ValidatedConfig.limits`. |
| `import.meta.main` | production launcher | collector → `launchDaemon` | WIRED | No separate executable allow-list remains. |
| Relay publication | repository/EventStore model | validation → durable accept → store admission | WIRED | Invalid and transaction-failed events remain unobservable. |
| Kind 10063 event | source plan | authenticated projection → immutable snapshot → `bud03:` candidates | WIRED | Production ordering and publisher trust are tested. |
| Config limits | fetcher/resolver/handler | `ValidatedConfig.limits` builds runtime budgets | WIRED | Network, traversal, transfer, output, metadata, timeout, redirect, and concurrency controls consume validated values. |
| Selected root | stock Nix response | request snapshot → resolver → streamed response | WIRED | HTTP integration and stock-Nix E2E pass. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Production limit configuration | operator overrides | narrowly allow-listed `Deno.env.get` collector | Yes | FLOWING |
| `CacheSelectionModel` | selected root and BUD-03 list | verified relay events after durable acceptance | Yes | FLOWING |
| `buildSourcePlan` | ordered candidates | configured origin, publication tags, and BUD-03 servers | Yes | FLOWING |
| Blob/Hashtree pipeline | authenticated bytes | pinned transport → verified spool → manifests/chunks | Yes | FLOWING |
| Nix handler | metadata and NAR response | immutable selection → bounded resolver → stream | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full quality and behavior matrix | `deno task verify` | fmt/lint/check; 12 protocol, 50 integration, 1 stock-Nix E2E passed | PASS |
| Every production limit maps correctly | integration test `production environment collector maps every supported limit` | Passed; distinct values reached all 15 validated fields | PASS |
| Invalid production limit is side-effect free | integration test `invalid collected production limit stops before startup` | Passed; diagnostic present, no relay/listener calls, no filesystem root | PASS |
| MVP story format | centralized `user-story.validate` | Valid user story | PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. Step 7c is not applicable.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| PROT-02, PROT-03, PROT-04, PROT-05, PROT-06 | SATISFIED | Strict validation, durable EventStore admission, restart/tie state, downgrade consent, and plaintext-only roots pass protocol/integration tests. |
| TREE-01, TREE-02, TREE-03, TREE-04, TREE-05 | SATISFIED | Authenticated source discovery, hash-gated spooling, SSRF controls, bounded traversal, and streamed backpressure pass adversarial tests. |
| READ-01, READ-02, READ-03, READ-04, READ-07 | SATISFIED | Cache metadata, narinfo/NAR, immutable request snapshots, signature preservation, and stock-Nix substitution pass. |
| OPER-01 | SATISFIED | Production collects all supported operator fields and limits; invalid configuration is side-effect free. |

No Phase 1 requirement is orphaned from the eleven plan frontmatters.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No unreferenced `TBD`, `FIXME`, or `XXX`, placeholder implementations, duplicate production environment list, whole-NAR buffering, or automatic publisher redirects found | — | None |

Disconfirmation checks found no partially met Phase 1 requirement, misleading green test, or uncovered phase-critical error path. The newly added test is discriminating because it calls the same collector used by `import.meta.main`, checks each exact mapped value, and separately exercises failure before external or filesystem effects.

### Human Verification Required

None. The MVP outcome, state transitions, cancellation/ordering invariants, and production configuration boundary all have passing automated behavioral evidence. The dependency-legitimacy checkpoint was completed during execution.

### Gaps Summary

No blocking gaps remain. Commits `b90ea77` and `a7b6958` close the sole prior gap without regressing the other seven must-haves. The phase goal is achieved and Phase 1 is ready to proceed.

---

_Verified: 2026-08-12T13:23:07Z_
_Verifier: the agent (gsd-verifier)_
