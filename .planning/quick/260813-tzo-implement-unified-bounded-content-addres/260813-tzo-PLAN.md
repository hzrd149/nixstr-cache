---
quick_id: 260813-tzo
type: quick
status: ready
autonomous: true
commit: true
files_modified:
  - src/hashtree/reader.ts
  - src/hashtree/writer.ts
  - tests/integration/hostile_blossom_test.ts
  - tests/protocol/hashtree_writer_test.ts
  - src/persistence/blob_store.ts
  - src/persistence/write_repository.ts
  - src/blossom/blob_fetcher.ts
  - src/blossom/source_plan.ts
  - src/blossom/cache_sink.ts
  - src/config/config.ts
  - main.ts
  - src/runtime/daemon.ts
  - src/operations/diagnostics.ts
  - src/write/overlay.ts
  - src/write/batch_scheduler.ts
  - src/write/publication_coordinator.ts
  - tests/integration/blob_store_test.ts
  - tests/integration/blob_store_migration_test.ts
  - tests/integration/operator_config_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/publication_batch_test.ts
  - tests/integration/publication_recovery_test.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
  - tests/e2e/nix_substitution_test.ts
must_haves:
  truths:
    - The current bounded partial-NAR compatibility fix is preserved as a separate prerequisite commit before storage refactoring begins.
    - Every raw Hashtree, NAR chunk, staged metadata blob, and publication candidate blob is stored once by lowercase SHA-256 in one persistent store governed by one default 16 GiB physical-byte ceiling.
    - Verified remote blobs survive request disposal as an unowned evictable LRU read cache, while write-origin bytes disappear immediately after their final durable owner and transient reader lease end.
    - PUT NAR bodies are chunked with the canonical Hashtree writer boundary while streaming; no full NAR file or unbounded body is materialized in memory or as a second staging copy.
    - Restart recovery reconciles reservations, temporary files, catalog/filesystem disagreement, pending deletion, and publication ownership without losing live bytes or exceeding the ceiling.
    - Legacy spool and writable staging/candidate state migrates compatibly and idempotently, including resumable pending publication sagas, without trusting filenames as proof of content.
    - localBlossomUrl is absent from configuration, source planning, daemon wiring, cache population, diagnostics, examples, and tests; the shared store is the only local blob cache.
    - The decoded manifest LRU remains a separate in-memory bound and is neither charged to nor used as authority for the persistent blob store.
  artifacts:
    - src/persistence/blob_store.ts
    - src/persistence/write_repository.ts
    - src/blossom/blob_fetcher.ts
    - src/hashtree/writer.ts
    - src/config/config.ts
    - src/runtime/daemon.ts
    - tests/integration/blob_store_test.ts
    - tests/integration/blob_store_migration_test.ts
    - tests/e2e/nix_publication_roundtrip_test.ts
  key_links:
    - BlobFetcher verifies remote streams and atomically admits them into BlobStore before returning a leased handle.
    - WriteRepository route, generation, batch, candidate, and saga rows reference blob hashes/components and transfer BlobStore owners in the same SQLite transaction boundary.
    - HashtreeWriter consumes stored route-component descriptors and admits canonical manifests/chunks through BlobStore rather than candidate-blobs paths.
    - Daemon startup opens and reconciles BlobStore before read/write services, runs legacy migration before writable activation, and closes it after all streams and publication workers drain.
    - PathResolver and HTTP response streams acquire and release per-blob leases on EOF, cancel, and error while retaining the separate ManifestCache.
---

# Unified bounded content-addressed blob storage

Replace the daemon's temporary read spool, whole-body writable staging, and
candidate publication directories with one crash-safe persistent content store.
The work must preserve the already completed partial-NAR repair, maintain the
protocol's authenticated logical-size behavior, and keep all byte movement
streamed and backpressured.

## Tasks

