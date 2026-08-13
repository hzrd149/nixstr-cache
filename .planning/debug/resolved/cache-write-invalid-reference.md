---
status: resolved
trigger: "Cache write returns 200 for a dependency NAR and narinfo, but nix copy rejects a dependent store path because that uploaded reference is not valid."
created: 2026-08-13
updated: 2026-08-13
---

# Debug Session: Cache Write Invalid Reference

## Symptoms

- expected: `nix copy --refresh --to http://127.0.0.1:8787/ nixpkgs#hello` uploads the complete closure successfully.
- actual: The daemon accepts PUTs for `h5y...`'s NAR and narinfo with HTTP 200, but subsequent GET/HEAD requests for that narinfo return 404 and Nix refuses to upload dependent `kpc...`.
- errors: `cannot add '/nix/store/kpcd405yxfc3pfv8x4mv5j3fj54v946p-libidn2-2.3.8' to the binary cache because the reference '/nix/store/h5yzhyi8j6iq4r26giryd0rh9ynsayan-libunistring-1.4.2' is not valid`
- timeline: Reproduced on 2026-08-13 after write capability becomes ready and a durable publication batch is resumed.
- reproduction: Run `nix copy --refresh --to http://127.0.0.1:8787/ nixpkgs#hello` against the daemon configured as shown in the supplied server log.

## Current Focus

- hypothesis: EligibilityModel treats the candidate's own store-path hash in Nix References as an unresolved external dependency, preventing ordinary self-referential narinfos from ever entering the overlay
- test: completed native nix copy workflow plus final automated checks
- expecting: complete closure uploads without invalid-reference rejection
- next_action: archive session and commit resolved fix
- bug_class: bohrbug
- reasoning_checkpoint:
    hypothesis: EligibilityModel treats a candidate's own hash in Nix References as an external prerequisite, so standard self-referential store paths can never satisfy closure in an empty writable overlay.
    confirming_evidence:
      - Native Nix metadata for the exact h5y... path lists h5y... itself in References.
      - A focused HTTP test with that exact self-reference returns 200 for both PUTs but leaves overlay.storePaths empty.
    falsification_test: If treating reference === candidate.storePathHash as locally closed does not commit the regression candidate, this hypothesis is wrong.
    fix_rationale: A store path necessarily exists as the candidate being evaluated; its self-reference is not a separate prerequisite. Exempting only that exact hash preserves all external closure checks.
    blind_spots: Full native nix copy remains a human UAT because the automated test isolates the protocol state rather than launching the daemon and Nix CLI.
    candidate_causes:
      - code: reference closure lacks a self-reference exemption
      - data: standard Nix narinfos include their own store path in References
    and_gate: yes; the code omission manifests on self-referential Nix metadata

## Evidence

- timestamp: 2026-08-13
  checked: normal eligibility and overlay flow
  found: EligibilityModel admits a candidate after both its narinfo index and NAR blob exist, and commitOverlay refreshes the overlay synchronously before onStaged returns.
  implication: ordinary dependency ordering and committed-overlay reference checks do not explain an independent dependency with a complete NAR and narinfo.

- timestamp: 2026-08-13
  checked: HTTP narinfo PUT idempotency branch
  found: createNixHttpHandler only parses and calls recordNarInfo when stage() returns idempotent=false; it still calls onStaged and returns 200 when idempotent=true.
  implication: an identical staged narinfo blob lacking its staged_narinfos metadata row is accepted but invisible to eligibility and GET/HEAD.

- timestamp: 2026-08-13
  checked: focused partial-state integration reproduction
  found: Both PUT requests returned 200, stagedCandidateHashes remained empty after the idempotent narinfo upload, and final narinfo GET returned 404 instead of the specified 200.
  implication: the hypothesis is confirmed and directly reproduces the reported acceptance/visibility contradiction.

- timestamp: 2026-08-13
  checked: actual Nix closure metadata for nixpkgs#hello
  found: The reported h5y... libunistring store path has References containing h5y... itself; kpc... similarly references itself plus h5y.... EligibilityModel requires every reference to be committed, newly admitted, or present in a lower cache, but does not exempt candidate.storePathHash.
  implication: a normal self-referential Nix narinfo is accepted and indexed but cannot be admitted into an empty writable overlay, exactly producing PUT 200 followed by GET 404.

- timestamp: 2026-08-13
  checked: repeatedly resumed publication batch interaction
  found: PublicationCoordinator emits batch_resumed on every tick for an active saga; it does not mutate overlay generations or eligibility state during the pre-admission path.
  implication: the repeated batch log is a separate retry/diagnostic symptom, not necessary for the invalid-reference failure.

- timestamp: 2026-08-13
  checked: native-shaped self-reference regression before fix
  found: NAR and narinfo PUTs both returned 200, but overlay.storePaths remained empty instead of containing h5y..., reproducing the admission failure deterministically.
  implication: self-reference handling is a confirmed remaining root cause.


## Eliminated

- hypothesis: unconditional re-indexing of idempotent narinfo bytes fully explains the live failure
  evidence: Native verification after that fix still produced PUT 200 followed 70ms later by GET 404 on two runs.
  timestamp: 2026-08-13


## Resolution

- root_cause: EligibilityModel treated a candidate's own store-path hash in standard Nix References as an unresolved external dependency, so self-referential paths such as h5y... were accepted but never committed to the writable overlay. A secondary recovery gap skipped semantic re-indexing on idempotent narinfo PUTs.
- fix: Treat a candidate's exact self-hash as locally closed during eligibility while preserving external reference checks; also parse and record narinfo metadata on idempotent retries. Added native-shaped self-reference and partial-state regressions.
- verification:
    target_test: { result: pass }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not configured in this Deno project", mutant_killed: false }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false }
    adjacent_tests: { result: pass, suites_run: ["tests/integration/writable_cache_test.ts (13 tests, including external-reference and unanchored-cycle neighbors)", "deno fmt --check", "deno check", "git diff --check"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
    guardrail_verdict: accepted
    human_verification: { result: pass, workflow: "nix copy --refresh --to http://127.0.0.1:8787/ nixpkgs#hello" }
- files_changed:
  - src/nix/http_handler.ts
  - src/write/eligibility.ts
  - tests/integration/writable_cache_test.ts
- oracle_type: specified

## Prevention

- causal_branches:
  - code: Eligibility closure classified every reference as external and had no exact-self case; idempotent staging also conflated durable bytes with semantic-index completion.
  - data: Stock Nix narinfos legitimately list their own store path in References, exposing the missing semantic distinction.
- and_gate: The admission failure required standard self-referential metadata plus the missing exact-self eligibility rule.
- why_not_caught: No integration test exercised stock Nix self-referential References through PUT admission and immediate GET visibility.
- recurrence_guard: `tests/integration/writable_cache_test.ts` now includes `self-referential Nix narinfo commits to the writable overlay` and `idempotent narinfo PUT repairs a missing metadata index`.
