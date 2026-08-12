---
phase: 01-verified-nix-substitution-walking-slice
verified: 2026-08-12T13:15:25Z
status: gaps_found
score: 7/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/8
  gaps_closed:
    - "Validated publications now enter an Applesauce EventStore only after durable acceptance and drive the custom CacheSelectionModel."
    - "Authenticated kind-10063 BUD-03 server lists now update immutable selection snapshots and feed production source ordering."
    - "Signer mode and writable identity now form a validated, fail-closed write-intent configuration while PUT remains disabled."
  gaps_remaining:
    - "The production main.ts executable does not read any NIXSTR_LIMIT_* environment variables, so operator-supplied limits are silently ignored."
  regressions: []
gaps:
  - truth: "The shipped daemon accepts and validates operator-supplied resource limits instead of silently replacing them with defaults."
    status: partial
    reason: "rawConfigFromEnvironment maps all limit variables, but the import.meta.main environment-name allow-list omits every NIXSTR_LIMIT_* name. The actual executable therefore passes undefined for every limit override."
    artifacts:
      - path: "main.ts"
        issue: "Lines 17-33 map limit keys, but lines 39-49 read only base/signer variables from Deno.env."
      - path: "tests/integration/operator_config_test.ts"
        issue: "Environment mapping tests cover signer fields only and do not execute the production environment collection path with a limit override."
    missing:
      - "Include every supported NIXSTR_LIMIT_* variable in the production environment collection boundary."
      - "Add a discriminating production-entry test proving a non-default limit reaches ValidatedConfig and an invalid override fails before side effects."
---

# Phase 1: Verified Nix Substitution Walking Slice Verification Report

**Phase Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Verified:** 2026-08-12T13:15:25Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure plans 01-10 and 01-11.

## User Flow Coverage

The authoritative MVP story passes the centralized validator with role `Nix cache operator`, the real-client substitution capability, and the outcome `use a decentralized binary cache without modifying Nix`.

| Step | Expected | Codebase evidence | Status |
|---|---|---|---|
| Configure and start | Operator supplies a valid read configuration and the production daemon starts only after validation | `main.ts` → `launchDaemon` → `createApp`; startup ordering tests pass | PARTIAL — custom resource-limit environment variables are not read by the executable |
| Select publication | Latest eligible plaintext event becomes a durable reactive snapshot; invalid, stale, expired, rollback, downgrade, and BUD-15 candidates remain unavailable | `src/protocol/publication.ts`, `src/persistence/state_repository.ts`, EventStore-backed `CacheSelectionModel`; 8 selection tests pass | VERIFIED |
| Discover and resolve | Configured, event-tag, and authenticated BUD-03 sources are ordered and fetched through bounded hostile-network controls | `src/nostr/blossom_servers.ts`, `src/runtime/daemon.ts`, source plan and 25 targeted network/Blossom tests | VERIFIED |
| Serve to Nix | GET/HEAD metadata, narinfo, and NAR use one immutable snapshot and verified bounded streams | `src/nix/http_handler.ts`, `src/hashtree/reader.ts`; HTTP and hostile traversal tests pass | VERIFIED |
| Outcome | Unmodified stock Nix substitutes an absent path solely through production `main.ts` | `tests/e2e/nix_substitution_test.ts`; fresh E2E pass | VERIFIED |

