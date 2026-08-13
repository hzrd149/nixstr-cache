# Quick Task 260813-tzo: Unified Bounded Content-Addressed Blob Storage - Research

**Researched:** 2026-08-13
**Domain:** Persistent content-addressed storage, streaming NAR ingestion, crash-safe ownership and eviction
**Confidence:** HIGH (current code and locked task decisions)

## User Constraints

- Preserve and land the current partial-NAR compatibility fix.
- Replace read spool, writable staging blobs, and publication candidate blobs with one persistent shared store.
- Use one 16 GiB default hard ceiling.
- Keep the decoded manifest LRU separate.
- Remove `localBlossomUrl`.
- Chunk NARs on PUT.
- Retain verified remote blobs as an evictable read cache.
- Delete write-origin blobs immediately after final durable ownership ends.
- Migrate legacy spool/staging compatibly and idempotently.

## Summary

The present implementation has three byte stores with incompatible lifetimes: `BlobFetcher` creates verified temporary spool files and deletes them when `VerifiedBlob` references reach zero; `WriteRepository.stage()` persists whole PUT bodies under `staging/blobs/<sha256>` and accounts only distinct staged digests; `HashtreeWriter` persists candidate blobs in `candidate-blobs/<sha256>` and tracks run/batch/saga ownership in `content_blobs` plus `blob_owners`. [VERIFIED: codebase `src/blossom/blob_fetcher.ts`, `src/persistence/write_repository.ts`, `src/hashtree/writer.ts`]

Use one daemon-owned `BlobStore` rooted beside the state database, with immutable files addressed by lowercase SHA-256 and a SQLite catalog that distinguishes durable owners, transient open leases, reservations, and evictable remote-cache status. [ASSUMED] Keep `WriteRepository` responsible for write-domain routes/generations/publication state, but make it acquire/release blob-store ownership rather than own physical paths or perform deletion. [ASSUMED]

