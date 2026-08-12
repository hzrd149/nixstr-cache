---
phase: 01-verified-nix-substitution-walking-slice
verified: 2026-08-12T13:20:00Z
status: gaps_found
score: 5/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 1/5
  gaps_closed:
    - "Production main.ts now composes and launches the daemon, enforces live allow-lists, and restores corrupt rows safely."
    - "SafeFetcher now enforces canonical CIDRs, response-lifetime deadlines, strict framing, and cancellation."
    - "Hashtree traversal now preserves nested chunk order and enforces per-blob, aggregate-transfer, aggregate-output, and narinfo limits."
    - "The stock-Nix E2E now launches production main.ts."
  gaps_remaining:
    - "PROT-03 requires Applesauce EventStore/custom reactive casts, but selection uses a standalone RxJS BehaviorSubject."
    - "TREE-01 requires live BUD-03 kind-10063 discovery, but production supplies only configured and publication-tag sources."
    - "OPER-01 requires signer mode and writable-identity configuration, but RawConfig/ValidatedConfig expose neither."
  regressions: []
gaps:
  - truth: "Validated publications enter Applesauce state and the latest eligible identity is exposed through an Applesauce reactive cast."
    status: failed
    reason: "The relay is Applesauce-based, but the trusted selection state is a standalone RxJS BehaviorSubject; applesauce-core EventStore/custom casts are never imported or constructed."
    artifacts:
      - path: "src/nostr/selection.ts"
        issue: "Imports BehaviorSubject, Observable, and Subscription directly from rxjs and has no EventStore/cast boundary."
    missing:
      - "Admit only validated publications to an Applesauce EventStore and expose selection through the required custom reactive cast/model."
  - truth: "Production source discovery includes the publisher's ordered BUD-03 kind-10063 server list."
    status: failed
    reason: "buildSourcePlan supports a bud03 argument and its unit/integration test passes, but production never loads kind 10063 and never supplies bud03."
    artifacts:
      - path: "src/runtime/daemon.ts"
        issue: "Relay subscription requests only kind 17091; resolverFor passes configured and event sources but no bud03 sources."
      - path: "src/blossom/source_plan.ts"
        issue: "BUD-03 ordering code is substantive but production-orphaned."
    missing:
      - "Load the selected publisher's valid kind-10063 server list and wire it into buildSourcePlan in authenticated order."
  - truth: "Validated operator configuration covers signer mode and writable identity as required by OPER-01."
    status: failed
    reason: "The configuration covers read startup, publishers, relays, paths, and limits, but has no signer-mode or writable-identity fields or validation."
    artifacts:
      - path: "src/config/config.ts"
        issue: "RawConfig and ValidatedConfig contain no signer mode or writable identity."
      - path: "main.ts"
        issue: "No signer/writable-identity environment variables are read."
    missing:
      - "Add and validate signer-mode and writable-identity configuration, including disabled read-only values if writes remain deferred."
deferred:
  - truth: "Several publishers are merged in stable configured priority."
    addressed_in: "Phase 2"
    evidence: "Phase 2 goal and success criterion 1 explicitly own the ordered multi-publisher merged view (PROT-01/READ-05/READ-06)."
---

# Phase 1: Verified Nix Substitution Walking Slice Verification Report

**Phase Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Verified:** 2026-08-12T13:20:00Z
**Status:** gaps_found
**Re-verification:** Yes — after plans 01-07, 01-08, and 01-09.

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Configure/start | Valid read configuration starts the shipped daemon | `main.ts` calls `launchDaemon`; production launcher integration test passes | VERIFIED |
| Select | Valid allow-listed plaintext publication becomes the durable snapshot | Validator, repository, selector, and seven selection tests pass | VERIFIED |
| Resolve safely | Publisher bytes cross pinned, bounded, hash-verified transport and ordered Hashtree traversal | Address-pinning and hostile-Blossom suites pass | VERIFIED |
| Serve | Stock Nix receives snapshot-bound metadata, narinfo, and streamed NAR | HTTP suite passes; signatures are preserved and endorsements classified | VERIFIED |
| Substitute/outcome | An unmodified stock Nix substitutes solely through production `main.ts` | `deno task test:nix-e2e`: 1 passed | VERIFIED |

