---
quick_id: 260812-mhi
phase: quick-milestone-integration-closure
plan: 01
type: quick
status: ready
wave: 1
depends_on: []
autonomous: true
requirements:
  - WRIT-02
  - WRIT-06
  - PUBL-01
  - PUBL-03
  - PUBL-04
  - OPER-02
  - OPER-04
files_modified:
  - src/signer/capability.ts
  - src/persistence/write_repository.ts
  - src/write/batch_scheduler.ts
  - src/write/eligibility.ts
  - src/runtime/daemon.ts
  - src/nix/http_handler.ts
  - src/operations/diagnostics.ts
  - tests/fixtures/nostr_connect.ts
  - tests/integration/nip46_signer_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/health_diagnostics_test.ts
must_haves:
  truths:
    - Production NIP-46 signing completes the availability-gated publication path.
    - Durable dirty windows and complete staged work resume without a later write.
    - Staging and tree-build failures produce typed secret-safe diagnostics.
  artifacts:
    - src/signer/capability.ts
    - src/write/batch_scheduler.ts
    - src/runtime/daemon.ts
    - src/operations/diagnostics.ts
  key_links:
    - NIP-46 signer capability delegates signEvent into PublicationCoordinator.
    - WriteRepository restart state restores scheduler timers and eligibility work.
    - HTTP staging and scheduler build failures emit through OperationalDiagnosticSink.
---

<objective>
Close the milestone integration gaps so production remote signing, restart recovery, and failure observability preserve the already-specified publication guarantees across real daemon lifecycles.

Purpose: Prevent a ready NIP-46 signer, an active durable dirty window, or complete staged content from becoming stranded at production adapter and restart seams, while making staging/build failures observable without exposing secrets.
Output: Production wiring fixes plus deterministic integration tests that exercise remote publication, timer recovery, startup eligibility reconciliation, and typed diagnostics.
</objective>

<execution_context>
@/home/user/.codex/gsd-core/workflows/execute-plan.md
@/home/user/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@NIP.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/03-signer-gated-writable-cache/03-VERIFICATION.md
@.planning/phases/04-availability-gated-publication-loop/04-VERIFICATION.md
@src/signer/capability.ts
@src/runtime/daemon.ts
@src/persistence/write_repository.ts
@src/write/batch_scheduler.ts
@src/write/eligibility.ts
@src/nix/http_handler.ts
@src/operations/diagnostics.ts
@tests/fixtures/nostr_connect.ts
@tests/integration/nip46_signer_test.ts
@tests/integration/publication_batch_test.ts
@tests/integration/writable_cache_test.ts
@tests/integration/health_diagnostics_test.ts
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Drive one encrypted NIP-46 publication through production promotion</name>
  <files>src/signer/capability.ts, tests/fixtures/nostr_connect.ts, tests/integration/nip46_signer_test.ts</files>
  <behavior>
    - The production NIP-46 adapter retained after exact ownership authorization exposes and delegates `signEvent` to the active Applesauce signer; signer readiness alone is insufficient if signing is unavailable.
    - The loopback encrypted NIP-46 fixture handles `sign_event`, returns a real verified event signed by the configured remote owner, and records only secret-safe method facts.
    - A pending candidate proves its complete inventory on one advertised Blossom server, is remotely signed, receives an exact configured-relay OK, is committed, enters the normal selector admission path, and becomes the promoted signer root.
    - Foreign, malformed, or unverifiable remote signer output remains rejected by the existing local verification and promotion gates.
  </behavior>
  <action>First extend the encrypted loopback fixture and add a failing integration scenario that uses `launchDaemon` with the production `NostrConnectSigner`, signer capability, publication coordinator, local Blossom fixture, configured relay acknowledgement, and normal publication selection. Stage a deterministic complete object and drive it into a pending candidate; prove the same server possesses every candidate blob before the fixture receives `sign_event`; return a genuinely remote-signed event; then prove configured relay OK precedes durable commit and ordinary selector admission/promotion. Keep this as one end-to-end path through shipped composition, not a direct coordinator test or injected fake signer. Then correct the production adapter boundary so the object retained as `PublicKeySigner` preserves/delegates `signEvent` after authorization, while retaining exact pubkey re-checks and local event validation. Extend the fixture with only the standard encrypted `sign_event` request/response needed for this path, bounded waits, and safe counters; never include session material, ciphertext, templates containing sensitive data, or raw remote errors in diagnostics/assertion messages. Add a negative mutation case if needed to discriminate delegation from blind trust. Do not weaken same-server proof, relay correlation, event validation, ownership, or readiness gates.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/nip46_signer_test.ts --filter "remote publication"</automated>
  </verify>
  <done>A production-launched encrypted NIP-46 owner can complete the full pending-candidate to same-server proof to remote signature to configured relay OK to normal admission/promotion path, and invalid signer output still fails closed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Recover durable dirty and staged work on daemon restart</name>
  <files>src/persistence/write_repository.ts, src/write/batch_scheduler.ts, src/write/eligibility.ts, src/runtime/daemon.ts, tests/integration/publication_batch_test.ts, tests/integration/writable_cache_test.ts</files>
  <behavior>
    - Reopening a repository with an active publication dirty window restores its token, generation, base root, opened-at, and last-dirty timestamps without manufacturing a new window.
    - Scheduler startup arms the remaining quiet and maximum deadlines from durable timestamps; an elapsed deadline claims immediately, and repeated startup/recovery is idempotent.
    - A restart after the final dirty write but before either timer fires still freezes and builds exactly one pending candidate without another write.
    - Production startup enumerates durable staged Narinfo/NAR facts, subscribes to subsequent repository changes, recomputes bounded eligibility, refreshes the immutable signer overlay, and dirties batching for every newly committed generation.
    - A crash after staging but before the live callback cannot strand a complete object: after restart it becomes visible and enters batching without a later PUT; incomplete objects remain invisible.
  </behavior>
  <action>Write failing fake-clock repository-reopen tests for quiet-deadline remaining time, max-deadline remaining time, already-elapsed immediate execution, and duplicate initialization. Add the narrow repository query needed to expose a frozen active dirty-window snapshot, and make `PublicationBatchScheduler` restore it in its constructor/startup path before accepting new dirties. Calculate both remaining deadlines from `lastDirtyAt + 5_000` and `openedAt + 60_000`, claim once through the existing token transaction, preserve failed-batch replay serialization, and ensure close cancels restored timers.

