---
status: awaiting_human_verify
trigger: "Fresh read-side cache resolution returns HTTP 200 for published NARs, but stock Nix reports curl error: Transferred a partial file and retries until substitution fails."
created: 2026-08-13T18:40:00Z
updated: 2026-08-13T20:35:00Z
---

# Partial NAR stream

## Symptoms

- expected: With an empty local data directory, the daemon resolves the selected published Hashtree and streams complete `.nar.xz` bodies to stock Nix.
- actual: The daemon logs each NAR request as served with status 200, while Nix reports `curl error: Transferred a partial file`, retries five times, and fails substitution.
- errors: `HTTP error 200 (curl error: Transferred a partial file)` for `nar/00gkhv...nar.xz` and `nar/0033y...nar.xz`.
- timeline: Reproduced after wiping the data folder and starting the daemon fresh; warm retries complete in 0-2ms but remain partial.
- reproduction: Start with an empty data directory, run the daemon with `config.json`, then run `nix run --option substituters 'http://127.0.0.1:8787' nixpkgs#hello`.

## Current Focus

- bug_class: bohrbug
- hypothesis: Confirmed — the old writer's exact wire-size fingerprint can be distinguished from arbitrary bad metadata, and a bounded manifest-only preflight can derive the authenticated logical size before HTTP framing.
- test: Restart the daemon on the revised code and use the same already-published malformed root—without republishing—to repeat the original stock-Nix substitution.
- expecting: HEAD/GET advertise and stream the authenticated descendant plaintext size from the existing root, stock Nix completes without curl error 18, and later writable candidates rebuild corrected logical sizes.
- next_action: Await human confirmation from the original real cache workflow.
- reasoning_checkpoint:
  hypothesis: `PathResolver` can read old malformed roots safely because their bad type-1 sizes equal the canonical wire byte length of the hash-referenced file manifest; deriving descendant totals from hash-verified bounded manifests repairs framing without trusting unauthenticated content.
  confirming_evidence:
    - The agent-authored legacy fixture fails RED by returning 50 manifest-wire bytes instead of the authenticated 19-byte descendant total.
    - The current reader returns HEAD immediately and delays the only descendant-size comparison until GET stream completion, which explains HTTP 200 followed by a partial body.
    - File manifests are canonical and hash-verified before use, and traversal already has mandatory depth, link, unique-node, decoded-byte, transfer, attempt, output, and deadline ceilings.
    - The corrected writer now persists descendant logical sizes for future file, nested-file, directory, and fanout links.
  falsification_test: If an arbitrary type-1 mismatch that equals neither descendant plaintext size nor referenced manifest wire length is accepted, or HEAD must fetch raw NAR content to derive size, the hypothesis is false.
  fix_rationale: Preflight only bounded manifest metadata, validate every type-1 edge against the spec value or exact legacy fingerprint, and stream the resulting bounded ordered raw-link plan lazily; this fixes Content-Length while preserving raw blob hash/size verification and backpressure.
  blind_spots: The synthetic fixture does not exercise the user's exact immutable root; repeated DAG references and traversal-limit boundaries need adjacent tests, and legacy roots beyond configured safety limits must still fail closed.
  candidate_causes:
    - code: the old writer emitted wire lengths, while the reader exposed them before validating descendants.
    - data: immutable roots retain the old writer's authenticated but semantically malformed link sizes.
    - config: traversal limits may intentionally reject an extremely large/deep legacy manifest DAG but do not cause the 50-versus-19 mismatch.
    - environment: Deno/curl enforce the advertised Content-Length, exposing the late mismatch as a partial transfer, but do not create it.
  and_gate: yes — the observed partial HTTP 200 requires both an old malformed root and deferred reader validation; the revised fix addresses both future production and compatible bounded consumption of existing data.
- tdd_checkpoint:

## Evidence

- timestamp: 2026-08-13T18:43:10Z
  checked: `.planning/debug/knowledge-base.md` and repository status
  found: The only prior resolution concerns writable-overlay eligibility, with no semantic or keyword match to partial response bodies. The existing `data-working/` directory and this session file are untracked user/workflow state.
  implication: No known-pattern shortcut applies; preserve the working data and investigate read-side streaming directly.

