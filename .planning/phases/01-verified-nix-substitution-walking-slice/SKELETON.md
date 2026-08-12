# Walking Skeleton — nixstr-cache

**Phase:** 1
**Generated:** 2026-08-12

## Capability Proven End-to-End

A single-user operator can run the daemon and a stock Nix 2.34.7 client can substitute one uncached signed store path from a selected, persisted, plaintext Nostr/Blossom cache through a verified bounded stream.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime/framework | Deno `2.9.5`, TypeScript, direct `Deno.serve` | Standards-native HTTP and Web Streams minimize hidden buffering and preserve the existing runtime. |
| Control plane | Applesauce `EventStore`/relay packages plus RxJS 7.8.2 | Verified events feed reactive immutable selections without polling snapshots. |
| Data plane | Web Streams, incremental SHA-256, owner-only temporary spool files | Bytes remain backpressured and cannot be parsed or served until their content address is verified. |
| Durable data | `@db/sqlite` domain repository | Selection watermarks, signed-history, consent, and quarantine advance transactionally across restarts. |
| Network boundary | Address-pinned outbound transport with manual redirects | The socket connects to a DNS-approved address while Host/SNI/certificate checks retain the original hostname. |
| Deployment target | Single-user local daemon; documented local full-stack command | Phase 1 proves the actual stock Nix interaction without introducing a shared-gateway deployment contract. |
| Directory layout | `src/{config,protocol,persistence,nostr,network,blossom,hashtree,nix}` | Trust boundaries remain explicit and reusable by later read, write, and publication slices. |
| Authentication | Read-only trusted-publisher configuration | Signer ownership and PUT authorization begin in Phase 3. |

## Stack Touched in Phase 1

- [x] Project scaffold, exact dependency pins, format/lint/check/test tasks
- [x] Nix HTTP routing with real GET/HEAD routes
- [x] SQLite real write and restart read for freshness/policy state
- [x] Reactive relay input connected to immutable request snapshots
- [x] Documented local full-stack run and real pinned Nix substitution command

## Out of Scope (Deferred to Later Slices)

- Multi-publisher priority merging and duplicate-record conflict handling
- Verified local Blossom write-through caching
- Signer connection, ownership, PUT staging, and writable overlay
- Hashtree construction, replication, Nostr publication, and health endpoint
- BUD-15 self-encrypted Hashtrees

## Subsequent Slice Plan

- Phase 2: merge several trusted publications and add verified local caching.
- Phase 3: accept signer-gated streamed uploads into a complete-object overlay.
- Phase 4: replicate, availability-gate, sign, publish, and substitute back.
