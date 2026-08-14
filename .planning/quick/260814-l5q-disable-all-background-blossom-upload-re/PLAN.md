---
quick_id: 260814-l5q
status: in_progress
---

# Disable background Blossom upload retries

Make blob transfer a one-shot part of initial publication only. Each configured server may be attempted once for a newly claimed root; failed or interrupted replica work becomes exhausted and must never be selected by timers, startup recovery, or the post-publication repair loop. Relay retries remain unchanged.

## Tasks

1. Restrict initial replication to never reconsider retry rows and persist failed replica attempts as exhausted.
2. Restrict durable background scheduling and claiming to relay work only.
3. Update regression tests to prove repeated ticks and retry deadlines cause no further Blossom calls.
4. Run formatting, lint, type-checking, protocol tests, and integration tests; commit atomically.

## Verification

- A failed initial replica attempt is recorded as exhausted.
- Advancing beyond retry backoff and ticking again produces zero additional replica calls.
- Relay work remains retryable.
- Existing persisted replica retry rows are never claimed by background repair.