<task type="auto">
  <name>Task 1: Land the partial-NAR compatibility prerequisite atomically</name>
  <files>src/hashtree/reader.ts, src/hashtree/writer.ts, tests/integration/hostile_blossom_test.ts, tests/protocol/hashtree_writer_test.ts</files>
  <action>Before changing storage APIs, preserve the current uncommitted partial-NAR fix exactly as diagnosed in `.planning/debug/partial-nar-stream.md`: writer links distinguish encoded manifest byte length from descendant plaintext length; reader preflight accepts spec-correct sizes or only the exact prior canonical manifest-wire-size fingerprint, derives authenticated descendant totals under existing depth/link/node/decoded/transfer budgets, performs HEAD without leaf reads, and rejects arbitrary mismatches before HTTP framing. Stage and commit only these four files as a dedicated prerequisite commit such as `fix(hashtree): preserve logical NAR sizes and legacy reads`; do not include `nix/package.nix`, logging changes in `src/network/safe_fetcher.ts`/`src/nix/http_handler.ts`, debug logging tests, planning artifacts, data directories, or any other user changes. Re-read the staged diff before committing so later refactoring cannot obscure or absorb this independently verified fix.</action>
  <verify>
    <automated>deno test tests/protocol/hashtree_writer_test.ts tests/integration/hostile_blossom_test.ts &amp;&amp; test "$(git show -s --format=%s HEAD)" = "fix(hashtree): preserve logical NAR sizes and legacy reads" &amp;&amp; git diff-tree --no-commit-id --name-only -r HEAD | sort | diff -u - &lt;(printf '%s\n' src/hashtree/reader.ts src/hashtree/writer.ts tests/integration/hostile_blossom_test.ts tests/protocol/hashtree_writer_test.ts | sort)</automated>
  </verify>
  <done>The corrected writer and bounded legacy reader behavior pass their regressions and exist in one isolated commit, while every unrelated uncommitted user change remains untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build the capacity-authoritative BlobStore and idempotent migration</name>
  <files>src/persistence/blob_store.ts, src/persistence/write_repository.ts, src/config/config.ts, src/operations/diagnostics.ts, tests/integration/blob_store_test.ts, tests/integration/blob_store_migration_test.ts, tests/integration/operator_config_test.ts</files>
  <behavior>
    - A lowercase SHA-256 blob is physically counted once regardless of duplicate admissions or owner count; physical ready bytes plus live worst-case reservations never exceed the configured ceiling, whose default is exactly 16 * 1024 * 1024 * 1024 bytes.
    - Admission under BEGIN IMMEDIATE evicts only ready remote/mixed blobs with no durable owners and no in-process leases, oldest last-access first with hash as deterministic tie-break; insufficient reclaimable capacity rejects before or during streaming without oversubscription.
    - Promotion hashes incrementally into an owner-only same-filesystem temporary file, syncs file and parent directory, uses no-overwrite content-addressed placement, and commits catalog/owner/reservation state without exposing partially verified content.
    - Durable owners transfer atomically between upload, route/generation, writer-run, batch, and saga roles; a write-only blob is removed immediately after its final owner and lease, a remote blob remains evictable, and a deduplicated mixed-origin blob remains while owned.
    - Startup clears stale reservations and exact store temp names, retries tombstoned deletions, verifies catalog file size/existence, safely imports or quarantines valid hash-named orphans, and emits bounded secret-safe diagnostics for corruption, recovery, eviction, capacity rejection, and deferred deletion.
    - Legacy candidate owner rows/files are rehashed and imported before their rows become hash-only references; whole staged NARs are streamed through canonical chunking with per-route migration markers; pending batches/sagas remain resumable; only exact `.nixstr-spool-*` names in the configured legacy spool are removed.
    - Migration is restartable at every checkpoint, accepts already-present identical content, rejects filename/hash/size disagreement, dual-reads unmigrated route rows, writes only the new representation, and never deletes unknown legacy files.
  </behavior>
  <action>Create a daemon-owned `BlobStore` using the existing write SQLite connection (or an attached catalog on that same connection) so capacity, durable owner transfers, route/candidate state, and reservations share one transaction boundary. Store immutable bytes at `blobs/&lt;first-two-hex&gt;/&lt;hash&gt;`; persist blob size, origin class (`write`, `remote`, `mixed`), last-access time, ready/deleting state, owners, reservations, tombstones, schema/migration version, and per-route migration completion. Expose narrowly typed APIs for reserved streaming admission, verified-file admission, hash lookup plus transient leased stream, owner acquire/transfer/release, inventory iteration, usage/health snapshot, reconciliation, and close. Derive paths from validated hashes rather than persisting new absolute paths. Serialize capacity-changing operations, reserve the worst permitted transfer before opening input, decrement/release reservations on every success/error/cancel path, and make test limits injectable. Keep filesystem contents private (`0700` directories, `0600` files). Refactor `WriteRepository` schema and transactions to reference hashes and ordered route components/file-manifest roots rather than owned physical paths, while retaining legacy columns/tables long enough for dual-read migration and the existing writable-identity fail-closed check. Implement an idempotent startup migrator following the research ordering: candidate/saga ownership first, staged routes second (canonical `FILE_CHUNK_BYTES` streaming for NARs; small metadata remains one blob), then exact abandoned spool cleanup; commit each durable swap before legacy deletion and record progress so interruption at any filesystem/transaction boundary resumes safely. Add configuration for the shared store directory and single ceiling, defaulting the ceiling to 16 GiB and the directory beside the database; retain old `spoolDirectory` and `writable.staging.directory` only as explicit legacy migration inputs for existing deployments, and map old aggregate staging limits only to per-request compatibility—not a second storage ceiling. Keep `manifestCacheEntries`/`manifestCacheBytes` unchanged and separate. Add operational diagnostics and focused fault-injection tests for sync/placement/commit/unlink crash points, concurrent reservations, exact LRU selection, duplicate/mixed ownership, lease release on EOF/cancel/error, stale state recovery, corrupt/missing files, and migration restarts. Commit this storage kernel and migration separately from the path adapters.</action>
  <verify>
    <automated>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/blob_store_test.ts tests/integration/blob_store_migration_test.ts tests/integration/operator_config_test.ts &amp;&amp; deno task check</automated>
  </verify>
  <done>One tested persistent catalog and blob directory authoritatively enforce the 16 GiB default ceiling, crash-safe ownership/leases/eviction, recovery diagnostics, and compatible restartable migration without changing the independent decoded manifest cache.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Convert verified remote reads to persistent leased cache entries</name>
  <files>src/blossom/blob_fetcher.ts, src/hashtree/reader.ts, tests/integration/blob_store_test.ts, tests/integration/hostile_blossom_test.ts</files>
  <behavior>
    - Reads check BlobStore by hash before network; a miss streams and hashes one remote response into reserved admission, exposes bytes only after verification, and retains the admitted blob as evictable cache after request disposal.
    - Resolver output concatenates leased chunks in authenticated order with backpressure and releases the current lease on EOF, cancellation, and error; HEAD performs bounded manifest traversal without opening raw content.
    - Failed remote status, declared-size mismatch, transfer overflow, hash mismatch, cancellation, and admission failure leave no reservation/temp/lease leak and preserve quarantine behavior.
    - A warm repeat read returns the same verified bytes without a second HTTP request, while capacity pressure may deterministically evict that unowned remote blob.
  </behavior>
  <action>Inject BlobStore into `BlobFetcher` and `PathResolver`. Replace `VerifiedBlob`'s delete-on-dispose spool implementation with a leased store handle: lookup and lease the expected hash first; on a miss retain SafeFetcher per-hop SSRF, timeout, declared-size, transfer, quarantine, and incremental hash validation, reserve/admit verified bytes as unowned remote origin, then return a lease. Concatenate authenticated raw-link leases lazily and release each on EOF/cancel/error; keep the decoded ManifestCache unchanged and outside store accounting. Preserve Task 1's exact legacy logical-size preflight and HEAD behavior. Test remote retention/reuse, LRU eviction eligibility, lease protection, all terminal cleanup paths, and hostile transport failures, then commit this read-path conversion independently.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp --allow-net=127.0.0.1 tests/integration/blob_store_test.ts tests/integration/hostile_blossom_test.ts &amp;&amp; deno task check</automated>
  </verify>
  <done>Remote Hashtree reads use persistent evictable store entries and transient leases with bounded streaming, warm reuse, correct cancellation/error cleanup, and unchanged legacy-NAR and manifest-LRU semantics.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Stream chunked PUT, overlay, and Hashtree construction through BlobStore</name>
  <files>src/persistence/write_repository.ts, src/hashtree/writer.ts, src/write/overlay.ts, src/write/batch_scheduler.ts, tests/integration/writable_cache_test.ts, tests/integration/publication_batch_test.ts, tests/protocol/hashtree_writer_test.ts</files>
  <behavior>
    - `nar/*.nar` PUT streams directly into canonical `FILE_CHUNK_BYTES` chunks, admits chunks/manifests under an upload owner, and atomically exposes the route only after all limits and immutable-route checks pass.
    - Abort, oversize, conflict, and failed manifest construction release upload ownership and immediately delete newly unowned write bytes; identical PUTs are idempotent and duplicate chunks count once.
    - Overlay generations and frozen batches reference ordered hash/size/type descriptors rather than whole-body paths, and generation leases preserve all reachable components.
    - HashtreeWriter consumes route components, reuses stored chunks, admits canonical manifests through BlobStore, and creates neither whole-NAR staging files nor candidate-blobs directories.
  </behavior>
  <action>Replace whole-body NAR staging with a backpressured canonical chunk pipeline. Reserve against request and store ceilings, incrementally hash and admit each fixed-boundary chunk under a temporary upload owner, construct canonical file-manifest levels as chunks finish, and transfer the completed route descriptor atomically to staging/generation ownership. Keep small narinfo metadata as one store blob. Refactor route, overlay, frozen-batch, and writer inputs to ordered content descriptors, while preserving route conflict, narinfo/reference, writable-identity, generation lease, and Task 1 logical-size rules. Make HashtreeWriter persist chunks/manifests via BlobStore and produce hash inventories with leased readers instead of physical candidate paths. Exercise N-1/N/N+1 boundaries, repeated chunks, idempotent PUT, conflict/abort/oversize cleanup, generation replacement, and builder failure recovery. Commit this writable/build path independently.</action>
  <verify>
    <automated>deno test --allow-read=.,/tmp --allow-write=/tmp tests/protocol/hashtree_writer_test.ts tests/integration/writable_cache_test.ts tests/integration/publication_batch_test.ts &amp;&amp; deno task check</automated>
  </verify>
  <done>NAR uploads are chunked once while streaming, route and overlay state owns component hashes atomically, Hashtree builds reuse the shared store, and every failed or superseded write releases bytes according to the locked lifetime rules.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Complete publication/runtime/config integration and end-to-end gates</name>
  <files>main.ts, src/blossom/source_plan.ts, src/blossom/cache_sink.ts, src/config/config.ts, src/runtime/daemon.ts, src/operations/diagnostics.ts, src/write/batch_scheduler.ts, src/write/publication_coordinator.ts, tests/integration/blob_store_migration_test.ts, tests/integration/operator_config_test.ts, tests/integration/publication_batch_test.ts, tests/integration/publication_recovery_test.ts, tests/e2e/nix_publication_roundtrip_test.ts, tests/e2e/nix_substitution_test.ts</files>
  <behavior>
    - Publication upload streams leased inventory blobs and atomically transfers owners across writer-run, batch, saga, and committed generation states before releasing predecessors.
    - Restart resumes migrated or new pending candidates/sagas with every required blob present; final completion/archive immediately removes write-origin bytes only after their last owner and lease.
    - Startup opens store, reconciles and migrates, then activates readers/writers; shutdown stops intake/workers and drains leases/builds before store/database close.
    - `localBlossomUrl` and its environment/config mapping, HTTP population sink, local source role, daemon wiring, documentation, examples, and tests are absent; direct BlobStore lookup supplies local caching.
    - Cold and warm stock-Nix substitution and publication roundtrip return byte-identical NARs within the global store ceiling.
  </behavior>
  <action>Convert publication inventory and coordinator paths to leased BlobStore hashes and transactionally transfer durable owners before predecessor release; preserve complete-replica-before-event and retry visibility. Wire daemon lifecycle around one store instance and run reconciliation/migration before writable identity activation. Remove `localBlossomUrl` and `NIXSTR_LOCAL_BLOSSOM` from `main.ts`, raw/validated config, environment mapping, source planning, `BlobCacheSink` usage (delete the module if now unused), runtime wiring, diagnostics, docs/examples, and fixtures; retain preferred/event/BUD-03 ordering and SSRF controls. Update migration/recovery coverage for pending sagas and final-owner deletion. Extend both stock-Nix E2E suites for cold fetch, warm local hit, migrated writable content, publication, restart, and byte identity. Commit runtime/publication/config integration independently, preserving unrelated worktree changes.</action>
  <verify>
    <automated>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp --allow-net=127.0.0.1 tests/integration/blob_store_migration_test.ts tests/integration/operator_config_test.ts tests/integration/publication_batch_test.ts tests/integration/publication_recovery_test.ts tests/e2e/nix_publication_roundtrip_test.ts tests/e2e/nix_substitution_test.ts &amp;&amp; ! rg 'localBlossomUrl|NIXSTR_LOCAL_BLOSSOM' main.ts src tests docs examples 2&gt;/dev/null &amp;&amp; deno task verify &amp;&amp; git diff --check</automated>
  </verify>
  <done>Publication and daemon lifecycle use the shared store safely across restart, the obsolete local HTTP cache configuration is removed from every entry point and artifact, both stock-Nix flows pass cold and warm, and the full repository verification gate is green.</done>