- timestamp: 2026-08-13T18:46:00Z
  checked: `src/nix/http_handler.ts`, `src/hashtree/reader.ts`, and `src/blossom/blob_fetcher.ts`
  found: The handler sets `Content-Length` from the authenticated directory link and returns/logs status 200 before consuming the body. Type-1 file traversal fetches child manifests/blobs lazily during `ReadableStream.pull`; any later budget, manifest, or blob error therefore terminates a 200 response early. Every child blob fetch debits the same request-wide `maxAttempts` counter.
  implication: The observed HTTP 200 plus curl partial-file error is exactly the framing produced by a deterministic late traversal error; global attempt exhaustion can truncate otherwise valid multi-chunk NARs.

- timestamp: 2026-08-13T18:49:00Z
  checked: Effective read limits, writer chunking, and existing traversal coverage
  found: `config.json` supplies no limit override, so `sourceAttempts` is 10. The writer splits files into 2,097,152-byte chunks. The existing nested-file reader test consumes only seven blobs total and therefore never crosses the default attempt ceiling; the stock-Nix E2E fixture publishes each NAR as a single raw blob rather than a file manifest.
  implication: Current tests do not exercise a production-sized NAR whose valid tree requires more than ten blob fetches, leaving the suspected deterministic boundary unguarded.

- timestamp: 2026-08-13T18:50:30Z
  checked: Local daemon process and listener state
  found: A Deno `main.ts --config config.json` process is currently listening on `127.0.0.1:8787`, matching the reported reproduction environment.
  implication: The original failure can be tested directly without changing daemon or dataset state.

- timestamp: 2026-08-13T18:53:30Z
  checked: Exact stock-Nix reproduction and direct HEAD/GET for both reported NAR routes
  found: Stock Nix reproduced the same five-retry curl-18 failure. Both NAR routes return HEAD 200 with `Content-Length: 54`; direct GET returns status 200, downloads zero bytes, and reports all 54 bytes missing.
  implication: The issue is not exhaustion after a long prefix. The authenticated descriptor size itself is wrong and the lazy stream fails before emitting the first NAR chunk.

- timestamp: 2026-08-13T18:55:30Z
  checked: `HashtreeWriter` file-to-directory assembly and preserved 54-byte candidate blobs
  found: After `buildFile`, the writer updates a file node with `built.size`, which is the persisted encoded manifest's byte length, although the node retains the original `source_size`. Parent directories then copy that node size into their type-1 link. Every decoded 54-byte candidate is a file manifest whose raw child declares a much larger logical payload (72,040 through 2,096,984 bytes in the preserved sample).
  implication: The writer deterministically publishes a manifest-wire size as the logical file size. This directly explains the daemon's 54-byte NAR descriptor and the reader/server rejecting the first oversized output chunk.

- timestamp: 2026-08-13T18:59:00Z
  checked: Isolated writer-only reproduction with a 1,000-byte source file
  found: The generated parent type-1 link declared 52 bytes, exactly matching the encoded file-manifest wire length, while that manifest's raw child declared the correct 1,000-byte payload.
  implication: The bug reproduces deterministically without Nostr, Blossom, HTTP, configuration, or production data; the writer assignment is the confirmed root cause.

- timestamp: 2026-08-13T18:59:00Z
  checked: SBFL eligibility, common-pattern scan, and bug classification
  found: SBFL was skipped because there was no failing automated test with per-test coverage at Phase 1.25. The defect matches a Data Shape/API Contract size-field mismatch and reproduces identically on every build, classifying it as a Bohrbug.
  implication: Deterministic minimal reproduction and working backward from the advertised length provide stronger localization than flaky/timing techniques.

