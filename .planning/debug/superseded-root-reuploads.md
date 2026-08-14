---
status: resolved
trigger: "After root 0afabb73b5eb fully publishes, the daemon starts uploading superseded root 94f41d184bb8 again."
created: 2026-08-14
updated: 2026-08-14
---

## Symptoms

- Expected: once a newer writable root is fully published, older roots never perform further Blossom network work.
- Actual: after root `0afabb73b5eb` completes, retry workers upload historical root `94f41d184bb8` to two servers.
- Errors: both historical replica attempts eventually fail and retry again.
- Reproduction: publish a newer generation while an admitted older saga still has retryable replica endpoint rows.

## Current Focus

- hypothesis: confirmed; archived sagas retained executable endpoint work and the global repair claim included historical batches.
- test: create retryable replica work for generation one, publish generation two, advance the retry clock, and assert no generation-one replica call occurs.
- expecting: old endpoint work is retired during rollover and stale persisted work is rejected by the repair loop without network I/O.
- next_action: resolved; restart the daemon so the active-batch queue filter takes effect.

## Evidence

- timestamp: 2026-08-14T14:10:00Z
  observation: `claimPublication` archives the admitted saga without deleting `publication_endpoint_work`; `#repair` accepts `publicationSagaByBatch`, which searches active and historical sagas.
  implication: due work for superseded roots remains executable indefinitely.

## Eliminated

- hypothesis: expiration refresh is causing this trace.
  reason: the log switches from newly published root `0afabb...` to a distinct older root `94f41d...`; this is historical repair work.

## Resolution

- root_cause: Generation rollover archived the prior saga but did not delete its `publication_endpoint_work`. `claimDueWork` selected work globally and `#repair` deliberately resolved historical sagas, so retries uploaded superseded roots.
- fix: Delete endpoint work when archiving a superseded saga. Restrict both the next-due scheduler and durable work claims to the active saga, making already-persisted historical rows inert without network I/O.
- verification: `deno check main.ts`; lint; 11 focused publication tests; all 178 integration tests. The rollover regression asserts the old batch has no endpoint work.
- files_changed: `src/persistence/write_repository.ts`, `tests/integration/publication_loop_test.ts`
