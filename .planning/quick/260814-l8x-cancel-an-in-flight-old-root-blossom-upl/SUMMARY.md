---
quick_id: 260814-l8x
status: complete
commit: 928cf81
completed: 2026-08-14
---

# Cancel obsolete uploads when a new Hashtree batch starts — Summary

The publication-window transition now cancels an active Blossom authorization/upload for the older root. Cancellation is scoped to the replica phase, remains terminal under the no-retry policy, and does not interrupt signing or relay publication after the availability barrier.

When the new Hashtree finishes building, its higher-generation candidate may replace the cancelled unsigned saga. The new root then receives its normal one-shot upload attempt.

## Verification

- `deno task fmt`
- `deno task lint`
- `deno task check`
- 53 protocol tests passed
- 179 integration tests passed
- Regression covers exact batch-start notification, active request abortion, and unsigned-saga supersession.

## Implementation commit

- `928cf81 feat: supersede in-flight Blossom uploads`