The narrow MVP user flow is operational. The phase contract nevertheless remains incomplete because three explicitly mapped requirements and PLAN must-haves are absent from production wiring.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Operator starts validated read configuration and only the latest eligible plaintext publication remains selected across restart | VERIFIED | Production launcher plus seven publication-selection tests cover invalid, unauthorized, stale, tie, expiry, rollback, downgrade, transaction failure, corrupt restore, and restart paths. |
| 2 | Nix GET/HEAD serves cache metadata, narinfo, and NAR while preserving valid signatures and identifying endorsements separately | VERIFIED | `src/nix/http_handler.ts`, `src/protocol/narinfo.ts`, protocol and HTTP integration tests. |
| 3 | Publisher fetches are network/traversal bounded and reject corrupt or oversized content before use | VERIFIED | Nine address-pinning and fourteen hostile-Blossom tests pass, including CIDR normalization, redirects, deadlines, framing, cancellation, hash mismatch, and budgets. |
| 4 | Large manifests, chunks, and NARs remain ordered, backpressured, and memory/disk bounded | VERIFIED | Explicit traversal frames, progressive ledgers, bounded narinfo reader, cancellation cleanup, and focused passing behavioral tests. |
| 5 | A real Nix CLI substitutes through the shipped daemon | VERIFIED | Stock Nix E2E launches `main.ts`, substitutes after restart and concurrently, and passes. |
| 6 | Selection is exposed through Applesauce EventStore/custom reactive casts | FAILED | `src/nostr/selection.ts` uses only RxJS `BehaviorSubject`; no EventStore/cast exists. |
| 7 | Production discovers BUD-03 kind-10063 Blossom sources | FAILED | Source-plan helper accepts `bud03`, but `src/runtime/daemon.ts` subscribes only to kind 17091 and never passes BUD-03 data. |
| 8 | Operator configuration covers signer mode and writable identity | FAILED | These OPER-01 fields do not exist in config or environment composition. |

