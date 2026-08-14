---
status: resolved
trigger: "Investigate why the PUT write http requests are not being logged, and in general why the http request logging is so fucked"
created: 2026-08-14
updated: 2026-08-14T14:01:00+01:00
---

# Symptoms

- expected: All inbound HTTP requests, including streamed PUT uploads, produce consistent request lifecycle logs with method, safe path, status, duration, and useful bounded error context.
- actual: PUT write requests are absent from HTTP request logs, while logging across routes appears inconsistent and difficult to reason about.
- errors: No specific internal exception supplied; the defect is missing/inconsistent observability.
- timeline: Observed after the recent HTTP, write-path, and publication logging changes; whether it ever worked uniformly is unknown.
- reproduction: Start the daemon with write mode, enable `DEBUG=*`, run a stock Nix cache upload such as `nix copy --to http://127.0.0.1:8787 ...`, and compare PUT traffic with emitted inbound HTTP logs.

# Current Focus

- bug_class: bohrbug
- reasoning_checkpoint:
    hypothesis: the all-method operational emission fix already satisfies the requested logging boundary because production renders `http_request` through an always-wired console sink, while `DEBUG` gates only the separate `nixstr:http:*` facade; the remaining gap is that the regression asserts the typed item but not the rendered DEBUG-unset contract.
    confirming_evidence:
      - production `createProductionDependencies` constructs `createConsoleDiagnosticSink()` unconditionally and passes it to the handler.
      - with `DEBUG` explicitly unset, a successful PUT returned 200 and emitted exactly `1970-01-01T00:00:00.000Z INFO  PUT /nar/logging.nar -> 200 duration=<n>ms` while both HTTP debug namespaces were disabled and `console.debug` captured zero calls.
      - source inspection shows the console renderer never consults DEBUG; only `compactDebug` does.
    falsification_test: a DEBUG-unset focused test that emits no normal PUT line, emits a `nixstr:http:*` trace, or requires forcing a debug namespace on would disprove the hypothesis.
    fix_rationale: strengthen the existing successful PUT regression to use the real console renderer and separately capture debug output, making the required boundary executable without changing already-correct production wiring.
    blind_spots: the focused test uses the production handler and renderer but not a spawned daemon process; the prior stock-Nix publication round trip covered the full daemon path, and production wiring was inspected directly.
    candidate_causes:
      - code: a shared DEBUG-gated sink could suppress access lines, but direct source and runtime output disprove it.
      - config: the original reproduction's `DEBUG=*` could make debug traces visually coincide with access lines, creating the appearance that both require DEBUG.
      - environment: inherited DEBUG could alter debug output, so the reproduction explicitly removed it.
      - data: PUT success vs. staging failure changes INFO vs. ERROR and may add a route warning, but not whether the generic line is emitted.
    and_gate: no; the original code guard caused the real omission, while DEBUG is independently proven not to gate the fixed operational line.
- next_action: archive this confirmed session, append its recurrence guard to the debug knowledge base, and commit only those planning documents

# Evidence

- timestamp: 2026-08-14T13:16:02+01:00
  checked: Phase 0 semantic/keyword knowledge-base recall
  found: MemPalace CLI is unavailable; keyword fallback found no prior entry with 2+ token overlap for missing PUT request lifecycle logs.
  implication: no known-pattern candidate is privileged; proceed with fresh evidence gathering.
- timestamp: 2026-08-14T13:19:54+01:00
  checked: complete HTTP handler boundary, debug facade, application binding, operational diagnostic union/renderer, and focused logging tests
  found: `debugHttpRequest` start/completion logging accepts every method, but `OperationalDiagnostic` types `http_request.method` as only `GET | HEAD`, and `createNixHttpHandler` emits the operator-facing `request_handled` item only when the method is GET or HEAD.
  implication: PUT deterministically bypasses the normal INFO/WARN/ERROR request log even after staging returns a response; current tests assert debug field formatting and GET logging but contain no PUT request-lifecycle assertion.
- timestamp: 2026-08-14T13:22:41+01:00
  checked: focused debug/health diagnostic integration suite (15 tests)
  found: all tests pass; the staging-failure PUT test receives exactly one staging diagnostic, demonstrating that no second request lifecycle diagnostic is emitted for PUT.
  implication: the omission is deterministic and currently uncovered as a defect by the test oracle.
- timestamp: 2026-08-14T13:22:41+01:00
  checked: SBFL Phase 1.25 and common-pattern/taxonomy routing
  found: SBFL skipped because the existing focused suite has no failing test; the symptom matches a wrong-branch/data-contract omission and classifies as a Bohrbug.
  implication: use a deterministic regression reproduction followed by differential inspection of the explicit method guard.
- timestamp: 2026-08-14T13:27:18+01:00
  checked: successful PUT regression before production changes
  found: the handler returned status 200, but `requestLog?.type` was undefined because the operational diagnostic array was empty.
  implication: the PUT route succeeds and the logger omission is directly reproduced; the GET/HEAD method guard is causal rather than merely correlated.
