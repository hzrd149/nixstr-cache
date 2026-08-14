---
quick_id: 260814-ikl
status: in_progress
description: Make the publication quiet delay configurable and log when the publication window expires and Hashtree publication begins
---

# Quick Task 260814-ikl Plan

## Task 1: Add the publication quiet-delay configuration

- Extend raw, validated, JSON, and environment configuration with `writable.publication.quietSeconds` / `NIXSTR_WRITABLE_PUBLICATION_QUIET_SECONDS`.
- Default to 5 seconds and accept positive safe integers through 60 seconds.
- Document the option while retaining the fixed 60-second sustained-write cap.
- Verify defaults, overrides, environment mapping, and invalid bounds in operator configuration tests.

## Task 2: Wire scheduling and operator-visible publication startup logging

- Inject the configured quiet delay into `PublicationBatchScheduler`; retain the atomic quiet/maximum timer race and restart deadline behavior.
- After a timer successfully claims a frozen batch, emit a typed diagnostic identifying the quiet or maximum trigger, batch, generation, and entry count.
- Render one INFO console line stating that the delay elapsed and Hashtree publication is starting; stale timers and failed claims emit nothing.
- Add fake-clock scheduler and console diagnostic coverage, preserving existing user changes in overlapping diagnostics tests.

## Verification

- Run focused operator-config, publication-batch, debug-logging, and health-diagnostics integration tests.
- Run `deno task check`, formatting checks for touched files, and the full `deno task verify` suite.
