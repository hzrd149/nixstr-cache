---
quick_id: 260813-o5i
status: complete
commit: 4639a7d
---

# Summary

Added structured, secret-safe observability for read-cache activity:

- logs the initial effective cache selection and each distinct reactive change;
- logs successful package/Narinfo loads with the winner and every compatible
  cache provider;
- logs the exact Hashtree publication that serves each NAR GET or HEAD, and
  whether it was selected through a pinned Narinfo route or fallback traversal.

## Verification

- `deno task check`
- `deno task verify`
- 23 protocol tests passed
- 134 integration tests passed
- 2 stock-Nix E2E tests passed

