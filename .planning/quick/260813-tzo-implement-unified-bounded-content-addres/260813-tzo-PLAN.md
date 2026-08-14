---
quick_id: 260813-tzo
type: quick-index
status: complete
plans: 4
---

# Unified bounded content-addressed blob storage

Execute these plans in order:

1. `260813-tzo-01-PLAN.md` — preserve the partial-NAR prerequisite, implement the capacity-authoritative store, configuration, recovery, and idempotent legacy migration.
2. `260813-tzo-02-PLAN.md` — convert verified remote reads and Hashtree resolution to persistent cache entries and transient leases.
3. `260813-tzo-03-PLAN.md` — convert chunked PUT, overlay, Hashtree building, and publication ownership to the shared store.
4. `260813-tzo-04-PLAN.md` — finish daemon/config integration, remove `localBlossomUrl`, and prove cold/warm stock-Nix flows.

All four plans preserve the locked 16 GiB single ceiling, separate decoded
manifest LRU, streamed/backpressured byte paths, remote-cache eviction, immediate
final-owner cleanup for write bytes, and compatible idempotent migration.
