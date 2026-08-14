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

## hashtree-writer-always-wraps — Writable files used noncanonical manifest wrappers and incomplete publication inventory
- **Date:** 2026-08-14
- **Error patterns:** type 1 below 2 MiB, raw type 0 missing, components-only file became type 2, candidate inventory omitted staged NAR chunks
- **Root cause(s):** `HashtreeWriter` conflated logical-file source shape, candidate reachability, and BUD-17 wire representation: its durable index recognized only path-backed files, its inventory recorded only newly persisted bytes, and its file builder always emitted a manifest node.
- **Fix:** Persist explicit file/source-kind and ordered components, register reused raw leaves in bounded run-owned inventory, and emit direct type-0 links for zero/one canonical chunk while retaining type-1 manifests above 2 MiB.
- **Files changed:** src/hashtree/writer.ts, tests/protocol/hashtree_writer_test.ts, tests/integration/publication_batch_test.ts, tests/integration/hostile_blossom_test.ts
- **Why not caught:** Existing golden vectors pinned the noncanonical wrapped roots, the pre-chunked test asserted only a coarse inventory count, and no publication test named every reachable raw component hash.
- **Recurrence guard:** Boundary/direct-link and staged-component tests in tests/protocol/hashtree_writer_test.ts; durable pending-inventory closure in tests/integration/publication_batch_test.ts; dual type-0/type-1 HEAD, ordered GET, and hash-mismatch coverage in tests/integration/hostile_blossom_test.ts.
---
