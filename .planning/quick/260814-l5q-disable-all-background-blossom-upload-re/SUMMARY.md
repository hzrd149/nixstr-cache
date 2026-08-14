---
quick_id: 260814-l5q
status: complete
commit: b6dee8d
completed: 2026-08-14
---

# Disable background Blossom upload retries — Summary

Blossom transfers now happen only during the initial publication attempt for a newly claimed root. Failed and cancelled server attempts are recorded as exhausted immediately. Timers, startup recovery, and post-publication repair can claim relay work only, so persisted replica retry rows cannot produce network traffic.

Relay retries remain enabled. Publication still proceeds after one configured Blossom server completes; unsuccessful siblings remain visible in status as exhausted.

## Verification

- `deno task fmt`
- `deno task lint`
- `deno task check`
- 53 protocol tests passed
- 178 integration tests passed

## Implementation commit

- `b6dee8d fix: disable background Blossom retries`
