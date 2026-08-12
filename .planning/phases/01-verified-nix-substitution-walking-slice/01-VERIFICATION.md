---
phase: 01-verified-nix-substitution-walking-slice
verified: 2026-08-12T12:04:16Z
status: gaps_found
score: 1/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 5/5
  gaps_closed: []
  gaps_remaining:
    - "Production daemon composition is absent"
    - "Live publisher admission bypasses the whitelist"
    - "Publisher-controlled fetches are not fully bounded or SSRF-safe"
    - "Hashtree streaming can reverse chunks and exceed disk/memory bounds"
  regressions: []
gaps:
  - truth: "Operator can start the daemon from validated read configuration and see only the latest eligible plaintext publication selected safely across restarts."
    status: failed
    reason: "The shipped main entry point exits 1 without composing the daemon, and live event admission never checks the configured publisher/identity whitelist."
    artifacts:
      - path: "main.ts"
        issue: "import.meta.main prints that composition is external and exits 1."
      - path: "src/nostr/selection.ts"
        issue: "accept() validates and persists any signed publication delivered by the Observable; identities is used only during restore."
    missing:
      - "Production dependency composition and signal-driven launcher"
      - "Live-stream publisher and cache-identity allow-list enforcement before repository admission"
      - "A startup smoke test using the shipped entry point"
  - truth: "Every publisher-controlled fetch is constrained by configured network and traversal limits, and corrupt or oversized content is rejected before use."
    status: failed
    reason: "Response deadlines end after headers, idleTimeoutMs is unused, expanded/mapped IPv6 forms bypass SSRF filtering, HTTP chunked framing is not decoded, and exceptional blob reads do not cancel the response stream."
    artifacts:
      - path: "src/network/safe_fetcher.ts"
        issue: "Abort listener is removed before returning the body; no idle deadline; textual IPv6 filtering is incomplete; Transfer-Encoding is ignored."
      - path: "src/blossom/blob_fetcher.ts"
        issue: "Exceptional reader exits release the lock without cancelling the body."
    missing:
      - "Request-lifetime total and resetting idle deadlines"
      - "Canonical IP parsing/CIDR checks including expanded and IPv4-mapped IPv6"
      - "Strict HTTP/1.1 transfer-framing validation and chunk decoding"
      - "Response cancellation on every exceptional spool exit"
  - truth: "Large manifests, chunks, and NARs pass through verification, temporary storage, and HTTP responses with correct order, backpressure, and bounded memory/disk."
    status: failed
    reason: "File manifests reverse multiple raw children, publisher-declared raw sizes replace the transfer ceiling, no total output/transfer budget exists, and narinfo is materialized without the configured metadata ceiling."
    artifacts:
      - path: "src/hashtree/reader.ts"
        issue: "Reverse traversal plus chunks.unshift reverses raw chunk order; declaredSize becomes maxTransferBytes and can be enormous."
      - path: "src/nix/http_handler.ts"
        issue: "new Response(resolved.body).bytes() buffers narinfo without decodedMetadataBytes enforcement."
    missing:
      - "Ordered nested multi-chunk traversal with a focused behavioral test"
      - "Configured per-blob and per-request transferred/output byte budgets"
      - "Bounded narinfo decoding using decodedMetadataBytes"
  - truth: "A real nix CLI substitutes an uncached store path through the shipped daemon and verifies metadata and NAR."
    status: failed
    reason: "The real-Nix test proves protocol compatibility only through a daemon implementation embedded in tests/e2e/nix_substitution_test.ts; it never launches main.ts, while main.ts cannot start."
    artifacts:
      - path: "tests/e2e/nix_substitution_test.ts"
        issue: "The child process runs this test file with --daemon and manually composes repository, selector, fetcher, resolver, and HTTP server."
      - path: "main.ts"
        issue: "The operator-facing entry point exits 1."
    missing:
      - "Run the same production launcher in the stock-Nix E2E"
deferred:
  - truth: "Several publishers are selected in stable configured priority rather than relay arrival order."
    addressed_in: "Phase 2"
    evidence: "Phase 2 goal and success criterion 1 explicitly introduce several trusted publishers and stable priority order; PROT-01 is mapped to Phase 2."
