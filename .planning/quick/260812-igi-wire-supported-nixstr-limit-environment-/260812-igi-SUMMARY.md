---
quick_id: 260812-igi
status: complete
subsystem: operator-configuration
tags: [deno, environment, limits, startup-validation]
files_modified:
  - main.ts
  - tests/integration/operator_config_test.ts
commits:
  - b90ea77
  - a7b6958
completed: 2026-08-12
---

# Production NIXSTR limit environment wiring

The shipped daemon entry point now collects all fifteen supported
`NIXSTR_LIMIT_*` variables through one exported, dependency-injectable,
narrowly allow-listed environment boundary. The executable branch calls that
same collector, eliminating the untested production-only allow-list that had
made limit overrides unreachable.

Integration coverage supplies distinct non-default values for every limit,
parses the collected raw configuration, and asserts the exact validated
camel-case fields. A malformed limit also proves configuration diagnostics are
returned before relay creation, listener binding, or filesystem creation.

## Verification

- `deno test --allow-env --allow-read --allow-write tests/integration/operator_config_test.ts` — 9 passed
- `deno fmt --check main.ts tests/integration/operator_config_test.ts` — passed
- `deno lint main.ts tests/integration/operator_config_test.ts` — passed
- `deno check main.ts tests/integration/operator_config_test.ts` — passed
- `deno task verify` — passed, including 12 protocol tests, 50 integration tests, and the stock-Nix end-to-end test
- `git diff --check` — passed

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- Both modified files exist.
- TDD RED commit `b90ea77` and GREEN commit `a7b6958` exist.
- The focused and full verification commands passed.