- timestamp: 2026-08-14T13:33:07+01:00
  checked: adjacent debug and health diagnostics after the fix
  found: 15 tests passed; the one failure expected one line for a PUT staging failure but now receives two because the request-level PUT 503 log is present alongside the staging-specific warning.
  implication: update the old assertion to the newly specified lifecycle contract; no unrelated behavior failed.
- timestamp: 2026-08-14T13:34:12+01:00
  checked: adjacent debug and health diagnostic suites after updating the stale expectation
  found: all 16 tests pass, including successful PUT, unsupported POST, failing PUT, GET, and HEAD logging paths.
  implication: focused adjacent behavior is green; proceed to causal revert-and-reconfirm.
- timestamp: 2026-08-14T13:36:09+01:00
  checked: fix-acceptance revert-and-reconfirm
  found: temporarily reversing only the two production hunks made the lifecycle regression fail with 0 diagnostics instead of 2; reapplying the hunks made it pass again.
  implication: the source fix causally resolves the reproduced omission and the regression discriminates the fix site.
- timestamp: 2026-08-14T13:39:02+01:00
  checked: format, lint, typecheck, and full integration guardrail
  found: lint and complete typecheck pass; formatting identified only a mechanical test layout issue; 159 integration tests pass and `GET access logging is immediate while transport completion drives cancellation` fails because moving operational emission into transport finalization delayed its established access-log timing.
  implication: lifecycle unification is broader than required and violates an adjacent contract; preserve immediate operator access logging and remove only the all-method exclusion.
- timestamp: 2026-08-14T13:41:20+01:00
  checked: complete HTTP access-log timing contract test
  found: the operator diagnostic is deliberately asserted immediately after handler return and exactly once, while `ServeHandlerInfo.completed` independently drives cancellation after a client disconnect.
  implication: the correct minimal fix is unconditional method coverage at the existing immediate boundary, not merging operator logs into transport completion.
- timestamp: 2026-08-14T13:43:09+01:00
  checked: narrowed fix focused regression and adjacent tests
  found: all 16 debug/health tests pass after preserving immediate logging; the combined command could not load `http_cache_test.ts` because it omitted the suite's required environment permission.
  implication: the narrowed source behavior is green on focused cases; rerun the timing-contract suite with the correct permission before evaluating it.
- timestamp: 2026-08-14T13:45:14+01:00
  checked: full integration suite after narrowing the fix
  found: all 160 integration tests pass, including the immediate GET access-log contract, successful/failed PUT logging, unsupported POST logging, signer-denied PUTs, and writable-cache routes.
  implication: the minimal all-method change preserves adjacent HTTP timing, cancellation, write authorization, and staging behavior.
- timestamp: 2026-08-14T13:46:37+01:00
  checked: final lint, typecheck, protocol, diff, and formatting gates
  found: lint, full typecheck, all 31 protocol tests, and `git diff --check` pass; repository-wide format check reports only the unrelated untracked `config copy.json` while the touched files had already been formatted.
  implication: source/test changes satisfy available static and protocol gates; preserve the unrelated user file and verify touched formatting separately.
- timestamp: 2026-08-14T13:49:28+01:00
  checked: touched-file formatting and stock-Nix publication round trip
  found: all four touched files pass `deno fmt --check`; stock Nix uploads through the production daemon, publishes, and substitutes from the new root successfully in 43 seconds.
  implication: the original real workflow remains functional with the narrowed logging fix; perform a final causal check on the exact production diff.
- timestamp: 2026-08-14T13:52:18+01:00
  checked: final narrowed-diff revert/reconfirm and diff hygiene
  found: restoring the original method union and GET/HEAD guard makes the regression fail with 0 logs instead of 2; reapplying only the final method-schema/guard change restores green, and `git diff --check` passes.
  implication: all applicable fix-acceptance signals pass; only Stryker mutation testing is explicitly unavailable, so the guardrail verdict is accepted pending real-workflow human verification.
- timestamp: 2026-08-14T13:54:00+01:00
  checked: production daemon diagnostic construction, HTTP handler emission, debug facade, and console renderer
  found: production always constructs `createConsoleDiagnosticSink()` and passes it as `operationalDiagnostics`; `http_request` renders as timestamped INFO/WARN/ERROR independently, while only `debugHttpRequest` and `debugHttpRoute` consult the DEBUG-backed facade.
  implication: no production sink is intentionally DEBUG-gated; reproduce with DEBUG unset and add a rendered-output regression so this contract is explicit.
- timestamp: 2026-08-14T13:55:00+01:00
  checked: first DEBUG-unset focused Deno eval invocation
  found: Deno 2.9 rejected `--allow-env` for `deno eval` before executing the reproduction.
  implication: this is a command-shape issue, not product evidence; rerun the same reproduction without eval permission flags.