**Primary recommendation:** Introduce the shared store and migration first, adapt fetch/read and PUT chunking second, then convert writer/publication ownership and remove the legacy configuration only after parity tests pass. [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary owner | Secondary owner | Rationale |
|---|---|---|---|
| Physical blob admission, accounting, eviction | `BlobStore` | SQLite catalog | One authority must enforce the single hard ceiling. [ASSUMED] |
| Remote fetch verification | `BlobFetcher` | `BlobStore` | Fetcher verifies transport bytes; store atomically admits the verified temp file. [ASSUMED] |
| PUT route semantics and overlay generations | `WriteRepository` | `BlobStore` | Route conflicts and generations are write-domain state; byte ownership is shared-store state. [ASSUMED] |
| Hashtree construction | `HashtreeWriter` | `BlobStore` | Writer constructs canonical manifests and chunks; store deduplicates/persists them. [ASSUMED] |
| Publication saga ownership | `WriteRepository` | `BlobStore` | Saga transitions atomically change durable owner records. [ASSUMED] |
| Decoded manifest caching | `ManifestCache` | — | Existing bounded in-memory LRU remains independent of persistent raw blobs. [VERIFIED: codebase `src/hashtree/manifest_cache.ts`] |

## Recommended Persistent Model

Use a single database transaction boundary for capacity and ownership metadata. If the existing write DB remains separate from the blob catalog, cross-database ownership changes cannot be atomic; therefore either place the catalog tables in `write.sqlite` or `ATTACH` the blob DB and transact both together on the same SQLite connection. [ASSUMED]

```sql
blobs(
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  class TEXT NOT NULL CHECK(class IN ('write','remote','mixed')),
  last_accessed INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ready','deleting'))
)
blob_owners(owner TEXT NOT NULL, hash TEXT NOT NULL,
            PRIMARY KEY(owner, hash), FOREIGN KEY(hash) REFERENCES blobs(hash))
blob_reservations(token TEXT PRIMARY KEY, bytes INTEGER NOT NULL,
                  created_at INTEGER NOT NULL)
blob_tombstones(hash TEXT PRIMARY KEY, retry_at INTEGER NOT NULL)
```

[ASSUMED] Do not persist absolute paths in domain tables; derive `blobs/<first-two-hex>/<hash>` from the validated hash so moves and migration do not rewrite every route/batch row. [ASSUMED] Route/generation/candidate tables should reference hashes and sizes, not paths. [ASSUMED]

Capacity admission must run under `BEGIN IMMEDIATE`: clear stale startup reservations, compute ready physical bytes plus live reservations, evict enough unowned remote blobs, then insert a worst-case reservation before opening a temp file. [ASSUMED] Debit the reservation downward or reject as streaming bytes cross the request/declared ceiling; never count duplicate owners twice. [ASSUMED] The 16 GiB hard ceiling applies to physical ready blobs plus in-flight reserved bytes, not decoded manifests and not SQLite/WAL overhead. [ASSUMED]

Promotion sequence: stream to an owner-only temp file, incrementally hash, `sync()` the file, create the final no-overwrite path on the same filesystem, `sync()` its containing directory, then commit the `blobs` row and first owner/reservation release. [ASSUMED] Startup reconciliation must remove temp files, clear reservations, import valid hash-named orphan files or delete them, and retry tombstoned deletions. [ASSUMED]

Transient readers need an in-process lease/refcount so eviction cannot unlink a file between lookup and open; durable owners remain SQLite rows across restarts. [ASSUMED] Eviction chooses only blobs with no durable owners and no transient lease, ordered by `last_accessed` with deterministic hash tie-break. [ASSUMED] Remote-origin bytes stay after a read as evictable cache; write-origin bytes are deleted synchronously/as part of a durable tombstone retry immediately after their last durable owner and transient lease disappear. [ASSUMED] A deduplicated blob that has both origins is `mixed` and must not be evicted while any durable owner exists. [ASSUMED]

## Streaming PUT and Read Assembly

For `nar/*.nar` PUT, stream the request directly into fixed-size content chunks (reuse the writer's `FILE_CHUNK_BYTES` boundary), incrementally hash each chunk, and admit each chunk with a temporary upload owner. [VERIFIED: codebase `src/hashtree/writer.ts` defines and tests the canonical file chunk boundary] Build canonical file-manifest levels as chunks complete; record the route only after the full body succeeds, its declared/body ceiling matches, and all chunk/manifest owners can transfer atomically to the staged route owner. [ASSUMED] On abort or conflict, release the upload owner and sweep newly unowned write-origin blobs. [ASSUMED]

Keep `.narinfo` and other small metadata on the same store API, but they may remain single blobs. [ASSUMED] `staged_blobs` should evolve from one route→whole-body digest into route metadata plus an ordered route-component table for NAR chunk hashes (or point at the root file-manifest hash); do not reconstruct a whole NAR file during staging. [ASSUMED]

Reads should resolve the authenticated Hashtree to an ordered chunk plan, acquire leases as each chunk is opened, and expose one backpressured `ReadableStream` that releases each lease at EOF/cancel/error. [ASSUMED] Check the local store before network fetch; after a remote hash verifies, admit it as unowned/evictable and return a leased handle. [ASSUMED] HEAD may traverse bounded manifests to derive descendant plaintext size but must not open leaf content chunks; the current partial-NAR patch implements this and accepts only exact descendant plaintext size or the prior canonical manifest wire-size compatibility encoding. [VERIFIED: uncommitted diff and `.planning/debug/partial-nar-stream.md`]

## Migration and Rollout

1. Create/version the blob schema and store directories without deleting legacy data. [ASSUMED]
2. Migrate existing candidate `content_blobs` and owner rows first: verify filename/hash/size, copy/link into the new final path, insert catalog and owners transactionally, then update candidate/saga tables from `path` to `hash`. [ASSUMED]
3. Migrate `staged_blobs`: stream each legacy whole NAR through the new chunker, create its manifest/component rows under a migration owner, atomically swap the route representation, then release the legacy route owner/file. Small non-NAR routes can be admitted as one blob. [ASSUMED]
4. Treat old read-spool files as abandoned temporaries and delete only names matching the exact `.nixstr-spool-*` pattern inside the configured legacy spool directory; they have no durable catalog ownership today. [VERIFIED: codebase `src/blossom/blob_fetcher.ts`]
5. Record a schema migration marker and per-route completion so restart repeats safely. Every step must accept already-present identical hashes and reject mismatched size/content. [ASSUMED]
6. Dual-read legacy route rows during one compatibility window, but write only the new representation. Remove legacy directories/config fields only after migration completion is durable. [ASSUMED]

Migration must never infer trust from a filename alone: rehash every legacy file before admission. [ASSUMED] Preserve the writable identity guard; the current repository refuses binding a different identity when durable write state or staging content exists. [VERIFIED: codebase `src/persistence/write_repository.ts`]

Remove `localBlossomUrl` from raw/validated config, environment mapping, source-plan construction, cache sink wiring, diagnostics, examples, and tests. [VERIFIED: codebase references in `src/config/config.ts` and `src/runtime/daemon.ts`] Do not replace it with an implicit HTTP loopback cache: the shared blob store is the local cache. [ASSUMED]

## Don't Hand-Roll / Reuse

- Reuse incremental `@noble/hashes` SHA-256 and Web Streams; existing fetch and staging paths already use incremental hashing and bounded reads. [VERIFIED: codebase]
- Reuse same-filesystem create-new promotion and SQLite `BEGIN IMMEDIATE`; the staging path already demonstrates these primitives. [VERIFIED: codebase `src/persistence/write_repository.ts`]
- Reuse Hashtree canonical encoding and `FILE_CHUNK_BYTES`; changing chunk boundaries changes pinned roots. [VERIFIED: codebase `tests/protocol/hashtree_writer_test.ts`]
- Do not make the decoded manifest LRU the ownership/accounting source; it stores decoded objects, not durable bytes. [VERIFIED: locked decision]
- Do not use `arrayBuffer()`, `Blob`, or full-NAR temporary files in the new PUT/read path. [VERIFIED: project `AGENTS.md` streaming constraint]

## Validation Architecture

Run the partial-NAR tests unchanged first, then adapt them only for the store fixture:

```bash
deno test tests/protocol/hashtree_writer_test.ts tests/integration/hostile_blossom_test.ts
```

[VERIFIED: current test files]

Add focused tests for: exact 16 GiB accounting by injected small limits; duplicate hash accounting once; concurrent reservations preventing oversubscription; eviction excluding owned/leased blobs; deterministic LRU order; remote retention after response disposal; immediate write-origin deletion after final owner; mixed-origin behavior; cancel/error lease release; crash points before/after file sync, rename/link, DB commit, and unlink; stale reservation/temp recovery; missing/corrupt catalog files; PUT chunk boundaries at `N-1/N/N+1`; streaming assembly and cancellation; idempotent same-body PUT; conflict cleanup; and migration restart at every checkpoint. [ASSUMED]

Integration coverage should prove a migrated staged NAR remains readable and publishable, a migrated pending saga resumes upload, stock-Nix GET receives byte-identical output, and removal of `localBlossomUrl` leaves remote source planning plus local shared-store hits functional. [ASSUMED]

## Common Pitfalls

- **Deleting before durable transfer:** releasing a run owner before the batch/saga owner commits loses publication bytes. Transfer owners in one transaction. [VERIFIED: current ownership design in `WriteRepository.admitCandidate()`]
- **Reservation equals bytes received:** concurrent streams can each fit individually and exceed the global ceiling. Reserve a declared/operator worst case before I/O. [VERIFIED: current staging reservation pattern]
- **Evicting an open inode:** Unix may mask this while Windows/read-reopen behavior fails. Lease before path lookup/open and release on every stream terminal path. [ASSUMED]
- **Whole-file rechunking during every build:** this repeats I/O and temporarily doubles disk usage. Chunk once at PUT and build manifests from stored component descriptors. [ASSUMED]
- **Non-atomic multi-DB changes:** filesystem cleanup cannot repair ownership committed in only one database. Share one SQLite transaction boundary. [ASSUMED]
- **Treating legacy wire size as plaintext universally:** the compatibility patch permits only the exact canonical legacy manifest wire length, and arbitrary mismatches remain errors. [VERIFIED: current partial-NAR patch]
- **Deleting unknown legacy files:** restrict cleanup to validated paths/patterns and quarantine unexpected entries for operator review. [ASSUMED]

## Security Domain

| Control | Required behavior |
|---|---|
| Input validation | Validate lowercase SHA-256, safe sizes, canonical manifests, routes, and configured roots before filesystem use. [VERIFIED: project constraints/current code] |
| Resource limits | Enforce per-transfer/request limits plus the single physical-store ceiling and bounded reservations. [VERIFIED: locked decision] |
| Integrity | Hash while streaming and expose bytes only after full blob verification/admission. [VERIFIED: project constraints] |
| Access control | Store/temp directories remain owner-only; writable ownership remains signer-derived. [VERIFIED: current code/project constraints] |
| Availability | Eviction and cleanup errors become durable retry state and diagnostics, not silent accounting drift. [ASSUMED] |

## Assumptions Log

All recommendations tagged `[ASSUMED]` are design conclusions derived from the locked decisions and current code; they require planner acceptance because no external specification defines this project's storage schema. The most consequential choice is using one SQLite transaction boundary for blob metadata and write ownership. [ASSUMED]

## Sources

- Current uncommitted diff: partial-NAR reader/writer compatibility and tests. [VERIFIED: codebase]
- `.planning/debug/partial-nar-stream.md`: diagnosis and specified compatibility oracle. [VERIFIED: project artifact]
- `src/blossom/blob_fetcher.ts`: verified spool lifecycle. [VERIFIED: codebase]
- `src/persistence/write_repository.ts`: staging reservations, routes, generations, owners, candidates, and sagas. [VERIFIED: codebase]
- `src/hashtree/writer.ts`: canonical chunking, immutable candidate persistence, and writer-run ownership. [VERIFIED: codebase]
- `src/runtime/daemon.ts`, `src/config/config.ts`: composition and `localBlossomUrl` surface. [VERIFIED: codebase]
- `AGENTS.md`: normative streaming, integrity, resource, network, and deployment constraints. [VERIFIED: project instructions]
