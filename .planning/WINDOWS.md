---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-08-12T10:49:36.589Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | src/protocol/publication.ts |  | Reconstruct NIP-01 verification input to defeat inherited verification cache | open |  | 2026-08-12T10:49:36.426Z |  |
| 2 | 01 | deviation | src/persistence/state_repository.ts |  | Use built-in SQLite and private reactive admission to preserve no-env permission contract | open |  | 2026-08-12T10:49:36.589Z |  |

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
  }
]
````
