---
phase: 03-signer-gated-writable-cache
verified: 2026-08-12T15:12:33Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 9/10
  gaps_closed:
    - "Production NIP-46 authorization, ownership, failure, shutdown, and secret-safe diagnostic lifecycle now has deterministic behavioral coverage."
  gaps_remaining: []
  regressions: []
---

# Phase 3: Signer-Gated Writable Cache Verification Report

**Phase Goal:** As a Nix cache operator, I want to stage complete store objects through an authorized signer into a private writable overlay, so that uploads become safely readable without exposing incomplete data or publishing prematurely.
**Verified:** 2026-08-12T15:12:33Z
**Status:** passed
**Re-verification:** Yes — after human-verification gap closure

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Configure signer | Select exactly one local or NIP-46 signer-owned default/named identity | `src/config/config.ts`; signer ownership comparison in `src/signer/capability.ts:79-124`; production NIP-46 fixture tests | ✓ |
| Upload | PUT standard Nix routes through a bounded stream into durable staging | `src/nix/http_handler.ts:94-152`; `src/persistence/write_repository.ts:481-575`; focused tests pass | ✓ |
| Complete dependencies | Narinfo, NAR, and references form a dependency-closed generation | `src/write/eligibility.ts:33-75`; reverse/cycle/restart tests pass | ✓ |
| Read overlay | Complete content is signer-first; incomplete staging is not a resolver source | `src/write/overlay.ts:16-64`; handler snapshot and overlay tests pass | ✓ |
| Freeze/build | Five quiet or sixty sustained seconds freezes once and builds pending plaintext tree | `src/write/batch_scheduler.ts:44-90`; batch/writer tests pass | ✓ |
| Outcome | Upload is safely readable without incomplete exposure or premature publication | Immutable overlay + separate pending-candidate tables/API; negative production scan test passes | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Local or NIP-46 signer owns exactly one writable identity and readiness fails closed on missing prerequisites | ✓ VERIFIED | Local lifecycle tests plus production-boundary NIP-46 tests cover connect/auth readiness for 17091/37091, mismatch/denial/failure, shutdown, and secret-safe diagnostics |
| 2 | Standard Nix PUT paths stream durably with bounded memory and identical retries are idempotent | ✓ VERIFIED | Incremental read/hash/write and atomic immutable promotion at `write_repository.ts:481-561`; PUT/idempotency/conflict/restart tests pass |
| 3 | Complete staged objects are readable signer-first while missing NAR/narinfo/references remain invisible | ✓ VERIFIED | Fixed-point closure at `eligibility.ts:33-75`, immutable overlay at `overlay.ts:16-64`; completion/cycle/restart tests pass |
| 4 | Five quiet seconds or sixty sustained seconds freezes one serialized batch and deterministically builds a plaintext COW tree | ✓ VERIFIED | Dual timers/token claim/serial chain at `batch_scheduler.ts:44-90`; timing, race, serialization, determinism and reuse tests pass |
| 5 | Readiness snapshot gates PUT before staging side effects | ✓ VERIFIED | One `write.current()` capture and 405 gate at `http_handler.ts:94-101`; fail-closed tests pass |
| 6 | Staging quota, immutable routes, and owner-only durable files survive restart | ✓ VERIFIED | Per-body/aggregate checks, 0600 files, durable SQLite rows and restart tests pass |
| 7 | Dependency closure is bounded, deterministic, supports reverse arrival, and rejects unanchored cycles | ✓ VERIFIED | Visited/metadata bounds and deterministic fixed point; reverse/cycle test passes |
| 8 | Requests capture an immutable signer/publisher snapshot and signer narinfo pins its NAR generation | ✓ VERIFIED | Request-entry snapshot plus signer route registry; generation mutation test passes |
| 9 | Root and complete reachable inventory persist only as an unpublished pending candidate without changing committed read generation | ✓ VERIFIED | Transactional pending inventory at `write_repository.ts:409-461`; restart and unchanged-generation tests pass |
| 10 | Phase 3 performs no cache-root signing, Blossom replication, relay publication, or pending-root promotion | ✓ VERIFIED | Scoped source scan plus `phase three daemon contains no signing upload publish or pending-root promotion` test passes; NIP-46 `publishMethod` is transport for signer RPC only |