- timestamp: 2026-08-14T13:56:00+01:00
  checked: DEBUG-unset successful PUT through the production handler and console diagnostic renderer
  found: `DEBUG` was absent, both HTTP debug namespaces reported disabled, PUT returned 200, normal output contained one timestamped INFO access line, and `console.debug` captured zero calls.
  implication: the requested contract is already correct in the current production fix; harden the regression so future wiring cannot accidentally place access logs behind DEBUG.
- timestamp: 2026-08-14T13:58:00+01:00
  checked: hardened DEBUG-unset logging regression
  found: all 7 debug logging tests pass with DEBUG removed; the new oracle observes timestamped INFO PUT and WARN POST access lines while capturing zero HTTP debug calls.
  implication: rendered operational access output is demonstrably independent of DEBUG; verify adjacent diagnostics and type safety before committing.
- timestamp: 2026-08-14T13:59:00+01:00
  checked: DEBUG-unset adjacent diagnostics, focused typecheck, and lint
  found: all 17 adjacent tests and focused typecheck pass; lint rejects only the new regex literals because the expected padded INFO/WARN levels contain two literal spaces.
  implication: product behavior is green; make the lint-equivalent regex spelling change and rerun the gates.
- timestamp: 2026-08-14T14:00:00+01:00
  checked: final focused verification after lint-compatible oracle spelling
  found: all four touched files pass formatting, focused lint and typecheck pass, and all 17 DEBUG-unset adjacent logging/diagnostic tests pass.
  implication: the logging contract and adjacent behavior are green; isolate owned hunks for commit without staging unrelated concurrent files or `config copy.json`.
- timestamp: 2026-08-14T14:01:00+01:00
  checked: user checkpoint response, isolated staged diff, and code commit
  found: the user confirmed PUT logging works in the real workflow; the follow-up DEBUG concern was disproved by the DEBUG-unset reproduction, and commit `4a5be94` contains only the four logging-owned source/test files.
  implication: human verification and all guardrail signals are satisfied; archive the session and record the prevention artifact.

# Eliminated

- hypothesis: DEBUG namespace configuration alone hides PUT lifecycle logs.
  evidence: the reproduction captured the operational sink directly, which is independent of debug namespace enablement, and still received no PUT request diagnostic.
  timestamp: 2026-08-14T13:27:18+01:00
- hypothesis: Deno transport completion behavior prevents PUT logging.
  evidence: the direct handler call does not use ServeHandlerInfo or a transport completion promise and still reproduces the omission.
  timestamp: 2026-08-14T13:27:18+01:00
- hypothesis: the stock Nix PUT path is rejected before logging.
  evidence: the focused valid `/nar/logging.nar` PUT completed with status 200 and nevertheless emitted no request lifecycle item.
  timestamp: 2026-08-14T13:27:18+01:00
- hypothesis: the separate immediate access-log and transport-completion debug boundaries are themselves an implementation defect that should be unified.
  evidence: `GET access logging is immediate while transport completion drives cancellation` explicitly protects immediate single access logging and delayed cancellation; unification broke that established contract.
  timestamp: 2026-08-14T13:41:20+01:00

# Resolution

- root_cause: The HTTP handler explicitly emitted operator-facing access diagnostics only for GET/HEAD, and the diagnostic schema encoded the same method exclusion, so successful and failed PUTs never reached the normal request log.
- fix: Widen `http_request.method` to the actual request-method string and emit the existing immediate operational access log for every method; harden the regression with successful PUT and unsupported POST rendered-output boundary cases while explicitly keeping `nixstr:http:*` debug traces disabled.
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker command and configuration are absent", mutant_killed: false }
    no_op_deletion: { result: pass, deletion_justified_by_rca: true }
    adjacent_tests: { result: pass, suites_run: ["DEBUG-unset tests/integration/debug_logging_test.ts", "DEBUG-unset tests/integration/health_diagnostics_test.ts", "tests/integration/http_cache_test.ts", "deno task test:integration (160 tests)"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: accepted
- oracle_type: specified
- commit: 4a5be94
- files_changed:
  - src/nix/http_handler.ts
  - src/operations/diagnostics.ts
  - tests/integration/debug_logging_test.ts
  - tests/integration/health_diagnostics_test.ts

# Prevention

- causal_branches:
    - code: the operator diagnostic schema and handler guard encoded HTTP access logging as GET/HEAD-only even though the route handler accepted PUT.
    - config_environment: the original DEBUG-enabled reproduction made opt-in `nixstr:http:*` traces visually coincide with the operational access output, while no test explicitly separated the channels.
- and_gate: no; the GET/HEAD guard alone caused the missing access line, and DEBUG was independently disproved as a production gate.
- why_not_caught: no integration test exercised a successful non-GET request through the rendered console sink with HTTP debug namespaces disabled.
- recurrence_guard: regression test `operator access lines are rendered independently from HTTP debug traces` in `tests/integration/debug_logging_test.ts` asserts timestamped PUT INFO and POST WARN lines while capturing zero HTTP debug calls.