- timestamp: 2026-08-13T19:01:00Z
  checked: Agent-authored regression assertion in `tests/protocol/hashtree_writer_test.ts`
  found: The target test fails RED before the source fix: the decoded parent file link contains 97 bytes while the supplied logical size is 2,097,153 bytes.
  implication: The automated oracle directly detects the root-cause field mismatch and can drive fix verification.

- timestamp: 2026-08-13T19:03:00Z
  checked: Provisional one-line writer change against the focused regression
  found: Replacing `built.size` with `file.size` makes the focused parent-link assertion pass.
  implication: The assignment causally controls the advertised size, but protocol-level adjacent tests must still determine whether changing it is correct or merely overfits the HTTP symptom.

- timestamp: 2026-08-13T19:05:00Z
  checked: Complete Hashtree writer protocol suite with the provisional change
  found: Seven tests passed, but every pinned canonical boundary root diverged; the first expected BUD-pinned root `852156...` became `07a607...` solely because the type-1 parent size changed.
  implication: The symptom-focused writer patch violates the independent canonical protocol oracle and is rejected. The producer's manifest-wire size is intentional; the consumer must not use it as logical file length.

- timestamp: 2026-08-13T19:10:00Z
  checked: Primary BUD-16 revision `1b2f140...` and BUD-17 revision `1848f77...` from upstream pull requests 105 and 106
  found: BUD-16 explicitly defines directory-link `s` as plaintext file size for type 1. BUD-17 explicitly requires parent type-1 file-manifest links to use the sum of descendant plaintext sizes and defines total file size as the sum of root link sizes.
  implication: The internal pinned hashes encode the implementation defect and are a stale oracle, not authoritative protocol evidence. The reader's logical-size interpretation is correct, and both writer wire-size assignments must be fixed.

- timestamp: 2026-08-13T19:13:00Z
  checked: Agent-authored nested-file regression with `maxLinks=2` and a 4,194,305-byte source
  found: The restored writer fails RED by publishing a 93-byte final type-1 link instead of 4,194,305 logical bytes, before the test can even reach the nested descendant-size assertions.
  implication: The minimized automated test reproduces the same wire/logical conflation across forced multi-level file-manifest construction.

- timestamp: 2026-08-13T19:16:00Z
  checked: Corrected writer against both focused size regressions
  found: The writer now keeps manifest blob bytes and represented plaintext bytes separate. The 4,194,305-byte nested case passes with descendant sizes `[4,194,304, 1]`, and the existing 2,097,153-byte deterministic case passes its final directory/file size assertions.
  implication: The implementation now matches the primary BUD size contract at both final and nested manifest boundaries.

- timestamp: 2026-08-13T19:19:00Z
  checked: Corrected canonical roots and complete writer protocol suite
  found: Regenerated N-1/N/N+1 root hashes are deterministic under the primary-spec size semantics, and all nine writer protocol tests pass, including the new nested logical-size regression.
  implication: The fix preserves deterministic construction and explicitly guards both the reported final-link defect and deeper nested variants.

- timestamp: 2026-08-13T19:23:00Z
  checked: Full `deno task verify` gate
  found: Formatting, lint, type-check, 29 protocol tests, 144 integration tests, and both stock-Nix E2E tests pass. The publication-roundtrip E2E successfully uploads through production code and substitutes from the newly published root.
  implication: The fix integrates across construction, publication, read resolution, and an unmodified Nix client without adjacent regressions.

- timestamp: 2026-08-13T19:27:00Z
  checked: Fix-acceptance diff, mutation availability, and revert-and-reconfirm
  found: The diff adds explicit logical-size accounting and assertions rather than deleting/short-circuiting behavior. No Stryker configuration or mutation runner exists. Temporarily restoring the old writer made the focused regression fail (`64` versus `4,194,305`); reapplying the fix made it pass.
  implication: The driving test detects the actual source behavior, and the accepted change—not unrelated state—is what removes the defect.

- timestamp: 2026-08-13T19:31:00Z
  checked: Final verification after reapplying the accepted source change and final repository status
  found: `deno task verify` passed again end-to-end: formatting, lint, check, 29 protocol tests, 144 integration tests, and two stock-Nix E2E tests. `git diff --check` is clean; only the two intended code/test files are modified, alongside the debug session and pre-existing untracked `data-working/` state.
  implication: All automated guardrail signals are accepted; only verification against a newly published real cache root remains.

