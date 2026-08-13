---
status: fixing
trigger: "Blossom uploads appear to fail or stall with a remote signer: the signer receives no upload-authorization requests while logs repeatedly print batch_claimed for the same six-entry batch and root. The publication-stage logging should also clearly show progress and failures."
created: 2026-08-13T15:05:00Z
updated: 2026-08-13T17:27:00Z
---

# Symptoms

- expected: After a publication batch is built, the daemon requests remote-signer authorization for Blossom uploads in sensible batches, uploads/proves the candidate blobs, and logs each publication stage and actionable failures.
- actual: The signer connects and write capability becomes ready, one Blossom server is discovered, then the same batch and root are repeatedly logged as `batch_claimed`; the remote signer receives no signing request and no later publication stage or error is visible.
- errors: No explicit error is printed. The repeated lines all report batch 1, six entries, and root `776183d2f010c4483ffa41977b74456786780c5d1eedf4f5f9c0879d51909470`.
- timeline: Observed on 2026-08-13 after remote nbunksec signer support and write activation succeeded.
- reproduction: Run `deno run --allow-env --allow-net --allow-read --allow-write main.ts --config config.json` with the remote signer and pending writable data; observe startup through `write_activation_ready`, followed by repeated `batch_claimed` events without remote signing prompts.

# Current Focus

- bug_class: bohrbug
- hypothesis: Production omitted BUD-11 authorization, and the initial remediation's count-only grouping can still create an impractically large Authorization field; an auth-required server/proxy may therefore reject either an unsigned upload or a signed upload whose token exceeds practical header limits.
- test: Paused after the isolated authorization suite passed because concurrent NostrRuntime/config edits made overlapping integration targets type-incomplete.
- expecting: Once the concurrent refactor settles, the focused publication/auth/diagnostic suites and full `deno task verify` can validate the dual count/byte ceiling without conflating unrelated failures.
- next_action: Wait without modifying or reverting the concurrent NostrRuntime/config refactor; re-read overlapping files before resuming verification.
- reasoning_checkpoint:
    hypothesis: "Production omitted BUD-11 upload tokens and remote permission for kind 24242, while the first fix bounded tokens only by 64 hashes; auth-required servers reject unsigned uploads and a proxy/server may reject a signed token whose base64url event exceeds its HTTP header budget."
    confirming_evidence:
      - "Production constructs PublicationUploader without authorization, and signer.assertIdentity never invokes signing."
      - "The auth-enforcing production E2E deterministically times out, while the official server defaults upload.requireAuth=true."
      - "NIP-46 permissions include only the root-event kind, and coordinator logs batch_claimed unconditionally while its timer swallows rejected ticks."
      - "Direct inspection after human verification found no byte-size prediction or final-header assertion in the count-only authorization helper."
    falsification_test: "The header-size part is false if a 64-hash canonical signed token is guaranteed below every supported HTTP header limit, or if lowering the configured ceiling by one byte does not change grouping; the authorization omission is false if unchanged production emits a valid signer-owned kind-24242 token."
    fix_rationale: "Greedily sizing the exact canonical JSON/base64url envelope with fixed-size id/pubkey/sig placeholders splits before the remote signer is asked; a post-sign assertion makes the ceiling fail closed. The existing authorization/permission/stage fixes continue to address the original unsigned retry loop."
    blind_spots: "The actual external server/proxy ceiling and remote signer UI cannot be observed locally; 6 KiB is a conservative full-field budget below the common 8 KiB limit, and real-environment human verification remains required."
    candidate_causes:
      - "code: missing uploader authorization callback, missing 24242 permission, misleading retry/error diagnostics"
      - "config/environment: the real Blossom server enforces BUD-11 (official default), unlike the prior permissive test fixture"
      - "data: a six-blob inventory makes per-blob prompts undesirable, requiring bounded multi-hash token grouping but is not itself corrupt"
    and_gate: "yes — the observed full symptom requires the code omission plus a legitimate auth-required server; oversized-token recurrence would require both a large enough inventory/domain and a finite intermediary header limit. The invisible repeated-claim presentation additionally requires the diagnostic defect."
- tdd_checkpoint: Not started.

# Evidence

- timestamp: 2026-08-13T15:18:00Z
  checked: `.planning/debug/knowledge-base.md`
  found: No durable debug knowledge base exists in this worktree.
  implication: No keyword-fallback candidate is available; semantic recall remains optional if MemPalace is installed.
- timestamp: 2026-08-13T15:20:00Z
  checked: MemPalace CLI availability
  found: `mempalace` is not installed or available on PATH.
  implication: Phase-0 recall gracefully degrades to direct investigation because neither semantic nor durable keyword recall is available.
