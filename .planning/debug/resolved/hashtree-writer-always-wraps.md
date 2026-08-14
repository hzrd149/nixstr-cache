---
status: resolved
trigger: "The writable Hashtree currently writes every file through a single-chunk file-list manifest; files should remain direct raw blobs until they exceed the canonical BUD-17 2 MiB chunk boundary."
created: 2026-08-14T12:00:00Z
updated: 2026-08-14T11:24:54Z
---

# Hashtree writer always wraps files

## Symptoms

- expected: Files at or below the canonical 2 MiB BUD-17 chunk size are represented by direct `type: 0` directory links. Only larger files use ordered `type: 1` file manifests over 2 MiB chunks.
- actual: NAR staging records route components at every 2 MiB boundary and `HashtreeWriter.buildFile()` unconditionally collapses even one component into a `type: 1` file manifest.
- errors: No runtime error; published roots contain unnecessary one-link file manifests, and the current boundary tests pin that noncanonical shape.
- timeline: Introduced with unified BlobStore write integration in commits `872ca38` and `ecbd069`; it has not previously implemented direct raw-file links.
- reproduction: Stage or build any non-empty file smaller than or equal to 2 MiB, decode the containing directory manifest, and observe that the file link has `type: 1` rather than `type: 0`.

## Current Focus

- bug_class: bohrbug
- hypothesis: `HashtreeWriter` models every logical file as a manifest-producing `source_path` node: it loses `components`-only file identity while freezing input, registers only newly persisted bytes as candidate leaves, and unconditionally calls file `collapse()` even for zero or one raw component.
- test: Complete — specified boundary/publication regressions, dual-shape reader compatibility, causal revert/reconfirm, adjacent suites, and static gates all passed.
- expecting: Complete — direct raw links remain canonical through 2 MiB, larger files retain ordered type-1 manifests, every reachable leaf is publication-owned, and both read shapes preserve verified HEAD/GET behavior.
- next_action: Archive this resolved session and append its prevention pattern to the durable debug knowledge base.
- reasoning_checkpoint:
    hypothesis: The writer's source-path-only durable model plus unconditional file collapse causes noncanonical wrapping and drops reused component leaves because logical file shape and candidate reachability are not represented independently.
    confirming_evidence:
      - The unchanged `buildFile()` calls `collapse(scope, "file", sequence)` for every path-backed size, including zero and one chunk; the new boundary regression fails before any fix.
      - `nodes` stores only `source_path/source_size`, and its file build query selects `source_path IS NOT NULL`; the components-only regression observes `type: 2`, proving that input is later treated as an empty directory.
      - The publication regression finds zero entries for both staged NAR component hashes because component lookup never feeds the candidate inventory/run-owner ledger.
    falsification_test: If preserving components in the durable index, registering their exact hashes, and bypassing collapse for zero/one chunks does not make the unchanged specified-oracle tests pass—or changes the 2 MiB + 1 link from type 1—the hypothesis is false.
    fix_rationale: A durable file/source-kind marker prevents components-only inputs from becoming directories; a shared bounded registrar makes every reachable raw leaf inventory-owned; selecting the sole raw leaf (or an explicit empty raw blob) removes only the unnecessary manifest layer while retaining chunked manifests above 2 MiB.
    blind_spots: The focused tests do not exercise hostile manually supplied noncanonical component sequences or a live Blossom replica, though adjacent protocol/integration suites cover reader compatibility and publication ownership transfer.
    candidate_causes:
      - code: unconditional file collapse, source-path-only file detection, and persist-only inventory registration in `HashtreeWriter`.
      - data: canonical staged NARs arrive as `components` with `path: undefined`, exposing the source-shape loss; path-backed files expose the unconditional-collapse branch.
      - config: an incorrect chunk or max-link value could shift the boundary, but `FILE_CHUNK_BYTES` is the specified 2,097,152 and `maxLinks` affects fanout only.
    and_gate: No external/config condition is required; the writer model alone deterministically accounts for each manifestation, while the two valid input shapes select which branch is visible.

## Evidence

- timestamp: 2026-08-14T12:00:00Z
  checked: `src/hashtree/writer.ts`, `src/persistence/write_repository.ts`, BUD-17 PR 106, and focused writer/publication tests
  found: `FILE_CHUNK_BYTES` correctly equals 2 MiB, staging deterministically records components, but `buildFile()` always calls `collapse(scope, "file", sequence)`. BUD-17 permits a direct blob at or below the chunk size. Existing focused suites pass while asserting `type: 1` at these boundaries.
  implication: The defect is deterministic and localized to writer representation selection plus adjacent inventory ownership; current tests are stale oracles.