---

# Phase 1: Verified Nix Substitution Walking Slice Verification Report

**Phase Goal:** As a Nix cache operator, I want to point a real Nix client at the daemon and safely substitute an uncached store path from a valid plaintext Nostr-published cache, so that I can use a decentralized binary cache without modifying Nix.
**Verified:** 2026-08-12T12:04:16Z
**Status:** gaps_found
**Re-verification:** Yes — the prior 5/5 report contained no structured gaps, so all roadmap truths were re-evaluated from code.

## User Flow Coverage

The roadmap goal passes the centralized MVP user-story validator. The operator flow does not complete through the shipped program.

| Step | Expected | Codebase evidence | Status |
|---|---|---|---|
| Configure/start | Valid config starts the production daemon | `parseConfig()` is substantive, but `main.ts` exits 1 and no launcher supplies `AppDependencies` | FAILED |
| Admit publication | Only a configured publisher can become selected | `startPublicationSelection.accept()` has no whitelist check | FAILED |
| Resolve safely | Blossom data remains address-safe, deadline-bounded, ordered, and size-bounded | Missing body deadlines/chunk decoding, IPv6 bypasses, reversed chunks, and unbounded declared raw sizes | FAILED |
| Serve Nix protocol | GET/HEAD metadata and NAR use one immutable snapshot and preserve valid signatures | Handler/protocol tests and source support these component behaviors | VERIFIED |
| Substitute | Stock Nix uses the shipped daemon | E2E uses a test-only daemon entry point; production `main.ts` is not runnable | FAILED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Valid startup selects only the latest eligible plaintext publication across restarts | FAILED | Production startup is absent and live events bypass the configured whitelist (`main.ts:29-34`, `src/nostr/selection.ts:68-82`). Freshness/downgrade logic within an identity is otherwise substantive and tested. |
| 2 | Nix GET/HEAD serves cache metadata, narinfo, and NAR while preserving valid signatures and classifying endorsement separately | VERIFIED | `src/nix/http_handler.ts`, `src/protocol/narinfo.ts`, four passing focused narinfo tests, and snapshot HTTP tests implement this component contract. The review demand to strip undeclared signatures is contrary to `NIP.md:522-533` and READ-04. |
| 3 | Every publisher fetch is network/traversal bounded and rejects corrupt/oversized data before use | FAILED | Total/idle deadlines do not cover bodies, IPv6 forms bypass SSRF policy, transfer framing is ignored, and exceptional body reads are not cancelled. |
| 4 | Large manifests, chunks, and NARs remain correctly ordered, backpressured, and memory/disk bounded | FAILED | `chunks.unshift()` reverses multi-chunk files; declared sizes can become effectively unlimited transfer ceilings; narinfo is fully buffered without its configured ceiling. |
| 5 | A real Nix CLI substitutes through the shipped daemon | FAILED | The E2E does invoke stock Nix, but its child runs `tests/e2e/nix_substitution_test.ts --daemon`; `main.ts` exits 1. |