- timestamp: 2026-08-13T15:24:00Z
  checked: Worktree and identifier search
  found: The only dirty path is this untracked debug session; `batch_claimed` is emitted at `src/write/publication_coordinator.ts:144`, uploader proof is invoked at lines 166 and 377, and production wiring adapts `PublicationUploader` in `src/runtime/daemon.ts`.
  implication: No unrelated shared-worktree edits currently overlap the target; the exact pre-signing path is localized to coordinator, uploader, and daemon callback wiring.
- timestamp: 2026-08-13T15:24:00Z
  checked: Existing resolved debug artifacts
  found: `.planning/debug/resolved/write-readiness-no-blossom.md` describes prior fixes to signer Blossom destination authorization, trust selection, base-path preservation, and diagnostics.
  implication: Treat the prior resolution as a related-pattern candidate and verify those same boundaries on the current publication path rather than assuming they remain correct.
- timestamp: 2026-08-13T15:31:00Z
  checked: `PublicationCoordinator.#run`, `#schedule`, and `PublicationUploader.prove`
  found: `batch_claimed` is emitted before replica proof; `prove()` awaits its authorization callback before entering the request catch; any callback rejection escapes to `tick()`, and the scheduler catches the tick with an empty handler before scheduling the next attempt.
  implication: A pre-request authorization exception deterministically produces the exact repeated-claim/no-error symptom and bypasses endpoint outcome diagnostics.
- timestamp: 2026-08-13T15:31:00Z
  checked: Common bug-pattern checklist
  found: The path matches Error Handling (`swallowed error`) combined with Async/Timing (`rejected await before retry scheduling`).
  implication: The failure can be a deterministic Bohrbug even though it manifests as repeated retries; prove the upstream exception independently before changing error handling.
- timestamp: 2026-08-13T15:40:00Z
  checked: Production construction in `src/runtime/daemon.ts`
  found: `new PublicationUploader({ request: fetcher.request.bind(fetcher) })` omits the uploader's optional `authorization` callback; no other production code creates BUD-11 upload authorization events.
  implication: Auth-enforcing Blossom servers receive unsigned PUTs, so the remote signer cannot receive an upload-authorization signing request.
- timestamp: 2026-08-13T15:40:00Z
  checked: Production replica adapter and signer boundary
  found: The replica adapter only calls `signer.assertIdentity()` and then `uploader.prove`; identity assertion uses `getPublicKey`, while only `SignerCapability.signEvent` invokes the remote signer signing operation.
  implication: The observed lack of remote signing prompts is the expected direct consequence of missing uploader authorization wiring, not a NIP-46 connection failure.
- timestamp: 2026-08-13T15:40:00Z
  checked: Failure taxonomy and SBFL preconditions
  found: The same auth-enforcing server/input deterministically rejects every unsigned upload, classifying this as a Bohrbug. No existing failing test/per-test failing spectrum exists yet.
  implication: SBFL is skipped because its required failing/passing coverage spectrum is absent; a test-first reproduction is the next fault-localization signal.
- timestamp: 2026-08-13T15:46:00Z
  checked: Existing Blossom fixtures and production publication tests
  found: `createPublicationFixture` accepts every syntactically valid upload without checking `Authorization`, and `blossom_publication_test.ts` only exercises an optional callback at the uploader boundary; no production-composition test requires BUD-11 authorization.
  implication: The missing production wiring passed because the end-to-end Blossom fixture did not model the authentication contract.
- timestamp: 2026-08-13T15:46:00Z
  checked: Local `NIP.md` and Phase-4 research
  found: `NIP.md` governs the cache-root publication but delegates Blossom transport; Phase-4 research prescribes a fresh signed kind-24242 upload authorization with `t=upload`, `x=<hash>`, `expiration`, and preferably `server`, encoded as unpadded base64url under `Authorization: Nostr`.
  implication: Confirm the proposal's current official form before encoding it in production and tests.
- timestamp: 2026-08-13T15:52:00Z
  checked: Official BUD-11 specification and official Blossom server documentation
  found: BUD-11 requires kind 24242, human-readable content, future `expiration`, matching `t=upload`, and for `PUT /upload` a required matching lowercase `x` hash; the full signed JSON event must be unpadded base64url under the `Nostr` authorization scheme. `server` is optional and, when used, contains only a lowercase domain name. The official server defaults `upload.requireAuth` to true.
  implication: Production's unsigned uploads are incompatible with the default official Blossom deployment, and the regression must validate the signed event rather than merely check header presence.
