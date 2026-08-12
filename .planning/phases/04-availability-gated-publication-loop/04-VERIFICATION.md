---
phase: 04-availability-gated-publication-loop
verified: 2026-08-12T16:06:02Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 4: Availability-Gated Publication Loop Verification Report

**Phase Goal:** As a Nix cache operator, I want to publish a staged object only after a complete replica is reachable, so that the signed cache update remains retrievable, observable, and recoverable when other replicas or relays fail.
**Verified:** 2026-08-12T16:06:02Z
**Status:** passed
**Re-verification:** No — initial verification

## User Flow Coverage

| Step | Expected | Evidence | Status |
|---|---|---|---|
| Stage/upload | Stock Nix uploads a fresh store object through the production daemon | `tests/e2e/nix_publication_roundtrip_test.ts:89-131`; independently passed | ✓ |
| Establish availability | Immutable candidate blobs stream to Blossom and one advertised server proves the complete inventory | `publication_coordinator.ts:130-150`; `publication_uploader.ts`; hostile and E2E tests pass | ✓ |
| Publish | The exact locally verified event is signed only after proof and committed after a configured relay OK | `publication_coordinator.ts:151-219`; publication-loop and hostile-relay tests pass | ✓ |
| Observe | The committed exact event enters normal reactive selection and the signer-first view | `publication_coordinator.ts:217-220`; selection assertion in `publication_loop_test.ts` | ✓ |
| Recover | Failed replicas/relays remain durable and retry after restart without re-signing or rollback | repository endpoint-work tables; `publication_recovery_test.ts` passes | ✓ |
| Outcome | After source deletion, fresh stock Nix substitutes solely from the newly published cache root | `nix_publication_roundtrip_test.ts:132-175`; independently passed | ✓ |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | No root is signed until one snapshotted advertised Blossom server durably proves every candidate blob | ✓ VERIFIED | Per-server proof matrix and `serverComplete` gate at `write_repository.ts:757-799`; split-replica and hostile-possession tests pass |
| 2 | Upload/proof is bounded, backpressured, hash-verified, and hostile responses cannot create possession | ✓ VERIFIED | File `ReadableStream`, bounded descriptor, exact byte ceiling and incremental SHA-256 in `publication_uploader.ts`; both Blossom publication tests pass |
| 3 | The signed default/named event has exact kind/d, htree, ordered Blossom/nixSigKey tags, empty content, and configured expiration | ✓ VERIFIED | Canonical template at `publication_coordinator.ts:151-168`; config/default and event-shape tests pass |
| 4 | Signer output is locally verified and the exact event is persisted before relay I/O | ✓ VERIFIED | Exact field comparison, `verifyEvent`, `validatePublication`, then `recordSigned` before `publishRelays` at lines 169-190; repository independently rechecks it |
| 5 | Only an exact configured relay OK permits durable commit | ✓ VERIFIED | Configured-set correlation at lines 186-207; false, foreign, absent, and duplicate-frame relay tests pass |
| 6 | Commit precedes normal selector admission and the signer root appears reactively | ✓ VERIFIED | Commit at lines 206-208, `selector.accept` at 217-219; normal-admission integration assertion passes |
| 7 | Restart/duplicate work reuses the same candidate and exact event without combining partial servers or rolling back | ✓ VERIFIED | Repository-authoritative saga plus serialized coordinator; restart, repeat tick, and recovery tests pass |
| 8 | Incomplete replicas and relays remain durable, observable, and asynchronously retryable after promotion | ✓ VERIFIED | Durable ordered endpoint work and forward outcomes at `write_repository.ts:580-638`; repair loop and restart recovery test pass |
| 9 | Optional local relay receives verified observed/newly signed events and counts for promotion only when configured | ✓ VERIFIED | `local_relay_cache.ts`; production routing at `daemon.ts:427-443`; local-relay tests pass |
| 10 | Publication defaults to 30 days and refresh creates a new durable saga before expiration | ✓ VERIFIED | Config test asserts 2,592,000 seconds; `beginPublicationRefresh` archives and copies inventory transactionally; refresh transition test passes |
| 11 | Required operational states emit typed, allow-listed, secret-safe JSON diagnostics | ✓ VERIFIED | Closed union/serializer in `operations/diagnostics.ts`; taxonomy, hostile property, URL credential, and sink-failure tests pass |
| 12 | `/health` independently and purely reports process/read/write status and stable reasons | ✓ VERIFIED | Pure snapshot provider and handler wiring; GET/HEAD no-I/O/no-mutation dependency trap and state matrix pass |
| 13 | Protocol, hostile, streaming, integration, and real-Nix publication/substitution behavior pass under narrow permissions | ✓ VERIFIED | Independent `deno task verify`: 18 protocol, 89 integration, 2 E2E passed |