**Score:** 10/10 truths verified (0 behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/signer/capability.ts` | Status-only signer lifecycle and ownership | ✓ VERIFIED | Substantive, used by daemon; secrets excluded from state and owned buffers zeroed |
| `src/persistence/write_repository.ts` | Durable staging, generations, batches, pending inventory | ✓ VERIFIED | Substantive and used across PUT, overlay, scheduler, writer |
| `src/write/eligibility.ts` | Bounded dependency closure | ✓ VERIFIED | Substantive, wired from staging callbacks |
| `src/write/overlay.ts` | Immutable signer-first generations | ✓ VERIFIED | Substantive, captured by HTTP handler |
| `src/write/batch_scheduler.ts` | 5s/60s serialized scheduler | ✓ VERIFIED | Substantive, daemon-wired and behavior-tested |
| `src/hashtree/writer.ts` | Canonical bounded plaintext tree writer | ✓ VERIFIED | Streams fixed chunks; canonical vectors/determinism/reuse pass |
| Phase test artifacts | Behavioral evidence | ✓ VERIFIED | All declared files exist and participate in `deno task verify` |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| HTTP handler | signer capability | captured readiness | ✓ WIRED | Generic probe missed naming, manual trace confirms one request-entry snapshot |
| HTTP handler | write repository | streamed staging | ✓ WIRED | Request body passed directly to `stage()` |
| daemon | signer capability | start/close lifecycle | ✓ WIRED | Starts after validated composition; closes during shutdown |
| eligibility | repository | reverse-edge fixed point | ✓ WIRED | Durable affected candidates feed atomic overlay commit |
| HTTP/merged read | overlay | signer-first snapshot/provenance | ✓ WIRED | Captured generation resolves before publisher layers |
| scheduler | repository | token compare-and-claim | ✓ WIRED | Atomic freeze and durable batch membership |
| writer | protocol encoder/repository | canonical blobs and pending inventory | ✓ WIRED | Encoder output tested by decoder; pending stored transactionally |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| PUT staging | request body | `Request.body` → incremental file/hash → SQLite route row | Yes | ✓ FLOWING |
| Signer overlay | route entries | committed generation rows → frozen map → response stream | Yes | ✓ FLOWING |
| Pending tree | frozen overlay entries | batch rows → staged files → immutable candidate blobs/inventory | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Protocol and writer behavior | `deno task test` | 18 passed, 0 failed | ✓ PASS |
| Production NIP-46 boundary | `deno test ... tests/integration/nip46_signer_test.ts` | 2 passed, 0 failed | ✓ PASS |
| Production/integration behavior | `deno task test:integration` | 74 passed, 0 failed | ✓ PASS |
| Stock Nix compatibility regression | `deno task test:nix-e2e` | 1 passed, 0 failed | ✓ PASS |
| All quality gates | `deno task verify` | fmt, lint, check, all suites passed | ✓ PASS |

### Probe Execution

No phase probe scripts were declared or found. Step 7c: SKIPPED (no probes).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| WRIT-01 | 03-01 | ✓ SATISFIED | Exact identity ownership gate |
| WRIT-02 | 03-01 | ✓ SATISFIED | Local signer plus actual production NostrConnectSigner boundary exercised by deterministic encrypted relay fixture |
| WRIT-03 | 03-01 | ✓ SATISFIED | Conjunctive readiness and 405 behavior tested |
| WRIT-04 | 03-01 | ✓ SATISFIED | Stream, bounds, persistence, retry/conflict tests pass |
| WRIT-05 | 03-02 | ✓ SATISFIED | Dependency closure/cycle/reverse arrival tests pass |
| WRIT-06 | 03-02 | ✓ SATISFIED | Signer-first immutable overlay/invisibility tests pass |
| PUBL-01 | 03-03 | ✓ SATISFIED | Quiet/max/race/serialization tests pass |
| PUBL-02 | 03-03 | ✓ SATISFIED | Canonical deterministic COW/pending tests pass |

No orphaned Phase 3 requirements were found.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers, placeholders, empty implementations, or hardcoded hollow data were found in Phase 3 production files. The daemon's `publishMethod` occurrence is required NIP-46 RPC transport and does not sign or publish a cache-root event.

### Human Verification Required

None.

### Gaps Summary

No gaps remain. Automated evidence establishes both signer modes, streamed durable PUT, dependency-closed signer overlay, deterministic batching/tree construction, restart durability, and absence of premature publication.

---

_Verified: 2026-08-12T15:12:33Z_
_Verifier: the agent (gsd-verifier)_
