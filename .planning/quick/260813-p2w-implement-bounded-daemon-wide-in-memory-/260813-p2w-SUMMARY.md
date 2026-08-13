---
quick_id: 260813-p2w
status: complete
completed: 2026-08-13
commit: f8a88df
---

# Bounded verified Hashtree manifest cache

Implemented one daemon-scoped in-memory LRU for strictly decoded, hash-verified
Hashtree manifests. Read requests and writable eligibility reconciliation now
reuse completed manifest nodes while retaining request-local traversal and
decoded-byte accounting.

The cache is bounded by both entry count and validated decoded size, isolates
in-flight work by ordered source plan, separates waiter cancellation from
daemon shutdown, and emits compact `nixstr:hashtree:cache` diagnostics without
logging manifest objects or complete source URLs.

Configuration now supports `manifestCacheEntries` (default 1024, ceiling
16384) and `manifestCacheBytes` (default 64 MiB, ceiling 512 MiB), including
the matching `NIXSTR_LIMIT_*` environment overrides.

## Verification

- `deno task verify` passed using a project-local `TMPDIR` to work around the
  host `/tmp` user quota.
- 28 protocol tests passed.
- 138 integration tests passed.
- 2 stock-Nix E2E tests passed.
- `deno fmt --check`, `deno lint`, `deno check`, and `git diff --check` passed.
