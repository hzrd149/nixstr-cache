---
quick_id: 260814-k1n
status: complete
commit: 0a4ca9f
completed: 2026-08-14
---

# Quick Task 260814-k1n Summary

Initial Blossom replication now runs ordered server workers in parallel under
`writable.publication.concurrency`. The first server to prove the complete
inventory unlocks signing and relay publication; sibling requests are canceled
and recorded as durable retry work. Blob uploads remain serial within each
server, and exact endpoint claiming prevents parallel workers from claiming
unrelated replica or relay rows.

Publication no longer downloads blobs for proof. Existing blobs require an
exact-size BUD-01 HEAD response. Missing blobs stream through authenticated PUT
and require a bounded JSON descriptor whose hash and size match the immutable
candidate. Read-side verified downloads are unchanged.

## Verification

- Tracked-file formatting, lint, and type checking pass.
- 53 protocol tests and 176 integration tests pass.
- Both stock-Nix E2E tests pass, including the two-generation publication and
  substitution round trip over the preserved remote Hashtree base.
- Focused tests prove initial overlap, configured concurrency bounds,
  first-complete sibling cancellation, exact-size HEAD handling, no publication
  GET requests, durable retry, restart recovery, and shutdown behavior.
