---
quick_id: 260814-hud
status: complete
completed: 2026-08-14
subsystem: operator-diagnostics
tags: [publication, progress, tty, debug]
commit: 4e859f0
---

# Quick Task 260814-hud Summary

Replaced raw publication-event console dumps with bounded, secret-safe operator progress that distinguishes initial availability from complete replication.

Normal output presents Blossom and relay success, failure, retry, and exhaustion counts without identifiers, endpoints, timings, JSON, or object payloads. The coordinator emits an additive durable `publication_progress` diagnostic at resume and after endpoint outcomes, preserving existing structured diagnostic contracts. Full publication is derived only from all configured endpoint-work rows reaching `complete` and is announced once per batch. Technical scalar detail is available through `DEBUG=nixstr:write:publication`, with endpoints sanitized.

## Commits

- `4ba17df` — RED publication presentation expectations
- `edcec53` — bounded console publication presenter and compact DEBUG boundary
- `2d98d0d` — durable progress and retry coverage
- `06c01ec` — coordinator-derived endpoint progress metadata
- `4e859f0` — lint-safe output assertions

## Verification

- Scoped formatting and lint checks passed for all five planned files.
- Focused suite: 14 passed; protocol: 31 passed; integration: 158 passed; stock-Nix E2E: 2 passed.
- Full type check passed.
- `deno task verify` stopped only because excluded untracked `config copy.json` fails global formatting; every subsequent constituent verification task passed without modifying it.

## Deviations from Plan

None — implementation stayed within the five planned files.

## Known Stubs

None.

## Self-Check: PASSED

All planned files exist and all five task commits are present.
