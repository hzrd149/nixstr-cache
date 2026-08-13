# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## cache-write-invalid-reference — Accepted narinfo remained invisible to dependent Nix uploads
- **Date:** 2026-08-13
- **Error patterns:** PUT 200 then GET 404, reference is not valid, self-referential Nix narinfo, writable overlay
- **Root cause(s):** EligibilityModel treated a candidate's own store-path hash in standard Nix References as an unresolved external dependency; idempotent narinfo retries could also skip semantic re-indexing.
- **Fix:** Treat the candidate's exact self-hash as locally closed while preserving external reference checks, and re-index narinfo metadata after every successful stage.
- **Files changed:** src/write/eligibility.ts, src/nix/http_handler.ts, tests/integration/writable_cache_test.ts
- **Why not caught:** No integration test exercised stock Nix self-referential References through PUT admission and immediate GET visibility.
- **Recurrence guard:** Regression tests `self-referential Nix narinfo commits to the writable overlay` and `idempotent narinfo PUT repairs a missing metadata index` in tests/integration/writable_cache_test.ts.
---