The end-to-end user outcome works, but the operator configuration contract is incomplete in the shipped entry point.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Operator starts the shipped daemon from validated read configuration, including enforceable operator-selected resource limits | FAILED | Parsing/defaults/ceilings are substantive, but `main.ts:39-49` omits all limit variables from the only production `Deno.env.get` loop. |
| 2 | Nix GET/HEAD serves cache metadata, narinfo, and NAR while preserving valid signatures and classifying endorsements independently | VERIFIED | Lossless narinfo protocol tests and eight HTTP integration tests pass. |
| 3 | Publisher-controlled fetches are constrained and reject corrupt or oversized content before use | VERIFIED | Nine address-pinning plus fourteen hostile-Blossom tests cover peer pinning, CIDRs, redirects, framing, deadlines, cancellation, hashes, and budgets. |
| 4 | Large manifests, chunks, and NARs remain ordered, backpressured, and bounded | VERIFIED | Explicit traversal frames and progressive ledgers are production-wired; nested-order, transfer/output, metadata, and cancellation tests pass. |
| 5 | A real stock Nix client substitutes through the production daemon | VERIFIED | Fresh `deno task verify` ran the stock-Nix E2E successfully through `main.ts`. |
| 6 | Selection is exposed through an Applesauce EventStore custom model after durable admission | VERIFIED | `EventStore.model(CacheSelectionModel, ...)` is authoritative; `repository.accept` precedes `store.add`; focused commit/admission/disposal test passes. |
| 7 | Production discovers authenticated BUD-03 kind-10063 Blossom sources | VERIFIED | Relay subscription includes 10063; verified publisher events update the model; `snapshot.bud03Servers` flows into `buildSourcePlan`; two focused tests pass. |
| 8 | Configuration covers explicit signer mode and writable identity without enabling premature writes | VERIFIED | Discriminated `writeIntent`, strict raw identity parser, production env mapping, no-side-effect diagnostics, and PUT-405 tests pass. |

**Score:** 7/8 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `main.ts` | Complete production environment boundary and launcher | PARTIAL | Signer fields are wired, but every limit environment name is omitted from the executable collection loop. |
| `src/nostr/selection.ts` | Durable EventStore-backed custom reactive selection | VERIFIED | Substantive, authoritative, production-wired, and behaviorally tested. |
| `src/nostr/blossom_servers.ts` | Strict authenticated BUD-03 projection | VERIFIED | Filters exact server tags and unsafe URL forms after signature/publisher admission. |
| `src/runtime/daemon.ts` | Production relay/store/source-plan composition | VERIFIED | Subscribes to 17091/10063, wires immutable BUD-03 snapshots, limits, repository, resolver, and handler. |
| `src/config/config.ts` | Aggregate validated configuration and hard ceilings | VERIFIED | Includes read settings, all limit fields, explicit disabled/nip46/local modes, and strict writable identities. |
| `src/network/safe_fetcher.ts`, `src/blossom/blob_fetcher.ts` | Pinned, bounded, verified transport/spooling | VERIFIED | Production-wired and adversarially exercised. |
| `src/hashtree/reader.ts`, `src/nix/http_handler.ts` | Lazy bounded traversal and stock Nix HTTP semantics | VERIFIED | Real data flows from selected root through verified spools to responses. |
| `tests/e2e/nix_substitution_test.ts` | Stock-Nix production acceptance | VERIFIED | Launches `main.ts`, isolates the destination store/substituter, verifies restart/concurrency. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Relay publication | repository | validation + allow-list + `repository.accept` | WIRED | Rejection and transaction-failure paths never enter EventStore. |
| Repository | EventStore/custom model | commit before `store.add`, then `store.model(CacheSelectionModel, ...)` | WIRED | PROT-03 closure is real, not a parallel BehaviorSubject. |
| Kind 10063 relay event | source plan | verified admission → model snapshot → `bud03:` argument | WIRED | TREE-01 production path and immutable snapshot behavior are tested. |
| Config limits | fetcher/resolver/handler | `ValidatedConfig.limits` builds all runtime budgets | WIRED | Defaults and directly supplied `RawConfig` overrides flow correctly. |
| Process environment limits | `RawConfig.limits` | executable `Deno.env.get` allow-list | NOT_WIRED | No `NIXSTR_LIMIT_*` name is read by `import.meta.main`. |
| Signer/write identity environment | typed intent | environment mapper → `parseConfig` discriminated union | WIRED | Inconsistent pairs fail before side effects; PUT stays 405. |
| Selected root | stock Nix response | immutable request snapshot → resolver → streamed response | WIRED | HTTP integration and real-Nix E2E pass. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces real data | Status |
|---|---|---|---|---|
| `CacheSelectionModel` | selected root and BUD-03 list | verified relay events admitted to EventStore after durable acceptance | Yes | FLOWING |
| `buildSourcePlan` | ordered fetch candidates | configured origin + publication tags + snapshot BUD-03 servers | Yes | FLOWING |
| Blob/Hashtree pipeline | requested authenticated bytes | pinned socket → framed body → verified spool → manifests/chunks | Yes | FLOWING |
| Nix handler | cache metadata/NAR response | captured selection → bounded resolver → response stream | Yes | FLOWING |
| Production limit overrides | operator environment values | `Deno.env.get` loop | No | DISCONNECTED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full quality/behavior matrix | `deno task verify` | fmt/lint/check; 12 protocol, 48 integration, 1 stock-Nix E2E passed | PASS |
| EventStore selection with the plan's narrow command | `deno test --allow-read --allow-write tests/integration/publication_selection_test.ts` | module load failed because Applesauce `debug` requires env access | FAIL (test-command regression; canonical integration task passes with `--allow-env`) |
| Production limit environment wiring | inspect `main.ts:17-33` against `main.ts:39-49` | mapper knows variables, executable never reads them | FAIL |
| MVP story format | centralized `user-story.validate` query | valid; all role/capability/outcome slots extracted | PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. Step 7c is not applicable.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| PROT-02 | SATISFIED | Strict event/authentication/tag/time validation precedes admission. |
| PROT-03 | SATISFIED | Durable acceptance precedes EventStore admission; custom model is the reactive authority. |
| PROT-04 | SATISFIED | SQLite timestamp/id watermark blocks restart rollback. |
| PROT-05 | SATISFIED | Durable signed history and explicit unsigned consent are tested. |
| PROT-06 | SATISFIED | Canonical plaintext nhash accepted; BUD-15 type 5 rejected. |
| TREE-01 | SATISFIED | Configured, publication-tag, and authenticated BUD-03 sources reach production in order. |
| TREE-02 | SATISFIED | Incremental SHA-256 verified spooling gates parsing/serving. |
| TREE-03 | SATISFIED | Address pinning, per-hop policy, redirect limits, canonical CIDRs, and deadlines pass. |
| TREE-04 | SATISFIED | Lazy deduplicated traversal enforces mandatory bounds. |
| TREE-05 | SATISFIED | Streams, owner-only spools, ordered traversal, backpressure, and cancellation pass. |
| READ-01 | SATISFIED | Stock-compatible nix-cache-info GET/HEAD behavior passes. |
| READ-02 | SATISFIED | Narinfo and referenced NAR GET/HEAD paths pass. |
| READ-03 | SATISFIED | One immutable selection/source snapshot is captured per request. |
| READ-04 | SATISFIED | Valid Sig lines remain unchanged; endorsement is independently classified by key bytes. |
| READ-07 | SATISFIED | Real stock Nix substitutes an initially absent store path through production main. |
| OPER-01 | BLOCKED | Signer/write identity closure is valid, but the shipped executable silently ignores every operator limit override. |