- timestamp: 2026-08-13T16:00:00Z
  checked: Repository retry semantics
  found: `claimPublication` returns the current incomplete saga on every tick; the coordinator logs `batch_claimed` unconditionally even when no new claim occurred. Failed initial replica work moves to `retry`, and subsequent ticks bypass fresh endpoint diagnostics while probing the entire inventory again.
  implication: Missing authorization causes a durable retry loop, while unconditional claim logging and incomplete failure-stage logging explain the repeated misleading message.
- timestamp: 2026-08-13T16:00:00Z
  checked: NIP-46 construction permissions
  found: Production requests signing permission only for the cache publication kind (`17091` or `37091`), not BUD-11 kind `24242`.
  implication: Wiring upload authorization alone would still leave strict remote signers unauthorized to sign upload tokens; the permission set must include kind 24242.
- timestamp: 2026-08-13T16:14:00Z
  checked: Auth-enforcing production roundtrip regression
  found: After the fixture began requiring a cryptographically valid, unexpired, hash-scoped kind-24242 upload token, the unchanged daemon timed out after 20 seconds waiting for its signed cache-root publication; zero tests passed and the exact E2E failed.
  implication: The missing production authorization is reproducible at the real daemon boundary and prevents availability-gated publication.
- timestamp: 2026-08-13T16:23:00Z
  checked: Current npm metadata and exact published `blossom-client-sdk@5.0.0` tarball source
  found: Version 5.0.0 is the current latest release (published 2026-04-21), ESM with built-in types and one required dependency. Its auth helper correctly creates one kind-24242 token for multiple blob hashes and server hostnames and encodes unpadded base64url. Its `multiServerUpload` preflights servers in parallel, then sequentially uploads the first copy and attempts BUD-04 mirrors/fallback uploads while reusing matching unexpired auth events.
  implication: The token construction/batching pattern is applicable, but package adoption depends on the data-plane/security review below.
- timestamp: 2026-08-13T16:23:00Z
  checked: SDK bounded-memory, network, retry, and URL behavior
  found: The SDK accepts only `Blob | File | Buffer`, calls `Blob.arrayBuffer()` and `crypto.subtle.digest()` to hash the whole upload, uses global `fetch` with automatic redirects and no DNS/SSRF/pinned-peer checks, builds `new URL('/upload', server)` which drops base paths, treats any HEAD status other than 404 as possession, and keeps retry/auth state only in process memory with no durable resume or post-upload hash-stream proof.
  implication: Adopting its upload or multi-server actions would directly violate the project's streaming, SSRF/redirect, base-path, integrity-proof, and durable publication guarantees. Retain the project-owned uploader/coordinator; copy only the small standards-level token pattern in project-owned code.
- timestamp: 2026-08-13T16:30:00Z
  checked: SDK Deno 2 import compatibility
  found: The package root and `./auth` subpath import under Deno, but the documented `./actions` export fails because package metadata points to absent `lib/actions.js`; the root exposes multi-server actions only under the `Actions` namespace, so a documented direct `multiServerUpload` root import is undefined.
  implication: Deno can consume the auth helper in isolation, but current export defects and the larger guarantees mismatch further argue against adding the dependency.
- timestamp: 2026-08-13T16:48:00Z
  checked: Focused authorization, publication coordinator, NIP-46, and diagnostic suites after the fix
  found: 21 focused tests pass. They prove 65 hashes split into two bounded tokens, authorization failures become retry/backoff eligible and emit sanitized stage failure, and NIP-46 advertises both cache-root and kind-24242 signing permissions.
  implication: The component boundaries now satisfy the token, remote-permission, retry, and observability parts of the root cause.
- timestamp: 2026-08-13T16:48:00Z
  checked: Original auth-enforcing stock-Nix production roundtrip after the fix
  found: The previously failing test now passes through two generations and stock-Nix substitution in 42 seconds; every accepted upload token is signer-owned, and the first publication's blobs share one bounded authorization event.
  implication: The exact production failure no longer occurs under an auth-required Blossom server model while end-to-end publication and substitution remain intact.
- timestamp: 2026-08-13T16:58:00Z
  checked: Full project verification and fix-acceptance guardrail
  found: `deno task verify` passes formatting, lint, type checking, 23 protocol tests, 131 integration tests, and 2 stock-Nix E2E tests. Stryker is not installed/configured, so mutation testing was explicitly skipped. The diff is behavior-adding, not deletion-only. With only the production source fix temporarily reversed, the auth-enforcing E2E returned to the same 20-second no-publication timeout; after reapplying it, the test passed in 41 seconds. A focused success-path test also asserts claimed/resumed semantics and every publication stage transition.
  implication: All applicable guardrail signals accept the fix, including causal revert/reconfirm; only real-environment human verification remains.