**Score:** 1/5 truths verified (0 present-but-behavior-unverified).

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Cross-publisher deterministic priority | Phase 2 | Phase 2 introduces the ordered multi-publisher merged cache and owns PROT-01. This does not excuse Phase 1's live whitelist bypass. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/config/config.ts` | Validated startup and hard ceilings | VERIFIED | Substantive parser with defaults and ceilings. |
| `src/nostr/selection.ts` | Whitelisted, durable reactive publication selection | PARTIAL | Validation and durable same-identity freshness exist; whitelist is not enforced on live admission. Uses RxJS `BehaviorSubject`, not an Applesauce reactive cast/store. |
| `src/network/safe_fetcher.ts` | Address-pinned, deadline-bound HTTP transport | STUB/UNSAFE | Socket pinning exists, but essential body lifetime, framing, idle timeout, and IPv6 safety are incomplete. |
| `src/hashtree/reader.ts` | Bounded lazy ordered traversal | PARTIAL | Manifest limits exist; raw output budgets and correct multi-chunk order do not. |
| `src/nix/http_handler.ts` | Snapshot-bound GET/HEAD | PARTIAL | Routes work, but narinfo metadata bound is disconnected. |
| `main.ts` | Runnable daemon entry point | STUB | Deliberately exits 1 when invoked. |
| `tests/e2e/nix_substitution_test.ts` | Stock Nix through production daemon | PARTIAL | Real Nix acceptance is valuable, but the test embeds its own launcher and bypasses `main.ts`. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Validated config publisher list | live selection | admission allow-list | NOT_WIRED | `publisherPubkeys` never reaches `startPublicationSelection.accept()`. |
| SafeFetcher deadlines | returned response body | abort/idle wrapper through EOF | NOT_WIRED | Listener is removed before body consumption and idle timeout is absent. |
| Config metadata limit | narinfo decoder | bounded read | NOT_WIRED | `decodedMetadataBytes` is not used by the handler. |
| Selected snapshot | resolver | capture once before awaits | WIRED | Handler captures `selection.current()` once and resolver uses that snapshot. |
| Production entry point | app composition | concrete `AppDependencies` | NOT_WIRED | `run()` is exported, but main mode exits. |
| Stock Nix E2E | production entry point | spawned daemon | NOT_WIRED | It spawns the test module itself. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces real data | Status |
|---|---|---|---|---|
| Publication selector | selected root | live relay Observable → validation → SQLite | Yes, but accepts untrusted publishers | UNSAFE |
| Blob fetcher | verified blob file | pinned HTTP socket → spool → SHA-256 | Yes, but body can stall and exceed intended aggregate bounds | UNSAFE |
| Path resolver | requested file bytes | verified manifests/raw blobs | Yes, but nested raw chunks can be reversed | INCORRECT |
| Nix handler | narinfo/NAR response | immutable selection → resolver | Yes; narinfo has an unbounded materialization step | PARTIAL |
| `main.ts` | running daemon | environment configuration | No concrete dependency graph | DISCONNECTED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| MVP story is canonical | `gsd-tools query user-story.validate ... --pick valid` | `true` | PASS |
| Expanded/mapped IPv6 loopback is rejected | `deno eval` calling `isForbiddenAddress()` | expanded `0:0:0:0:0:0:0:1` and `::ffff:7f00:1` returned `false` | FAIL |
| Shipped daemon starts | `timeout 5s deno run --allow-env --allow-net main.ts` | exit 1: composition is external | FAIL |
| Narinfo signature semantics | `deno test tests/protocol/narinfo_test.ts` | 4 passed | PASS |
| Same-identity freshness transitions | focused `publication_selection_test.ts` | 5 passed | PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. The full suite was not repeated because passing-suite narration cannot resolve the directly observable unsafe paths; focused tests and commands above supplied discriminating evidence.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| PROT-02 | 01-02 | BLOCKED | Cryptographic validation exists, but non-whitelisted valid events are selected, so not every eligibility rule is enforced. |
| PROT-03 | 01-02 | BLOCKED | Same-identity NIP-01 ordering is durable, but the implementation exposes through RxJS `BehaviorSubject`, not the required Applesauce reactive casts/store; live global behavior is arrival-dependent. |
| PROT-04 | 01-02 | SATISFIED | SQLite timestamp/event-id state and focused restart/stale tests. |
| PROT-05 | 01-02 | SATISFIED | Durable signed-history consent policy and focused test. |
| PROT-06 | 01-02 | SATISFIED | Strict plaintext nhash decoder and BUD-15 rejection tests/source. |
| TREE-01 | 01-03 | SATISFIED | Source-plan code orders configured, event-tag, and BUD-03 sources with canonical deduplication. |
| TREE-02 | 01-03 | SATISFIED | BlobFetcher spools and hashes before returning a `VerifiedBlob`; mismatch bytes are removed. |
| TREE-03 | 01-01/01-03 | BLOCKED | Expanded/mapped IPv6 bypasses and body deadlines/HTTP framing are incomplete. |
| TREE-04 | 01-03 | BLOCKED | Manifest traversal counters exist, but publisher-declared raw sizes bypass transfer ceilings and multi-chunk ordering is wrong. |
| TREE-05 | 01-03 | BLOCKED | Streaming primitives exist, but disk/output is unbounded by request and narinfo is whole-buffered without its ceiling. |
| READ-01 | 01-04 | SATISFIED | `nix-cache-info` GET/HEAD component behavior is tested. |
| READ-02 | 01-04 | SATISFIED | Narinfo/NAR GET/HEAD routing is tested, subject to the production-launch and traversal gaps. |
| READ-03 | 01-04 | SATISFIED | Snapshot is captured once before resolution; integration tests exercise root changes. |
| READ-04 | 01-04 | SATISFIED | All syntactically valid Sig fields round-trip unchanged and endorsement uses declared key bytes, exactly as `NIP.md` requires. |
| READ-07 | 01-05 | BLOCKED | Stock Nix succeeds against a test-only daemon composition, not the shipped entry point. |
| OPER-01 | 01-01/01-04 | BLOCKED | Configuration validation exists, but an operator cannot start the daemon from it. |