**Score:** 5/8 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `main.ts`, `src/runtime/daemon.ts` | Runnable production composition | VERIFIED | Main launches concrete relay, repository, selection, resolver, handler, and signal-safe lifecycle. |
| `src/nostr/selection.ts`, `src/persistence/state_repository.ts` | Durable authorized reactive selection | PARTIAL | Behavior is tested and durable; required Applesauce store/cast is absent. |
| `src/network/safe_fetcher.ts`, `src/blossom/blob_fetcher.ts` | Safe decoded verified spool | VERIFIED | Substantive, production-wired, and adversarially tested. |
| `src/hashtree/reader.ts` | Lazy ordered bounded resolver | VERIFIED | Production-wired with configured request budgets and behavior tests. |
| `src/nix/http_handler.ts` | Snapshot-bound bounded GET/HEAD | VERIFIED | Narinfo bounded read and direct NAR streaming are separately wired. |
| `src/blossom/source_plan.ts` | configured/event/BUD-03 ordering | PARTIAL | Helper and test support all tiers; BUD-03 tier is not fed by production. |
| `tests/e2e/nix_substitution_test.ts` | Stock Nix through production daemon | VERIFIED | Spawns `main.ts`, not a test-owned daemon. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Config publishers/identities | selection admission | validation then allow-list before repository accept | WIRED | Live and restored candidates are checked. |
| Relay events | Applesauce reactive state | EventStore/custom cast | NOT_WIRED | RelayPool supplies an Observable, but selection bypasses applesauce-core state/casts. |
| Publisher | BUD-03 kind 10063 | loader/store to source plan | NOT_WIRED | No kind-10063 subscription/loader exists. |
| SafeFetcher | BlobFetcher | decoded lifetime-owned response stream | WIRED | Deadlines/framing/cancellation persist through spool EOF. |
| Config limits | RequestBudget/handler | per-request construction | WIRED | Transfer, output, metadata, traversal, redirect, attempt, concurrency, and deadline limits are supplied. |
| Selection snapshot | resolver/handler | one capture before awaits | WIRED | Snapshot mutation test passes. |
| Stock Nix E2E | production launcher | child process executing `main.ts` | WIRED | E2E passes. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Production selector | selected root | RelayPool event → validation/allow-list → SQLite commit → subject | Yes | FLOWING (wrong reactive abstraction for PROT-03) |
| Source planner | ordered origins | configured URL + publication blossom tags | Yes | PARTIAL (BUD-03 disconnected) |
| Blob/Hashtree path | verified requested bytes | pinned socket → decoded spool → SHA-256 → manifests/chunks | Yes | FLOWING |
| Nix handler | cache response | immutable selection → resolver → bounded metadata/direct NAR stream | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Complete quality and behavior matrix | `deno task verify` | fmt/lint/check passed; 12 protocol, 38 integration, 1 stock-Nix E2E passed | PASS |
| Production daemon startup/lifecycle | Included named integration tests | invalid startup has no side effects; restore-before-bind and cleanup pass | PASS |
| Transport/traversal adversarial behavior | Included address-pinning and hostile-Blossom suites | 23/23 passed | PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. Step 7c is not applicable.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| PROT-02 | 01-02, 01-07 | SATISFIED | Strict cryptographic/tag/time validation and pre-admission authorization tests pass. |
| PROT-03 | 01-02, 01-07 | BLOCKED | Ordering/atomicity behavior passes, but the required Applesauce EventStore/custom-cast exposure is absent. |
| PROT-04 | 01-02 | SATISFIED | SQLite watermark/tie state rejects rollback across restart. |
| PROT-05 | 01-02 | SATISFIED | Durable signed-history/consent transition test passes. |
| PROT-06 | 01-02 | SATISFIED | Strict plaintext nhash test rejects type-5 BUD-15 roots. |
| TREE-01 | 01-03 | BLOCKED | Ordering helper supports BUD-03 input, but production does not discover kind 10063. |
| TREE-02 | 01-03 | SATISFIED | Incremental SHA-256 spool gates exposure and retries after mismatch. |
| TREE-03 | 01-01, 01-03, 01-08 | SATISFIED | Canonical address, exact-peer, redirect, framing, and deadline tests pass. |
| TREE-04 | 01-03, 01-09 | SATISFIED | Lazy traversal and all configured ledgers are wired and tested. |
| TREE-05 | 01-03, 01-08, 01-09 | SATISFIED | Backpressured streams, owner-only spools, cancellation, and bounded metadata pass. |
| READ-01 | 01-04 | SATISFIED | GET/HEAD nix-cache-info behavior passes. |
| READ-02 | 01-04 | SATISFIED | Narinfo and NAR GET/HEAD resolution passes for the Phase-1 single selected tree. |
| READ-03 | 01-04 | SATISFIED | Immutable request snapshot test passes. |
| READ-04 | 01-04 | SATISFIED | Signature byte preservation and independent key-byte endorsement tests pass. |
| READ-07 | 01-05, 01-07 | SATISFIED | Real stock-Nix substitution through `main.ts` passes. |
| OPER-01 | 01-01, 01-07 | BLOCKED | Read config/startup works, but signer mode and writable identity named by the requirement are absent. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/nostr/selection.ts` | 1,46 | Planned/required Applesauce state replaced by standalone RxJS subject | BLOCKER | PROT-03 implementation contract is not met. |
| `src/runtime/daemon.ts` | 37,128 | Only kind 17091 is loaded; `bud03` is omitted from source plan | BLOCKER | TREE-01 production behavior is incomplete. |

No unreferenced TBD/FIXME/XXX debt markers or implementation placeholders were found in phase source files. Whole-body materialization remains only for manifests already bounded by `manifestWireBytes`; NAR bodies stay streamed.

### Human Verification Required

None for the verdict. The plan's package-legitimacy checkpoint was an execution-time blocking approval completed before lockfile mutation; no unresolved end-of-phase human check remains in the executed plan artifacts.

### Gaps Summary

Plans 01-07 through 01-09 genuinely close every gap from the prior report, and the roadmap's five user-flow success criteria now execute successfully. Phase completion still fails goal-backward verification because the phase explicitly maps PROT-03, TREE-01, and OPER-01, and their required production artifacts/wiring are observably absent. These concerns are not specifically assigned to a later milestone phase, so they cannot be deferred.

---

_Verified: 2026-08-12T13:20:00Z_
_Verifier: the agent (gsd-verifier)_