**Score:** 13/13 truths verified (0 present, behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/persistence/write_repository.ts` | Durable monotone saga, proofs, exact event, repair, refresh | ✓ VERIFIED | Substantive, production-wired, transaction/state-transition tests pass |
| `src/blossom/publication_uploader.ts` | Bounded streamed upload and possession proof | ✓ VERIFIED | Substantive and daemon-wired; hostile/backpressure tests pass |
| `src/write/publication_coordinator.ts` | Proof → sign → relay OK → commit → admission plus repair | ✓ VERIFIED | Substantive and started/drained by production daemon |
| `src/nostr/local_relay_cache.ts` | Verified optional event write-through | ✓ VERIFIED | Production-wired for observed and signed events |
| `src/operations/diagnostics.ts` | Typed secret-safe structured diagnostics | ✓ VERIFIED | All variants serialized by explicit allow-list |
| `src/operations/health.ts` | Pure independent health projection | ✓ VERIFIED | Used by `/health`; side-effect trap passes |
| `src/runtime/daemon.ts` | Production lifecycle composition | ✓ VERIFIED | Real config, transports, signer, coordinator, selection, health all connected |
| Phase 4 integration/E2E tests | Behavioral proof of all phase-critical transitions | ✓ VERIFIED | Included in the exact `verify` task and passed independently |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Pending candidate | saga inventory/destinations | atomic claim/copy | ✓ WIRED | Later pending changes cannot alter claimed inputs |
| Coordinator | proof repository | server+hash proof matrix | ✓ WIRED | Same-server count must equal non-empty inventory |
| Complete proof | signer | explicit branch gate | ✓ WIRED | Signing code is unreachable while `completeServer` is absent |
| Signed event | relay publisher | exact persisted `saga.signedEvent` | ✓ WIRED | Relay sees repository-restored event, not transient signer output |
| Relay OK | commit/admission | correlated configured relay then commit then selector | ✓ WIRED | Ordering is explicit and behavior-tested |
| Endpoint work | repair loop | deterministic due claim/outcome | ✓ WIRED | Persistent retry state survives repository reopen |
| Local relay | selection/publication | admitted observed callback and signed forwarding | ✓ WIRED | Non-configured local relay cannot satisfy configured relay set |
| Health/diagnostics | HTTP/runtime | pure state provider and typed sink | ✓ WIRED | Production daemon supplies current repository/selection/signer state |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Publication saga | candidate, inventory, destinations | Phase 3 pending SQLite rows and current configured/BUD-03 destinations | Yes | ✓ FLOWING |
| Possession matrix | `(batch, server, hash)` proofs | verified streamed PUT descriptor + exact GET hash | Yes | ✓ FLOWING |
| Signed publication | exact event JSON/id | owned signer over persisted canonical template | Yes | ✓ FLOWING |
| Reactive root | selected publication | configured relay OK → durable commit → normal `PublicationSelector.accept` | Yes | ✓ FLOWING |
| Health/logs | operational state | repository, selection, signer, endpoint work | Yes, allow-listed | ✓ FLOWING |
| Nix restore | narinfo/NAR stream | newly published Hashtree after source-store deletion | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full quality and acceptance gate | `deno task verify` | fmt 56, lint 52, check; 18 protocol, 89 integration, 2 E2E passed | ✓ PASS |
| MVP story format | centralized `user-story.validate` query | Valid; role/capability/outcome extracted | ✓ PASS |
| Same-server/sign/relay/admission ordering | phase integration suite within full gate | 3/3 publication-loop tests passed | ✓ PASS |
| Durable repair/refresh/local relay | phase recovery suite within full gate | 2/2 passed | ✓ PASS |
| Hostile bounded publication transport | Blossom/relay suites within full gate | 4/4 passed | ✓ PASS |
| Real stock-Nix publication round trip | E2E lane within full gate | upload, publish, source deletion, sole-substituter restore passed | ✓ PASS |

### Probe Execution

No phase-declared or conventional `probe-*.sh` files exist. Step 7c is not applicable.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| PUBL-03 | 04-01/04-04 | ✓ SATISFIED | Same-server durable completeness gate and hostile bounded transport tests |
| PUBL-04 | 04-01/04-02/04-04 | ✓ SATISFIED | Exact signing, configured OK, durable commit, normal admission |
| PUBL-05 | 04-02/04-04 | ✓ SATISFIED | Persistent retry work and restart repair |
| PUBL-06 | 04-02/04-04 | ✓ SATISFIED | Optional verified local relay forwarding and explicit promotion counting |
| PUBL-07 | 04-04 | ✓ SATISFIED | Real Nix upload/publish/delete/substitute E2E |
| OPER-02 | 04-03/04-04 | ✓ SATISFIED | Typed allow-listed secret-safe JSON taxonomy |
| OPER-03 | 04-03/04-04 | ✓ SATISFIED | Pure independent process/read/write health |
| OPER-04 | all plans | ✓ SATISFIED | Full narrow-permission matrix passes |

No Phase 4 requirements are orphaned from plan frontmatter.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers, placeholders, empty implementations, whole-blob buffering, automatic publisher redirects, secret-bearing persisted diagnostics, or hollow production wiring were found in Phase 4 files.

Disconfirmation pass: repair concurrency bounds the number of endpoint jobs rather than parallelizing a single initial server inventory; this is conservative and does not weaken boundedness or availability. The hostile relay test is discriminating because false, foreign, and absent acknowledgements fail before accepting duplicate true responses. The principal failure paths—split replicas, corrupt/truncated proof, signer mutation, false relay, restart, retry exhaustion, diagnostic sink failure, and health dependency access—have direct tests.

### Human Verification Required

None. All state transitions, ordering invariants, restart behavior, hostile transport behavior, operational projections, and stock-Nix interoperability required by the phase have passing automated behavioral evidence.

### Gaps Summary

No blocking or human-verification gaps remain. The phase goal and all roadmap/plan must-haves are achieved in production-wired code.

---

_Verified: 2026-08-12T16:06:02Z_
_Verifier: the agent (gsd-verifier)_