Add a production-bound restart integration test that persists a complete staged Narinfo/NAR pair, simulates shutdown/crash before `onStaged` eligibility work, reopens through `launchDaemon`, and observes signer-first visibility plus a resulting frozen/pending batch with no later write. Add a bounded deterministic repository enumeration/reconciliation entry point to `EligibilityModel`, start its `changes$` subscription during daemon composition, retain the subscription for shutdown, and run startup reconciliation over durable candidate facts before declaring recovery idle. Route every newly committed overlay generation to `PublicationBatchScheduler.dirty` exactly once. Preserve the existing serialized fixed-point bounds and immutable overlay semantics; startup must not scan blob bodies into memory, publish directly, promote incomplete content, or duplicate generations/batches. Ensure live `onStaged` and startup subscription do not double-process the same change by using repository/generation idempotence rather than timing assumptions.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/publication_batch_test.ts tests/integration/writable_cache_test.ts --filter "restart"</automated>
  </verify>
  <done>An active batching window and complete staged content both resume autonomously after restart, produce at most one new generation/batch for the durable facts, and require no subsequent PUT or dirty notification.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Emit typed secret-safe staging and batch-build failure diagnostics</name>
  <files>src/operations/diagnostics.ts, src/nix/http_handler.ts, src/write/batch_scheduler.ts, src/runtime/daemon.ts, tests/integration/health_diagnostics_test.ts, tests/integration/publication_batch_test.ts</files>
  <behavior>
    - Every staging failure response class emits one typed operational diagnostic with an allow-listed stable code and safe route class/status context, without request bodies, authorization, filesystem paths, raw errors, stacks, or causes.
    - Every Hashtree batch-build failure emits one typed batch diagnostic with stable failure code and batch ID/count before or with durable failed marking, without blob paths, content, raw errors, or secrets.
    - Diagnostic sink failure remains non-authoritative: HTTP status mapping, failed-batch durability/retry, scheduler serialization, and daemon availability are unchanged.
  </behavior>
  <action>Begin with focused tests that inject hostile errors and sentinel secrets into staging and writer failure paths, capture the production operational sink, and assert one correctly typed/serialized allow-listed record per failure while the existing HTTP status and durable failed-batch behavior remain unchanged. Extend `OperationalDiagnostic` only with the minimum explicit fields/codes necessary for staging and build failures, and serialize each through an exhaustive allow-list branch. Thread the operational sink into the write side of `createNixHttpHandler` and `PublicationBatchScheduler` from `createProductionDependencies`; map known staging outcomes to stable codes/statuses and all unexpected failures to a generic safe code. Emit build failure after identifying the durable batch and ensure `markBatchFailed` still occurs even if diagnostic emission throws. Never serialize an Error, request/body/header value, local path, URL query, signer/session value, candidate content, or arbitrary spread properties.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/health_diagnostics_test.ts tests/integration/publication_batch_test.ts --filter "failure diagnostic" &amp;&amp; deno task verify &amp;&amp; deno task test:nix-e2e</automated>
  </verify>
  <done>Staging and Hashtree build failures are durably handled and externally observable through typed secret-safe diagnostics, the full quality gate passes, and both stock-Nix E2E files pass explicitly.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| NIP-46 relay/signer to publication coordinator | Encrypted remote responses cross into an owned signing capability and may authorize a public immutable event. |
