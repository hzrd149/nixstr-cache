---
status: complete
quick_id: 260813-eh3
completed: 2026-08-13
commit: ea932eb
---

# Remove obsolete `@db/sqlite` dependency — Summary

Removed the unused `@db/sqlite` import-map entry and its transitive JSR lock entries. Existing `node:sqlite` production and test imports remain unchanged, so public APIs, schemas, transaction boundaries, database paths, and on-disk formats are unaffected.

Updated active stack guidance in `AGENTS.md`, `.planning/research/STACK.md`, and `.planning/research/SUMMARY.md` to specify Deno-bundled `node:sqlite` and the synchronous `DatabaseSync` capabilities used by the project. Historical milestone artifacts were not changed.

## Verification

- Active reference scan: passed; no `@db/sqlite` references remain.
- `deno info --json main.ts`: reports `node:sqlite` and no JSR SQLite module.
- `deno task lint`: passed.
- `deno task check`: passed.
- `deno task test`: passed, 23 tests.
- `deno task test:integration`: passed, 105 tests, including persistence, publication recovery, and Hashtree writer coverage.
- `deno task test:nix-e2e`: passed both stock-Nix end-to-end scenarios.
- `deno task fmt`: blocked by four unrelated, pre-existing unformatted files (`README.md`, `main.ts`, `src/config/config.ts`, and `tests/integration/operator_config_test.ts`) belonging to another in-progress quick task. This cleanup did not modify those files.

No application behavior or database migration was introduced.