- timestamp: 2026-08-13T17:08:00Z
  checked: Human verification correction and current authorization helper
  found: The helper enforces only `MAX_UPLOAD_AUTHORIZATION_HASHES=64`; it neither predicts nor asserts the byte length of the final `Authorization: Nostr <base64url(JSON)>` value.
  implication: The prior guardrail was incomplete. A token may respect its hash-count cap yet exceed a server/proxy HTTP header limit, so fix verification must be reopened before real-environment testing.
- timestamp: 2026-08-13T17:18:00Z
  checked: Revised project-owned BUD-11 authorization grouping
  found: The helper now applies both the 64-hash cap and a 6 KiB ceiling to the complete serialized `Authorization: Nostr <base64url(JSON)>\r\n` field. It predicts the canonical signed envelope with fixed 64-character id/pubkey and 128-character signature fields before signing, canonicalizes the final event, and rejects any post-sign oversize result.
  implication: Groups are split before a remote signing request and fail without signing if even one hash cannot fit; focused exact-boundary tests are required before accepting the revision.
- timestamp: 2026-08-13T17:22:00Z
  checked: Exact-boundary and default-ceiling authorization tests
  found: Five Blossom publication integration tests pass. A token at the exact configured full-field byte ceiling signs once; one byte less produces two signer calls/tokens; a ceiling one byte below the one-hash minimum rejects with zero signer calls. The 64-hash count fixture exceeds 6 KiB as predicted, while the default dual-bounded batch splits and every resulting header is at most 6 KiB.
  implication: The byte estimator matches the final canonical encoding at the boundary, performs splitting before signing, independently retains the 64-hash bound, and asserts the selected default ceiling in executable tests.
- timestamp: 2026-08-13T17:27:00Z
  checked: Focused adjacent-suite verification after concurrent worktree changes
  found: The combined publication/auth/diagnostic run stopped at type checking because concurrent NostrRuntime/config edits currently leave `nostr` undefined at `src/runtime/daemon.ts:690`, infer its publish response as unknown, and remove `RawConfig.relayUrls` while `tests/integration/nip46_signer_test.ts:56,238` still use it. New concurrent paths include `src/nostr/runtime.ts`, configuration, entrypoint, and documentation changes.
  implication: These are unrelated, in-progress shared-worktree changes and must not be reverted or repaired by this debug task. The header-size target suite is green, but adjacent/full guardrail verification is blocked until that work settles.

# Eliminated

- hypothesis: The authorization callback itself rejects before invoking the signer.
  evidence: Production does not configure any authorization callback, so the callback cannot be the upstream exception in the reported path.
  timestamp: 2026-08-13T15:40:00Z

# Resolution

- root_cause: Production omitted BUD-11 upload authorization and NIP-46 kind-24242 permission, so auth-required Blossom servers rejected every streamed blob; permissive fixtures failed to catch it, and unconditional batch-claim plus swallowed/coarse stage errors made the durable retry loop appear as repeated claims with no actionable failure.
- fix: Retained the pinned streaming uploader; added verified bounded multi-hash BUD-11 token construction and per-batch reuse, requested NIP-46 kind-24242 permission, bounded replica/signing operations, made authorization failures retryable, distinguished claimed vs resumed sagas, and emitted sanitized authorization/replication/root-signing/relay/admission stage progress and failures. Tightened the production Blossom fixture to require real BUD-11 tokens. `blossom-client-sdk@5.0.0` was evaluated but not adopted because its whole-Blob hashing, native redirect behavior, missing SSRF/pinning, base-path loss, and non-durable orchestration violate project guarantees.
- verification:
    target_test: { result: pass, suites_run: ["tests/integration/blossom_publication_test.ts: 5 passed, including exact byte-boundary and zero-pre-sign-call rejection"] }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not installed or configured", mutant_killed: false }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests: { result: blocked, suites_run: ["publication-loop, NIP-46, diagnostics"], reason: "concurrent NostrRuntime/config refactor is type-incomplete at src/runtime/daemon.ts:690 and stale RawConfig fields in nip46_signer_test.ts:56,238" }
    revert_and_reconfirm: { result: pending, bug_returned_on_revert: false, fixed_on_reapply: false }
    guardrail_verdict: pending
- files_changed: `src/blossom/upload_authorization.ts`, `src/blossom/publication_uploader.ts`, `src/write/publication_coordinator.ts`, `src/runtime/daemon.ts`, `src/operations/diagnostics.ts`, `tests/fixtures/publication.ts`, `tests/integration/blossom_publication_test.ts`, `tests/integration/publication_loop_test.ts`, `tests/integration/nip46_signer_test.ts`, `tests/integration/health_diagnostics_test.ts`, `tests/e2e/nix_publication_roundtrip_test.ts`
