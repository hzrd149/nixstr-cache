---
quick_id: 260813-ogk
status: complete
commit: 3d7c14a
---

# Summary

Added `@grammyjs/debug@0.3.1` and opt-in, correlated HTTP tracing. With
`DEBUG=nixstr:http:*` or `DEBUG=*`, operators can inspect inbound request
lifecycles, handler routing/staging/cache decisions, and outbound safe-fetch
attempts, results, redirects, and classified failures.

Debug fields are constructed from an allow-listed schema and flattened into
compact single-line `key=value` messages. They omit bodies and headers and
sanitize paths and endpoints by removing credentials, queries, and fragments.
Debugging remains disabled by default.

## Verification

- Direct `DEBUG=*` smoke test produced both request and upstream namespaces
  without URL secrets.
- `deno task check`
- `deno task verify`
- 23 protocol tests passed
- 136 integration tests passed
- 2 stock-Nix E2E tests passed
