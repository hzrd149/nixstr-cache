---
schema_version: 1
open_count: 6
waived_count: 0
fixed_count: 0
total_count: 6
last_updated: 2026-08-12T13:46:21.923Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | src/protocol/publication.ts |  | Reconstruct NIP-01 verification input to defeat inherited verification cache | open |  | 2026-08-12T10:49:36.426Z |  |
| 2 | 01 | deviation | src/persistence/state_repository.ts |  | Use built-in SQLite and private reactive admission to preserve no-env permission contract | open |  | 2026-08-12T10:49:36.589Z |  |
| 3 | 01 | deviation | tests/integration/hostile_blossom_test.ts |  | Literal Deno filter markers added so planned test commands execute intended groups | open |  | 2026-08-12T10:59:20.998Z |  |
| 4 | 01 | deviation | src/blossom/blob_fetcher.ts |  | Repository verification required lockfile resolution and lint-safe cleanup | open |  | 2026-08-12T10:59:21.138Z |  |
| 5 | 01 | deviation | tests/e2e/nix_substitution_test.ts |  | Canonical root manifest order corrected during stock Nix E2E | open |  | 2026-08-12T11:13:30.387Z |  |
| 6 | 02 | deviation | tests/integration/blossom_discovery_test.ts |  | Adapted scalar BUD-03 regression assertions to the merged snapshot API | open |  | 2026-08-12T13:46:21.923Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "01",
    "file": "src/protocol/publication.ts",
    "line": null,
    "description": "Reconstruct NIP-01 verification input to defeat inherited verification cache",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T10:49:36.426Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "01",
    "file": "src/persistence/state_repository.ts",
    "line": null,
    "description": "Use built-in SQLite and private reactive admission to preserve no-env permission contract",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T10:49:36.589Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "01",
    "file": "tests/integration/hostile_blossom_test.ts",
    "line": null,
    "description": "Literal Deno filter markers added so planned test commands execute intended groups",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T10:59:20.998Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "01",
    "file": "src/blossom/blob_fetcher.ts",
    "line": null,
    "description": "Repository verification required lockfile resolution and lint-safe cleanup",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T10:59:21.138Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "01",
    "file": "tests/e2e/nix_substitution_test.ts",
    "line": null,
    "description": "Canonical root manifest order corrected during stock Nix E2E",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T11:13:30.387Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "02",
    "file": "tests/integration/blossom_discovery_test.ts",
    "line": null,
    "description": "Adapted scalar BUD-03 regression assertions to the merged snapshot API",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-12T13:46:21.923Z",
    "resolved_at": null
  }
]
````