- timestamp: 2026-08-13T19:49:00Z
  checked: `PathResolver.resolve`, `#fileStream`, `cleanupStream`, HTTP response framing, and the corrected writer update path
  found: Type-1 resolution returns the outer authenticated size before loading its file-manifest DAG; GET defers the descendant-size comparison until stream completion and HEAD never performs it. The referenced manifests are canonical, hash-verified, and already bounded by depth, links, unique-node, decoded-byte, transfer, attempt, and deadline budgets. The corrected writer stores descendant logical sizes in both file and directory/fanout links on every build.
  implication: The reader can safely preflight only manifest metadata, identify legacy links by equality to the referenced canonical manifest wire length, and calculate a correct Content-Length from authenticated raw-link sizes without buffering NAR bytes. Subsequent writes already rebuild the affected links with corrected logical sizes.

- timestamp: 2026-08-13T19:54:00Z
  checked: Agent-authored legacy-root compatibility regression in `tests/integration/hostile_blossom_test.ts`
  found: Before the reader fix, a 19-byte logical file referenced through a 50-byte legacy file manifest resolves via HEAD as 50 bytes; the test fails RED before GET and hostile-mismatch assertions.
  implication: The fixture reproduces the exact wire/logical mismatch independently of live infrastructure and provides a specified-oracle regression for the compatibility behavior.

- timestamp: 2026-08-13T20:02:00Z
  checked: Manifest-only preflight implementation against the focused legacy fixture
  found: The reader now returns and streams the authenticated 19-byte descendant total for a legacy outer link whose stored size is the 50-byte canonical file-manifest wire length; HEAD does not fetch the raw content, and the arbitrary outer mismatch rejects before returning a response.
  implication: The compatibility mechanism fixes framing without buffering NAR bytes or relaxing arbitrary size validation; nested and limit boundaries remain to be exercised.

- timestamp: 2026-08-13T20:08:00Z
  checked: Hardened compatibility regression with nested legacy links, a one-byte-invalid nested neighbor, and a link-budget boundary
  found: The reader derives the ordered 19-byte total through both legacy outer and nested wire-sized links; HEAD fetches no raw chunks, GET streams both verified chunks, the one-byte arbitrary mismatch rejects, and `maxLinks=3` rejects the four-link preflight.
  implication: Compatibility is limited to the exact old-writer fingerprint and remains subject to existing bounded-resource controls.

- timestamp: 2026-08-13T20:13:00Z
  checked: Writer update regression using a second build of the same route and the prior candidate as base context
  found: A route changed from 4,194,305 to 2,097,153 bytes; the rebuilt root-to-directory link, directory-to-file link, and file-manifest raw links all expose the new descendant sizes `[2,097,152, 1]`.
  implication: Writes rebuild and override stale size metadata throughout the relevant Hashtree path rather than carrying legacy or prior logical sizes forward.

- timestamp: 2026-08-13T20:17:00Z
  checked: Formatted source plus complete focused writer protocol and hostile Blossom reader suites
  found: All 9 writer tests and all 18 hostile reader/transport tests pass, including canonical roots, updated-size rebuilds, nested legacy compatibility, arbitrary mismatch rejection, budget enforcement, output ordering, raw hash/size verification, and cancellation behavior.
  implication: The revised fix is locally coherent across its import graph and retains the adjacent integrity/resource-safety behaviors exercised by the focused suites.

- timestamp: 2026-08-13T20:22:00Z
  checked: Full `deno task verify` gate after the revised compatibility and writer-update changes
  found: Formatting, lint, type-check, 29 protocol tests, 145 integration tests, and both stock-Nix E2E tests pass. The publication roundtrip still uploads through production and substitutes from the newly published corrected root.
  implication: The compatibility path integrates without regression across read selection, hostile transports, writable publication, and unmodified Nix clients; causality at the reader fix site remains to be reconfirmed.