- timestamp: 2026-08-14T12:00:00Z
  checked: candidate inventory and publication ownership flow
  found: Pre-staged components are hash/size checked but are not inserted into the writer inventory or acquired by the writer run; publication replication iterates only the recorded candidate inventory.
  implication: The corrected direct raw link must also make referenced leaves durable members of the candidate inventory, otherwise the published tree can reference blobs not replicated by the publication saga.

- timestamp: 2026-08-14T11:11:12Z
  checked: Phase-0 knowledge recall and focused pre-fix protocol suite
  found: MemPalace is unavailable and the durable knowledge base has no semantic/keyword match; all 10 existing writer tests pass because their boundary vectors pin the noncanonical wrapped representation. SBFL is skipped because there is no failing test or per-test coverage spectrum yet.
  implication: A new specified-oracle regression is required before the deterministic fix can be causally verified; the current green suite is not evidence of protocol correctness.

- timestamp: 2026-08-14T11:13:59Z
  checked: Agent-authored RED boundary, pre-chunked-component, and pending-publication regressions
  found: The raw-boundary test fails at the first zero-byte raw inventory assertion; the pre-chunked test observes `type: 2` instead of `type: 0`; and pending publication inventory contains zero occurrences of each staged component hash. The `nodes` schema/query explains `type: 2`: components-only inputs store `source_path=NULL`, are skipped by the file pass, and are consumed by the directory pass.
  implication: The confirmed root cause is the writer's conflated durable source/wire model, not only the final `collapse()` call; the fix must preserve component-backed file identity and reachability as well as direct-link selection.

- timestamp: 2026-08-14T11:16:13Z
  checked: Focused post-fix boundary, pre-chunked-component, and pending-publication tests
  found: All three unchanged RED regressions now pass. Sizes 0, 1, 2 MiB - 1, and 2 MiB link directly to exact raw SHA-256 leaves; 2 MiB + 1 remains a two-link file manifest; staged component hashes are each present once in the durable pending inventory.
  implication: The minimal writer-model change addresses the directly observed behavior and publication closure; adjacent suites and golden-vector updates remain before acceptance.

- timestamp: 2026-08-14T11:16:45Z
  checked: Complete Hashtree writer protocol and publication-batch integration suites after the fix
  found: All 9 publication-batch tests and 10 of 11 writer tests pass. The sole failure is the first old pinned root literal at 2 MiB - 1 (`a118...` expected, corrected direct-link root `9ed4...` actual), exactly the predicted stale-oracle change.
  implication: No adjacent behavioral regression is observed; the canonical vector literals must be regenerated from the specified direct-link representation before the full suite can pass.

- timestamp: 2026-08-14T11:19:09Z
  checked: Corrected golden vectors, complete focused rerun, typecheck, and exact code/test diff
  found: The 2 MiB - 1 and 2 MiB root vectors changed to the direct-link representation, while 2 MiB + 1 remained unchanged. All 11 writer tests, all 9 publication-batch tests, and focused `deno check` pass. The diff is additive/behavior-preserving outside the confirmed branches, not deletion-only. Tests are committed as `cad4e1b`; implementation is committed separately as `1d65d1b` for causal revert.
  implication: Target and adjacent focused signals pass; revert/reconfirm, broader protocol checks, and the mutation-tool availability check remain for guardrail acceptance.

- timestamp: 2026-08-14T11:20:36Z
  checked: Fix-acceptance revert/reconfirm, full protocol suite, touched lint/format, and mutation-tool availability
  found: Reverting only implementation commit `1d65d1b` makes both committed regressions fail with missing raw inventory entries; restoring the commit makes both pass. All 31 protocol tests pass, touched lint/format pass, and neither a Stryker command nor configuration exists.
  implication: Target, no-op/deletion, adjacent-protocol, and causal-revert signals pass. Mutation testing degrades to an explicit skip; complete integration/typecheck are the final held-out checks.

