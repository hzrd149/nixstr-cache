---
status: resolved
trigger: "After both Blossom server passes finish without a complete replica, the same root immediately starts uploading to both servers again instead of waiting for durable retry backoff."
created: 2026-08-14T13:46:00Z
updated: 2026-08-14T13:52:00Z
---

# Symptoms

- expected: Each server receives one initial pass. Incomplete replicas retry only when their durable endpoint work becomes due.
- actual: Both 56-blob passes restart immediately for the same root.
- errors: No explicit error; repeated `Starting Blossom upload` lines expose the loop.
- timeline: Observed after parallel initial replica publication shipped.
- reproduction: Publish a root for which neither server establishes a complete replica on its first pass.

# Current Focus

- bug_class: bohrbug
- hypothesis: CONFIRMED — every coordinator wake-up reran initial replication while `completeServer` was absent, bypassing endpoint `nextAttemptAt`; prematurely-created relay work also woke the unsigned saga.
- test: Run a failed initial pass, tick at the same time and just before backoff, then at the due time while counting replica calls and relay rows.
- expecting: Calls remain unchanged before the durable due time, relay work is absent before signing, and one retry occurs when due.
- next_action: Resolved; verify on the reported two-server deployment that the immediate duplicate pass is gone.

# Evidence

- timestamp: 2026-08-14T13:46:00Z
  checked: `PublicationCoordinator.#run` and `WriteRepository.nextDueWork`
  found: `#run` calls `#replicateInitial` for every incomplete saga without consulting endpoint status/time; relay rows are inserted at claim time and participate in the nearest-due scheduler before signing.
  implication: Outcome backoff is persisted but ignored, and an unusable pending relay row can immediately wake the saga.
- timestamp: 2026-08-14T13:52:00Z
  checked: focused publication loop and restart recovery suites
  found: A deterministic regression proves same-time and pre-backoff ticks make zero additional replica calls, the due tick makes exactly one retry pass, unsigned sagas create no relay work, and all 11 focused tests pass.
  implication: Initial attempts now obey the same durable schedule as repair without weakening restart recovery.

# Eliminated

# Resolution

- root_cause: Incomplete sagas called `#replicateInitial` on every coordinator tick without filtering replica endpoint status or `nextAttemptAt`. Relay endpoint rows were also created before signing, leaving immediately due but unactionable work that repeatedly woke the saga.
- fix: Initial replication now receives only pending or due-retry replica targets. If none are due, the saga remains waiting without network work. Relay endpoint work is created only after the exact root event has been signed.
- verification: Focused publication-loop and recovery suites pass 11/11, including the new same-time, pre-backoff, due-time, and no-premature-relay regression.
- files_changed: `src/write/publication_coordinator.ts`, `tests/integration/publication_loop_test.ts`