</task>

## Threat model

| Threat | Severity | Disposition | Required mitigation |
|---|---|---|---|
| Publisher supplies corrupt or oversized content | high | mitigate | Stream-hash before admission, preserve per-transfer/request limits, reserve capacity, and expose only verified hashes. |
| Concurrent PUT/fetch streams exceed disk ceiling | high | mitigate | Serialize BEGIN IMMEDIATE reservation/accounting and include live worst-case reservations in the hard ceiling. |
| Eviction or cleanup removes live publication/read bytes | high | mitigate | Durable owner rows plus transient leases; deterministic eligibility; owner transfer before predecessor release; tombstoned retry. |
| Crash splits filesystem and SQLite state | high | mitigate | Same-filesystem temp promotion, file/directory sync, transactional catalog changes, startup reconciliation, and fault-injection tests. |
| Legacy filenames smuggle mismatched content or unsafe paths | high | mitigate | Constrain roots/patterns, validate lowercase hashes and safe sizes, rehash all migrated files, quarantine unknown entries. |
| Cancellation leaks reservation, lease, or write bytes | medium | mitigate | Terminal-path cleanup in stream EOF/cancel/error plus restart recovery tests. |
| Local operator configuration exposes an unintended network cache | medium | mitigate | Remove localBlossomUrl and its HTTP sink/source path; keep direct store access process-local. |