All 16 Phase 1 IDs are accounted for. No orphaned Phase 1 requirements were found.

### Review Finding Adjudication and Anti-Patterns

| Finding | Verdict | Phase impact |
|---|---|---|
| CR-01 whitelist bypass | CONFIRMED BLOCKER | Fails SC1 / PROT-02. |
| CR-02 arrival-dependent publisher selection | CONFIRMED, DEFERRED | Multi-publisher priority is explicitly Phase 2; Phase 1 still must enforce its whitelist. |
| CR-03 response-body deadlines absent | CONFIRMED BLOCKER | Fails SC3 / TREE-03 and bounded resources. |
| CR-04 IPv6 SSRF variants | CONFIRMED BLOCKER | Focused command reproduces it. |
| CR-05 chunked transfer decoding absent | CONFIRMED BLOCKER | `responseBody()` forwards framed bytes and never inspects `Transfer-Encoding`. |
| CR-06 reversed file chunks | CONFIRMED BLOCKER | LIFO reverse iteration plus `unshift()` produces reversed raw children. |
| CR-07 unbounded raw/narinfo sizes | CONFIRMED BLOCKER | Configured metadata ceiling is disconnected; declared raw size overrides max transfer. |
| CR-08 signatures must be stripped/name-matched | REJECTED | Directly contradicts `NIP.md:522-533`, READ-04, and locked D-12. Current byte-key endorsement plus lossless passthrough is correct. |
| CR-09 main exits | CONFIRMED BLOCKER | Focused startup command exits 1. |
| WR-01 response not cancelled on exceptional read | CONFIRMED WARNING | Amplifies deadline/resource leakage. |
| WR-02 cleanup skipped if listener shutdown throws | CONFIRMED WARNING | Resource cleanup should be in `finally`. |
| WR-03 corrupt persisted JSON aborts restore | CONFIRMED WARNING | `JSON.parse`/`.tags.some()` is unguarded and can prevent startup across restarts. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers were found in Phase 1 source files. Empty callbacks found by grep are test doubles/cleanup handlers, not production stubs.

### Human Verification Required

None is needed to establish this verdict: the blocking failures are directly observable in source or focused commands. Plan prohibitions were reviewed explicitly; the SSRF and bounded-amplification prohibitions fail, while signature passthrough, snapshot isolation, typed absence, and stock-Nix independent verification have automated evidence.

### Gaps Summary

Phase 1 does not achieve its operator-facing goal. The protocol pieces are substantial and the stock-Nix compatibility test is meaningful, but it validates a test-only composition. The production program cannot start, live admission crosses the configured trust boundary, and hostile transport/tree inputs can bypass the phase's deadline, SSRF, ordering, and resource-bound guarantees. These are must-have failures, not human-verification uncertainties.

---

_Verified: 2026-08-12T12:04:16Z_
_Verifier: the agent (gsd-verifier)_
