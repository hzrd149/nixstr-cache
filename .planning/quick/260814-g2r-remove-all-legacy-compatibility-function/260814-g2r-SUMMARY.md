---
status: complete
quick_id: 260814-g2r
commit: 25e0d67
---

# Legacy compatibility cleanup summary

Removed the pre-release BlobStore migration layer, global spool configuration, obsolete configuration aliases, migration-only database tables, and malformed wire-size Hashtree compatibility. Current BlobStore download caching, writable NAR chunk storage, `.narinfo` staging, and writer scratch storage remain intact.

The cleanup also made database-parent creation explicit instead of relying on the removed spool directory as an incidental side effect. Canonical Hashtree logical-size enforcement now has a rejection regression test.

Verification passed: tracked-file formatting, lint, type checks, 30 protocol tests, 151 integration tests, and 2 stock-Nix E2E tests. The repository-wide `deno task verify` wrapper remains unable to pass its initial formatting gate because it includes the unrelated untracked and intentionally unformatted `config.old.json`; that file was not modified or committed.