- timestamp: 2026-08-14T11:21:22Z
  checked: Complete held-out integration suite and whole-project typecheck
  found: All 153 integration tests pass, including existing raw and nested-manifest reader paths, and `deno task check` passes across main, protocol, integration, and e2e sources.
  implication: The writer fix is broadly compatible, but completion is held until the newly required explicit dual-shape HEAD-size and GET-order/hash reader proof is mapped or added.

- timestamp: 2026-08-14T11:23:36Z
  checked: Complete reader implementation, existing integration assertions, and new focused dual-shape compatibility test
  found: `PathResolver` returns authenticated directory-link size without fetching raw bytes for type 0 HEAD, preflights nested type 1 manifest totals for HEAD, and streams raw leaves in manifest order through `BlobFetcher` hash verification. The new test passes for both shapes and proves deliberate raw-hash corruption fails for both; no reader production change was needed.
  implication: The additional reader acceptance gate is behaviorally satisfied; full file/static verification and a test-only commit remain.

- timestamp: 2026-08-14T11:24:17Z
  checked: Complete hostile-Blossom reader suite, focused static gates, and test-only compatibility diff
  found: All 16 hostile-Blossom tests pass; the new test typechecks, lints, and formats cleanly; and commit `c1b70ed` contains only the dual-shape integration proof. `src/hashtree/reader.ts` remains unchanged.
  implication: Both canonical read shapes satisfy HEAD size, GET byte order, and hash-failure requirements; one final complete integration/typecheck run will close the acceptance gate.

- timestamp: 2026-08-14T11:24:54Z
  checked: Final complete integration suite and whole-project typecheck with all commits applied
  found: All 154 integration tests pass and `deno task check` passes. The final read-compatibility test is included, all unrelated pre-existing dirty files remain unstaged/uncommitted, and no production reader change exists.
  implication: The fix and all additional acceptance gates are verified; the session is resolved and ready for archival.

## Eliminated

- hypothesis: The reader cannot resolve direct raw-file links.
  evidence: Directory manifests accept `type: 0`, and the reader already streams raw links directly while recursively traversing only `type: 1` file manifests.
  timestamp: 2026-08-14T12:00:00Z

## Resolution

- root_cause: `HashtreeWriter` conflates logical-file source shape, candidate reachability, and BUD-17 wire representation: its durable index recognizes only path-backed files, its inventory records only bytes persisted during the build, and its file builder always emits a manifest node.
- fix: Persist file/source-kind and ordered component rows in the bounded SQLite work index, register reused components through the same inventory/run-ownership ceiling as new blobs, materialize the empty raw blob, and return direct type-0 nodes for zero/one canonical chunk while retaining file manifests above 2 MiB.
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker command and configuration are absent", mutant_killed: false }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests: { result: pass, suites_run: ["deno task test — 31 passed", "deno task test:integration — 154 passed", "deno task check", "touched lint/format"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    reader_compatibility: { result: pass, direct_type_0_head_get_hash: true, nested_type_1_head_get_order_hash: true, reader_files_changed: false }
    guardrail_verdict: accepted
- files_changed: [src/hashtree/writer.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts, tests/integration/hostile_blossom_test.ts]
- oracle_type: specified — BUD-17 canonical 2 MiB chunking and direct-blob behavior.

## Prevention

- code branch: The writer's durable work index had no explicit file/source-kind model, so `source_path` accidentally served as both the file marker and source descriptor; separately, the final builder encoded every raw sequence through the manifest collapse path. The fix makes file identity, component source, candidate registration, and wire selection explicit.
- data branch: Canonical staged NAR inputs carry `components` with `path: undefined`, while path-backed fixtures carry only `path`; the former exposed source-shape loss and the latter exposed unconditional wrapping. Both valid shapes are now first-class boundary fixtures.
- and-gate result: No external condition was required; the code model deterministically produced each manifestation for its corresponding valid input shape.
- why_not_caught: Existing protocol golden vectors pinned the noncanonical wrapped roots, the pre-chunked test asserted only a coarse inventory count, and no publication test named the reachable raw component hashes.
- recurrence_guard: `writer uses raw links through the canonical file chunk boundary` and `canonical writer reuses pre-chunked shared-store components` in tests/protocol/hashtree_writer_test.ts; `pending publication inventory includes every staged NAR component` in tests/integration/publication_batch_test.ts; and `canonical type-0 and nested type-1 files preserve HEAD size and verified GET order` in tests/integration/hostile_blossom_test.ts.
