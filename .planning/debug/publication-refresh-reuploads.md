---
status: resolved
trigger: "The constant reuploading of the current writeable hashtree is still happening. why would we reupload the hashtree at all after successfully publishing it and uploading it?"
created: 2026-08-14
updated: 2026-08-14
---

## Symptoms

- Expected: refreshing an already published event for an unchanged immutable Hashtree must not upload the tree again.
- Actual: startup resumes root `94f41d184bb8` and uploads all 56 blobs to the persisted destinations again.
- Errors: no explicit error; persisted progress initially reports two failed replicas.
- Reproduction: start the daemon with an admitted writable publication whose expiration is inside the refresh lead window.

## Current Focus

- hypothesis: confirmed; `beginPublicationRefresh` discarded reusable replica evidence for an unchanged immutable root.
- test: extend publication recovery coverage to count replica calls across expiration refresh.
- expecting: refresh signs and republishes a new event while making zero new replica calls for the already complete server.
- next_action: resolved; monitor the next expiration refresh for relay-only activity.

## Evidence

- timestamp: 2026-08-14T14:00:00Z
  observation: `beginPublicationRefresh` copies the blob inventory, then deletes endpoint work and blob proofs and inserts the replacement saga without `complete_server`.
  implication: an unchanged immutable root is forcibly treated as unreplicated on every expiration refresh.

## Eliminated

- hypothesis: same-time retry bypass alone causes this trace.
  reason: retry due-time gating is present; expiration refresh independently erases the successful replica state.

## Resolution

- root_cause: Expiration refresh copied the immutable blob inventory but deleted all blob proofs and endpoint work, then created the replacement saga without its complete-server marker. The coordinator therefore performed initial replication again before signing the refreshed event.
- fix: Carry the complete-server marker, blob proofs, and replica endpoint state into the replacement saga. Relay endpoint state is not copied because the refreshed signed event must be published. Recover already-corrupted unsigned refresh sagas from an admitted historical publication of the identical root, suppressing further automatic uploads for that legacy refresh.
- verification: `deno check main.ts`; lint; 53 protocol tests; 178 integration tests; regression clears persisted refresh evidence in the old buggy shape and asserts zero additional replica calls during recovery.
- files_changed: `src/persistence/write_repository.ts`, `tests/integration/publication_recovery_test.ts`