| SQLite restart state to scheduler/eligibility | Durable timestamps and staged metadata drive automatic work after process memory and callbacks are lost. |
| HTTP/body and Hashtree failures to diagnostics | Hostile inputs and exceptions must become useful operator signals without leaking secrets or local storage details. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-mhi-01 | Spoofing | NIP-46 `sign_event` response | high | mitigate | Delegate through the owned active signer, then preserve exact pubkey/event verification before relay publication or promotion. |
| T-mhi-02 | Tampering | restored dirty window and staged rows | high | mitigate | Restore immutable durable facts and use token/generation transactions plus idempotent eligibility commits to prevent duplicate or skipped work. |
| T-mhi-03 | Repudiation | staging/build failures | medium | mitigate | Emit stable typed failure codes with batch/status context while retaining failed state for retry. |
| T-mhi-04 | Information Disclosure | operational diagnostics | high | mitigate | Explicit serialization allow-lists and hostile sentinel tests exclude bodies, paths, credentials, ciphertext, errors, stacks, and arbitrary fields. |
| T-mhi-05 | Denial of Service | startup recovery | medium | mitigate | Reuse constructor-required eligibility bounds, stream/file references, serialized work, bounded timers, and idempotent startup. |
| T-mhi-06 | Elevation of Privilege | signer-to-promotion path | high | mitigate | Same-server inventory proof, exact identity, exact configured relay OK, and normal selector admission remain mandatory and are tested end-to-end. |
| T-mhi-SC | Tampering | package supply chain | low | accept | No install occurs; implementation uses the existing pinned dependency graph. |
</threat_model>

<source_coverage_audit>

| Source | Item | Coverage |
|---|---|---|
| GOAL | Close milestone integration seams without weakening trust, availability, restart, or bounded-resource guarantees | Tasks 1-3 |
| REQ | WRIT-02 production NIP-46 signer capability | Task 1 |
| REQ | WRIT-06 complete staged object visibility after restart | Task 2 |
| REQ | PUBL-01 durable quiet/max batching | Task 2 |
| REQ | PUBL-03/PUBL-04 proof, signing, relay OK, admission ordering | Task 1 |
| REQ | OPER-02 typed secret-safe diagnostics | Task 3 |
| REQ | OPER-04 production integration and both real-Nix workflows | Tasks 1-3 final verification |
| RESEARCH | Reactive durable eligibility, immutable overlay, persistent publication boundary, bounded streams | Task 2 |
| CONTEXT | Audit finding: production signer adapter loses `signEvent` | Task 1 |
| CONTEXT | Audit finding: active dirty window is not restored | Task 2 |
| CONTEXT | Audit finding: durable staged rows are not reconciled/subscribed on startup | Task 2 |
| CONTEXT | Audit finding: staging/build failures lack typed safe diagnostics | Task 3 |

No deferred idea or out-of-phase item is included, and no source item is missing.
</source_coverage_audit>

<verification>
Execute each task test-first and commit each task atomically. After focused suites pass, run `deno task verify`; then run `deno task test:nix-e2e` explicitly so both `tests/e2e/nix_substitution_test.ts` and `tests/e2e/nix_publication_roundtrip_test.ts` are evidenced even though the full gate already includes them. Confirm no new dependency, unbounded body/blob read, automatic redirect, test-only production bypass, or secret-bearing diagnostic field was introduced.
</verification>

<success_criteria>
- The production NIP-46 adapter completes a real encrypted remote signing publication through same-server proof, exact relay OK, durable commit, and normal admission/promotion.
- Restart with no later write restores both active publication deadlines and durable staged eligibility/batching exactly once.
- Staging and Hashtree build failures emit typed allow-listed diagnostics while preserving failure response/retry semantics and confidentiality.
- Focused integration suites, `deno task verify`, and the explicit two-file Nix E2E task pass under their existing narrow permissions.
- Each task is committed atomically and no package installation occurs.
</success_criteria>

<output>
Create `.planning/quick/260812-mhi-close-milestone-integration-gaps-nip-46-/260812-mhi-SUMMARY.md` when done.
</output>