- timestamp: 2026-08-13T20:26:00Z
  checked: Source-only revert of the reader compatibility implementation with the regression fixture retained
  found: The focused test returns to RED: HEAD advertises the 93-byte outer legacy manifest wire length instead of the authenticated 19-byte descendant total.
  implication: The legacy repair is causally dependent on the reader preflight change; reapplication must restore GREEN to complete guardrail signal 5.

- timestamp: 2026-08-13T20:30:00Z
  checked: Reapplication of only the reader compatibility implementation and the unchanged focused regression
  found: The same fixture returns to GREEN with a 19-byte derived size, complete ordered body, no raw fetch on HEAD, hostile nested mismatch rejection, and budget rejection. `git diff --check` is clean.
  implication: Revert-and-reconfirm passes for the revised read-side fix; the source change is both necessary and sufficient for the legacy compatibility behavior under test.

- timestamp: 2026-08-13T20:35:00Z
  checked: Final diff, mutation-tool availability, and static gates after reapplication
  found: The source diff adds bounded validation/planning and logical-size accounting rather than deleting or short-circuiting behavior. No Stryker configuration or mutation runner exists. Final format, lint, check, focused legacy regression, and `git diff --check` all pass after reapplication.
  implication: Every applicable fix-acceptance signal is accepted; only real-workflow confirmation against the user's immutable published root remains.


## Eliminated

- hypothesis: A valid multi-chunk NAR is truncated only after exhausting the request-wide `sourceAttempts=10` budget.
  evidence: Both failing routes advertise only 54 bytes and emit zero bytes, so failure occurs before any data chunk and cannot be caused by exhausting ten successful fetch attempts.
  timestamp: 2026-08-13T18:53:30Z

- hypothesis: Publisher-provided corrupt data or a Deno HTTP-runtime quirk independently creates the invalid 54-byte descriptor.
  evidence: A local writer-only build with no network/runtime input produces the same mismatch in the encoded parent manifest.
  timestamp: 2026-08-13T18:59:00Z

- hypothesis: `HashtreeWriter` is wrong to publish the encoded file-manifest blob size in a type-1 parent link and should publish logical file bytes instead.
  evidence: Changing that field greens the narrow assertion but breaks the BUD-pinned canonical root hashes at the writer's N-1/N/N+1 chunk boundaries.
  timestamp: 2026-08-13T19:05:00Z
  revoked_by: Primary BUD-16/17 text explicitly requires plaintext/descendant sizes for type-1 links, proving the internal canonical hashes captured the defective implementation.
  revoked_at: 2026-08-13T19:10:00Z


## Resolution

- root_cause: The old `HashtreeWriter` encoded file-manifest wire lengths as type-1 sizes, and `PathResolver` exposed those legacy values as HTTP Content-Length before its deferred descendant validation failed the stream.
- fix: Retained corrected writer logical-size accounting; added bounded manifest-only reader preflight that derives descendant plaintext totals, accepts only spec-correct or exact old-writer wire-sized type-1 links, rejects arbitrary mismatches before HTTP framing, and streams a bounded ordered raw-link plan with existing hash/size verification and backpressure.
- verification:
  target_test: { result: pass }
  mutation_check: { result: skipped, reason_if_skipped: "No Stryker configuration or mutation runner is present", mutant_killed: false }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false }
  adjacent_tests: { result: pass, suites_run: ["deno fmt", "deno lint", "deno check", "29 protocol tests", "145 integration tests", "2 stock-Nix E2E tests"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
  guardrail_verdict: accepted
- files_changed: [`src/hashtree/reader.ts`, `src/hashtree/writer.ts`, `tests/integration/hostile_blossom_test.ts`, `tests/protocol/hashtree_writer_test.ts`]
- oracle_type: specified — BUD-16/17 define the correct descendant plaintext total; compatibility is restricted to the exact prior writer encoding (`s` equals the referenced canonical manifest wire length), with arbitrary mismatches rejected.