No Phase 1 requirement is orphaned from the eleven plan frontmatters.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `main.ts` | 39 | Environment field-list drift from `rawConfigFromEnvironment` | BLOCKER | Operator-selected safety limits cannot reach production. |
| `tests/integration/operator_config_test.ts` | 94 | Mapper-only environment test | WARNING | The green test cannot detect omissions in the executable's separate allow-list. |
| `01-10-PLAN.md` / selection command | — | Exact narrow-permission test command is stale | WARNING | Direct command fails before tests; the canonical suite adds `--allow-env` and passes all behavior. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers, placeholder implementations, whole-NAR buffering, automatic publisher redirects, or unbounded digest APIs were found in phase source files.

### Human Verification Required

None. The stock client flow, state transitions, cancellation/ordering invariants, and closure items have automated behavioral evidence. The dependency-legitimacy checkpoint was completed during plan execution rather than deferred to end-of-phase UAT.

### Gaps Summary

Plans 01-10 and 01-11 genuinely close all three previously reported blockers: PROT-03 now uses an authoritative custom Applesauce model, TREE-01 has authenticated production BUD-03 discovery, and signer/write-identity intent is validated without enabling Phase 3 behavior. Regression checks and the full 61-test matrix confirm the read walking slice remains operational.

Phase 1 still cannot pass because the shipped entry point maintains a second, incomplete environment-name list. All resource-limit variables mapped by `rawConfigFromEnvironment` are absent from that list, so a real operator cannot tighten or raise the validated limits through `main.ts`; the values are silently discarded and defaults take effect. This is not deferred to a later phase and directly leaves OPER-01 incomplete.

---

_Verified: 2026-08-12T13:15:25Z_
_Verifier: the agent (gsd-verifier)_
