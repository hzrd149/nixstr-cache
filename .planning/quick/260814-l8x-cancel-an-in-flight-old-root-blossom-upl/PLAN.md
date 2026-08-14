---
quick_id: 260814-l8x
status: in_progress
---

# Cancel obsolete uploads when a new Hashtree batch starts

When the publication-window elapsed diagnostic is emitted, cancel only the active Blossom authorization/upload phase for the older candidate. Continue building the new Hashtree, allow its newer pending candidate to replace the cancelled unsigned saga, and start its one-shot upload. Do not cancel signing or relay publication that has already passed the replica barrier.

## Tasks

1. Add a batch-start callback at the exact `publication_window_elapsed` transition.
2. Give the publication coordinator a replaceable, replica-phase-only cancellation signal.
3. Permit a newer candidate to supersede an unsigned incomplete saga and retire its endpoint work.
4. Wire the daemon callback and add cancellation/supersession regressions.
5. Run all quality gates and commit atomically.

## Safety

- Daemon shutdown remains a permanent abort distinct from supersession.
- Cancelled uploads remain terminal and never retry in the background.
- A signed or committed saga is never discarded by this path.