## Verification

- Confirm Task 1 is an isolated prerequisite commit and unrelated dirty-worktree
  changes remain unstaged.
- Run focused store, migration, configuration, read, write, publication, and
  recovery tests with injected small capacity limits and crash hooks.
- Run `deno fmt --check`, `deno lint`, `deno check`, and `deno task verify`.
- Run the stock-Nix publication/substitution path with an empty shared store,
  then repeat warm and confirm BlobStore hits avoid remote downloads.
- Restart at each migration and publication checkpoint and prove routes and
  pending sagas remain readable, publishable, and correctly owned.
- Inspect diagnostics/health output for bounded usage, reservations, evictions,
  recovery actions, and deferred deletions without hashes, filesystem paths,
  event bodies, credentials, or untrusted response bodies leaking unexpectedly.

## Success criteria

- Exactly one persistent content-addressed byte store exists at runtime, with a
  16 GiB default hard ceiling over ready physical bytes plus reservations.
- No unbounded stream uses `arrayBuffer()`, `Blob`, `File`, full-body accumulation,
  whole-NAR staging, or RxJS as the byte transport.
- Remote verified blobs are reusable and evictable; write-origin bytes obey
  immediate final-owner deletion; mixed deduplicated content obeys both rules.
- Capacity, ownership, recovery, and migration remain correct under concurrency,
  cancellation, injected crashes, corrupt state, and restart.
- Legacy data migrates idempotently and pending publication work resumes without
  republishing or losing bytes.
- The partial-NAR compatibility fix, independent manifest LRU, NIP integrity and
  SSRF controls, and stock Nix compatibility remain intact.
