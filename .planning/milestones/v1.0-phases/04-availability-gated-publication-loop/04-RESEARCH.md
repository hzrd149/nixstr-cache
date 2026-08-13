# Phase 4: Availability-Gated Publication Loop - Research

**Researched:** 2026-08-12
**Domain:** durable publication saga, streamed Blossom replication, Nostr signing/relay acknowledgement, reactive promotion, and operational acceptance
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Availability Barrier and Replication
- Snapshot the signer's authenticated current kind-10063 BUD-03 server list when claiming a pending candidate; require at least one valid advertised destination or leave writes unavailable.
- Stream immutable blobs with bounded concurrency and per-server attempt/deadline limits. Use content-addressed upload semantics and verify server possession with HEAD/GET plus hash where the protocol requires.
- A server counts complete only when every blob reachable from the candidate root is proven present on that same server; success distributed across different partial servers does not satisfy the barrier.
- Do not call the signer or relay publisher before the first complete-server proof is durably committed.

### Signing, Relay Publication, and Promotion
- Build exactly kind `17091` for default identity or kind `37091` with the exact configured `d`; include canonical plaintext `nhash`, ordered Blossom tags, Nix signature-key tags, and expiration semantics required by `NIP.md`.
- Sign only through the ready owned signer capability and verify the completed signed event locally before any relay publication.
- Publish to configured relays with bounded acknowledgement tracking; one configured relay acknowledgement is sufficient to promote, while other failures remain retryable. If no relay acknowledges, keep the candidate pending and do not promote.
- After the completeness and relay barriers, transactionally mark the publication committed and feed the same verified event through EventStore/selection so the signer overlay becomes the highest-priority read root without a special bypass.

### Retry and Local Event Cache
- Persist per-server and per-relay outcomes with attempt count, next-attempt time, last safe error code, and candidate/event identity; never persist secrets or raw authorization headers.
- Retry incomplete replicas and unacknowledged relays asynchronously with capped exponential backoff and jitter after promotion; retries never roll back or block the committed root.
- An optional operator-configured local relay receives both observed allow-listed events and newly signed events as a read/write-through event cache, but local acknowledgement alone counts only when it is explicitly in the configured publication relay set.
- Restart recovery resumes claimed/pending publication, replica repair, and relay retry idempotently without signing a second distinct event for the same candidate.

### Observability and Health
- Emit structured JSON diagnostics through one typed sink for event rejection, merge conflict, upstream failure, signer transition, batch transition, replication, relay acknowledgement, and publication promotion.
- Redact private keys, bunker secrets, authorization headers, full NAR/Narinfo bodies, and unsafe URLs/query credentials; log stable codes, identities, hashes, counts, and durations.
- `/health` reports process health, read availability, and write availability separately with machine-readable reasons; process/read can remain healthy while write publication is blocked.
- Health is observational only and never mutates state or performs network probes synchronously.

### End-to-End Acceptance
- Use in-process hostile Blossom and minimal Nostr relay fixtures for truncation, mismatch, partial replicas, missing acknowledgements, restart, and retry behavior.
- Extend the real Nix E2E to upload via the production daemon, wait for actual signed publication/promotion, remove the isolated local store path, and substitute solely from the published root.
- Keep every test permission-scoped to loopback, temp paths, explicit environment variables, and pinned `nix`/`nix-store` executables.
- Final verification must run format, lint, check, protocol, hostile integration, signer, publication, health/log redaction, and real-Nix read/write workflows.

### the agent's Discretion
- Exact retry backoff constants within bounded deterministic tests.
- Whether relay acknowledgements are collected sequentially or bounded-concurrently, provided configured ordering and durable outcomes are stable.
- Health JSON field names beyond the required process/read/write status and reason codes.

### Deferred Ideas (OUT OF SCOPE)
- Multi-user tenancy, distributed gateways, BUD-15 self-encrypted roots, hardware-backed key isolation, and privacy/authorization claims remain outside v1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUBL-03 | Upload newly reachable blobs and prove one advertised server has the complete tree before signing. | Per-server durable matrix, streamed BUD-02 upload, BUD-01 proof, and barrier transaction. |
| PUBL-04 | Sign/publish the correct event after completeness and reactively commit it. | Exact signer/pool APIs, event builder validation, durable signed-event identity, and normal selection admission. |
| PUBL-05 | Record and retry incomplete replicas without blocking the committed root. | Durable work rows, terminal/transient outcomes, deterministic capped backoff, and post-promotion repair supervisor. |
| PUBL-06 | Read/write-through observed and signed events to an optional local relay. | One relay publisher with purpose-qualified acknowledgement and observed-event forwarding after admission. |
| PUBL-07 | Real Nix upload, publication, deletion, and substitute-back. | Production child-daemon test flow using isolated stores, real PUTs, promotion synchronization, and sole-substituter proof. |
| OPER-02 | Secret-safe structured operational logs. | Closed typed diagnostic union, central serializer/redactor, stable safe codes, and adversarial redaction tests. |
| OPER-03 | Separate process/read/write health. | Pure snapshot health model and `/health` route before Nix cache routing. |
| OPER-04 | Automated protocol, hostile, bounded-stream, local integration, and real-Nix tests. | Concrete fixture/test matrix and permission-scoped commands. |
</phase_requirements>

## Summary

Phase 3 already supplies the correct handoff: one durable `pending_candidate` plus a sorted immutable inventory of files, while the committed overlay remains unchanged. Phase 4 should extend that database into a durable saga rather than build an in-memory coordinator. The decisive invariant is a database fact proving that one specific snapshotted BUD-03 server possesses every inventory hash; only after that transaction commits may the candidate be signed. [VERIFIED: Phase 3 code and locked context]

The signed event itself must become durable before the first relay attempt. Restart then republishes identical event bytes/id instead of choosing a new `created_at` and generating a competing replacement. `RelayPool.publish()` returns per-relay `{ok, message?, from}` responses; only `ok === true` from a configured publication relay crosses the relay barrier. After that acknowledgement is durably recorded, commit publication state and submit the same locally validated event through the existing selection admission path. [VERIFIED: installed Applesauce 6.2.1/6.2.2 source; CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

Keep the data plane in Web Streams and files, the control plane in SQLite plus RxJS supervision, and all health/logging views pure projections of already-held state. No new package is required. [VERIFIED: current codebase and AGENTS.md]

**Primary recommendation:** Implement one restart-safe `PublicationCoordinator` whose durable monotone transitions are `pending → destinations_snapshotted → complete_server_proven → signed → relay_acked → committed`, with repair rows surviving commitment and the verified signed event admitted through the existing selector.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Candidate/work/barrier persistence | Database / Storage | API / Backend | SQLite is the authority for restart/idempotency; coordinator performs transitions. |
| Blob upload and completeness proof | API / Backend | External Blossom | Daemon streams immutable files and validates transport/proof. |
| Event build/sign/verify/publish | API / Backend | External signer/relays | Trusted template construction and acknowledgement policy live in daemon. |
| Reactive root promotion | API / Backend | Database / Storage | Existing selection admission preserves rollback and identity rules. |
| Local relay cache | API / Backend | External local relay | Same publisher boundary, separate purpose/counting policy. |
| Logs and health | API / Backend | Browser / Client | Daemon owns facts; HTTP merely serializes a snapshot. |
| Nix E2E | Browser / Client | API / Backend | Stock CLI drives unchanged HTTP binary-cache interface. |

## Project Constraints (from AGENTS.md)

- `NIP.md` is normative; implementation may not weaken any MUST/MUST NOT. [VERIFIED: AGENTS.md]
- Retain Deno/TypeScript and Applesauce reactive stores/casts/observable composition. [VERIFIED: AGENTS.md]
- Never whole-buffer large blobs, files, or datasets; use Web Streams with backpressure end to end. [VERIFIED: AGENTS.md]
- Bound manifest/traversal, transfer, redirect, attempts, concurrency, and decompressed output dimensions. [VERIFIED: AGENTS.md]
- Reapply SSRF/DNS/redirect controls to publisher-provided URLs; only exact operator-configured local origins may be exempted. [VERIFIED: AGENTS.md]
- Verify Nostr signatures and blob hashes before selection/use; plaintext roots only in v1. [VERIFIED: AGENTS.md]
- Preserve freshness watermarks, expiration, signed-history downgrade protection, and stock-Nix HTTP compatibility. [VERIFIED: AGENTS.md]
- PUT remains unavailable without a ready owned signer identity; publication needs a complete advertised replica. [VERIFIED: AGENTS.md]
- Optimize for one local user without collapsing subsystem boundaries. [VERIFIED: AGENTS.md]
- Use GSD workflow artifacts before edits; this file is produced by the requested plan-phase research workflow. [VERIFIED: AGENTS.md]
- No project skills are present. [VERIFIED: project skill discovery]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Deno | project target `2.9.5` (host `2.9.4`) | Streams, HTTP, filesystem, tests | Existing runtime; pin CI/deployment because host is one patch behind. [VERIFIED: codebase and runtime probe] |
| TypeScript | Deno-bundled `6.0.3` | Saga/event/diagnostic discriminated unions | Existing strict implementation language. [VERIFIED: runtime probe] |
| `applesauce-relay` | `6.2.1` | Relay subscriptions and acknowledged publication | `RelayPool.publish(relays,event,{timeout,retries})` returns `Promise<PublishResponse[]>`. [VERIFIED: installed official package source] |
| `applesauce-signers` | `6.2.2` | Local and NIP-46 signing | `ISigner.signEvent(EventTemplate)` is the shared boundary. [VERIFIED: installed official package source] |
| RxJS | `7.8.2` | Coordinator wakeups, lifecycle, retries | Existing Applesauce-compatible control plane; bytes stay in streams. [VERIFIED: deno.json] |
| `node:sqlite` | Deno built-in compatibility API | Durable saga and work queues | Existing repository uses transactional SQLite without extra env permission. [VERIFIED: codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nostr-tools` | `2.19.4` | Local event verification | Use existing `verifyEvent` at post-sign trust boundary. [VERIFIED: deno.json/codebase] |
| `@noble/hashes` | `2.3.0` | Incremental SHA-256 | Verify upload/GET streams without materialization. [VERIFIED: deno.json/codebase] |
| Existing `SafeFetcher` | project module | pinned transport/SSRF/deadlines | All Blossom HEAD/GET and upload response handling. [VERIFIED: codebase] |
| Existing `StateRepository`/`WriteRepository` | project modules | selection policy and write saga state | Preserve separate rollback authority and publication work authority. [VERIFIED: codebase] |

**Installation:** none. Phase 4 needs no new external package.

## Package Legitimacy Audit

Not applicable: this phase installs no external packages. All named dependencies are already pinned in `deno.json`/`deno.lock`. [VERIFIED: codebase]

## Exact External API Contracts

### Blossom upload and possession

- BUD-02 `PUT /upload` accepts exact binary bytes, recommends `Content-Length`, `Content-Type`, and optional lowercase `X-SHA-256`, and returns `200` for existing or `201` for new plus a descriptor. Validate descriptor `sha256` and `size`; do not trust its URL. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/02.md]
- BUD-11 upload authorization is a freshly signed kind `24242` event with `t=upload`, future `expiration`, mandatory matching `x=<hash>`, and preferably `server=<lowercase domain>`; encode JSON as unpadded base64url under `Authorization: Nostr`. Generate per blob/server attempt through the same signer capability and never persist/log it. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/11.md]
- BUD-01 `HEAD /<sha256>` returns the same `Content-Length` metadata as GET but no body. A conforming `200` with exact expected length is sufficient possession evidence for a just-uploaded known immutable hash; if the server's HEAD response is ambiguous/nonconforming, fall back to bounded streamed GET and verify SHA-256. [CITED: https://github.com/hzrd149/blossom/blob/master/buds/01.md]
- Upload redirects must be rejected because a consumed request body cannot be safely replayed and every redirect would require new address/auth scope. HEAD/GET proof redirects may use existing manual bounded redirect handling. [VERIFIED: Phase 3 established pattern; BUD-01 redirect rules]

### Applesauce signing and relay publication

```ts
type ISigner = {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<NostrEvent>;
};

type PublishResponse = { ok: boolean; message?: string; from: string };

await pool.publish(relayUrls, event, {
  retries: 0,       // coordinator owns durable retry
  reconnect: false,
  timeout: relayAttemptTimeoutMs,
});
```

`NostrConnectSigner.signEvent` internally verifies the returned event, but the daemon must still run project validation and require exact owner/kind/tags/content/template invariants before persisting it. `RelayPool.publish` can return fewer results when some relays error; reconcile by canonical configured URL rather than array position. `ok: true` is the NIP-01 acceptance fact; `duplicate: already have this event` is also specified as an accepted `ok: true` response and is restart-idempotent. [VERIFIED: installed official Applesauce source; CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

## Architecture Patterns

### System Architecture Diagram

```text
Phase-3 pending candidate + immutable inventory
                    |
                    v
       claim + snapshot current BUD-03 servers
                    |
                    v
     per-server x per-blob durable work matrix
        | upload missing (streamed BUD-02)
        | prove present (HEAD or verified GET)
        v
   Does one same server have every blob proven?
        | no --> durable retry/backoff; no signing
        | yes
        v
  commit complete-server proof --> build template --> signer.signEvent
                                                    |
                                      local exact validation
                                                    |
                                      persist signed event/id
                                                    v
                               publish to configured relays
                                      | no OK=true: retry, no promote
                                      | one OK=true
                                      v
                  transaction: publication committed + repair work retained
                                      |
                                      v
                   selector.accept(same verified event) --> EventStore model
                                      |
                                      v
                  signer-first merged cache serves published generation
```

### Recommended Project Structure

```text
src/
├── blossom/uploader.ts              # streamed BUD-02 + BUD-11 and proof
├── publication/coordinator.ts       # durable monotone saga supervisor
├── publication/event_builder.ts     # exact template and post-sign checks
├── publication/relay_publisher.ts   # per-relay OK collection/local relay
├── observability/diagnostics.ts      # typed union, redactor, JSON sink
├── observability/health.ts           # pure process/read/write snapshot
├── persistence/write_repository.ts   # saga, attempt, proof, event, commit rows
├── runtime/daemon.ts                 # construction/lifecycle/admission wiring
└── nix/http_handler.ts               # /health route only; cache semantics unchanged
tests/
├── fixtures/blossom_server.ts
├── fixtures/nostr_relay.ts
├── integration/publication_loop_test.ts
├── integration/health_diagnostics_test.ts
└── e2e/nix_publication_roundtrip_test.ts
```

### Pattern 1: Durable Monotone Saga

Every externally visible step follows a committed fact. Snapshot destinations and initialize work rows transactionally; commit completeness before signing; persist the signed event before relay I/O; persist an acknowledgement before promotion; commit before emitting to selection. A restart queries nonterminal rows and repeats only idempotent actions. [VERIFIED: locked context and existing commit-before-emit repository pattern]

### Pattern 2: Same-Server Completeness Matrix

Use primary key `(candidate_id, server_url, blob_hash)`. A server is complete only when `COUNT(proven)=candidate.blob_count` for that server and every row belongs to the snapshotted candidate inventory. Never aggregate proof counts across servers. [VERIFIED: locked context]

### Pattern 3: Persist Once, Republish Identically

Once completeness is durable, create one `created_at`, sign once, validate, then store the full signed event JSON plus id. All relay retries use those exact bytes. This prevents restart from creating a second replaceable event with a different timestamp/id. [VERIFIED: NIP-01 replaceable ordering and locked idempotency]

### Pattern 4: Normal Admission, No Overlay Bypass

Add a selector method accepting a locally-produced raw event through the same `validatePublication → repository.accept → EventStore.add` path used for relay events. Promotion must not mutate `SignerOverlay` directly; its generation becomes readable because the selected signer publication points at the candidate root. [VERIFIED: current selection and overlay boundaries]

### Pattern 5: Deterministic Retry Without Timer Rows

Persist `attempt_count`, `next_attempt_at`, and safe code. Use `min(cap, base * 2^attempt)` plus stable hash-derived jitter from `(candidate,event,endpoint,attempt)` so tests and restart scheduling are deterministic. One supervisor schedules only the nearest due item and wakes on repository changes. [VERIFIED: existing nearest-expiry scheduler pattern; constants are discretion]

### Prescriptive Persistence Additions

| Table / field | Required contents | Transaction boundary |
|---------------|-------------------|----------------------|
| `publication_state` | candidate id, phase, destination snapshot hash, complete server, signed event JSON/id, committed time | singleton active saga; phase only moves forward |
| `publication_destinations` | candidate id, canonical ordered server URL, ordinal | inserted atomically at claim |
| `replica_work` | candidate, server, blob hash/size/path, status, attempts, next time, safe code | each attempt outcome committed |
| `relay_work` | event id, canonical relay URL, purpose (`publication`/`local-cache`), status, attempts, next time, safe code | each OK/error committed |
| `publication_commit` | cache identity, candidate, event id, generation, complete server, acknowledged relay | one transaction before selector emission |

Store only canonical safe endpoint URLs (scheme/host/port/path without userinfo/query/fragment where disallowed), never auth headers, BUD-11 events, bunker URIs, raw exception serialization, or bodies. [VERIFIED: locked redaction requirements]

### Anti-Patterns to Avoid

- **Signing before durable proof:** a crash can publish an unavailable root or lose evidence ordering.
- **`Promise.any` as the barrier:** it loses per-server/per-blob durable outcomes and can accidentally combine partial replicas.
- **Applesauce internal retry as durable retry:** retries vanish on process exit; set per-call retries to zero/small bounded value and let repository scheduling own policy.
- **Re-signing after restart:** creates a different replacement candidate and ambiguous ordering.
- **Treating send success as acknowledgement:** only NIP-01 `OK` with `ok=true` counts.
- **Direct overlay promotion:** bypasses event validation, rollback policy, expiry, and reactive selection.
- **Logging response/error objects:** URLs, authorization, signer details, or bodies may be embedded.
- **Health probes on request:** turns `/health` into mutable/network work and creates load/failure amplification.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nostr event cryptography | custom serialization/Schnorr | signer plus `verifyEvent`/`validatePublication` | Canonical event ids/signatures are subtle. |
| Relay protocol/reconnect | raw WebSocket publisher | Applesauce `RelayPool.publish` | Exact OK correlation, auth, socket lifecycle. |
| Blob hashing | buffered Web Crypto digest | existing incremental noble SHA-256 stream | Bounded memory for large NARs. |
| Network redirects/DNS | raw `fetch` automatic redirects | existing `SafeFetcher`/pinned transport | SSRF and redirect invariants already proven. |
| Crash recovery journal | JSON files/in-memory queue | transactional SQLite rows | Atomic barriers and idempotent claims. |
| Event promotion shortcut | special signer root variable | existing selection admission/EventStore path | One trust/freshness model. |

## Common Pitfalls

### Pitfall 1: Distributed Partial Success Masquerades as Completeness
**What goes wrong:** server A has half the DAG and server B has the remainder, yet global success count reaches inventory size.  
**How to avoid:** completeness query groups and compares by one server snapshot row.  
**Warning signs:** proof table key omits server or barrier uses global `COUNT(*)`. [VERIFIED: locked context]

### Pitfall 2: HEAD Is Treated as Content Integrity Proof Everywhere
**What goes wrong:** a hostile/nonconforming server returns 200 or false length without the bytes.  
**How to avoid:** accept exact HEAD metadata for freshly uploaded immutable hashes; use bounded verified GET when response is ambiguous or for adversarial verification fixtures.  
**Warning signs:** 200 alone marks proven. [CITED: BUD-01]

### Pitfall 3: Upload Authorization Leaks
**What goes wrong:** BUD-11 tokens, bunker auth URLs, or headers enter SQLite/logs.  
**How to avoid:** generate short-lived server/hash-scoped token per attempt, hold only in request scope, central-redact keys and URL credentials.  
**Warning signs:** `Authorization`, `nbunksec`, `secret`, raw `Error` in diagnostic payloads. [CITED: BUD-11; VERIFIED: locked context]

### Pitfall 4: Relay Response Array Is Mapped by Index
**What goes wrong:** failed relays are absent/reordered and outcomes attach to the wrong URL.  
**How to avoid:** normalize `PublishResponse.from` and match it to configured canonical relay rows.  
**Warning signs:** `responses[i]` paired with `relayUrls[i]`. [VERIFIED: installed Applesauce API]

### Pitfall 5: Event Validation Is Only Cryptographic
**What goes wrong:** remote signer returns validly signed but modified kind, owner, `d`, `htree`, destinations, keys, content, or expiration.  
**How to avoid:** compare the signed event to the persisted template field-for-field, then call `verifyEvent` and project `validatePublication`.  
**Warning signs:** signer return is sent directly to `pool.publish`. [VERIFIED: signer contract]

### Pitfall 6: Newer Batches Overwrite an Active Candidate
**What goes wrong:** Phase 3's singleton pending pointer is replaced while replication/signing uses its inventory.  
**How to avoid:** claim/copy candidate metadata and inventory into saga-owned rows before allowing scheduler replacement; reference candidate by stable batch id.  
**Warning signs:** coordinator repeatedly calls live `pendingInventory()` without candidate id consistency. [VERIFIED: current singleton schema]

### Pitfall 7: Promotion and Admission Split Across Crash
**What goes wrong:** database says committed but selector/read view never updates until another relay echo.  
**How to avoid:** on startup and after commit, replay every committed-but-unadmitted stored signed event idempotently through selector admission.  
**Warning signs:** admission exists only as a one-time callback after transaction. [VERIFIED: restart requirement]

### Pitfall 8: Nix E2E Proves the Old Read Fixture
**What goes wrong:** test upload succeeds but substitution still uses preconstructed relay/Blossom data or the source store.  
**How to avoid:** use one fresh object, real `nix copy --to http://daemon`, wait for the newly signed event id/root, remove/verify absence in an isolated destination, stop access to any source fixture, use daemon as sole substituter with fallback false, and verify path content. [VERIFIED: existing E2E patterns and PUBL-07]

## Code Examples

### Exact post-sign validation

```ts
// Sources: applesauce-signers 6.2.2 declarations; project publication validator
const signed = await capability.signEvent(template);
if (signed.pubkey !== ownedPubkey || signed.kind !== template.kind) {
  throw new PublicationFault("signer-modified-template");
}
if (!verifyEvent(signed)) throw new PublicationFault("invalid-signed-event");
const validated = validatePublication(signed, nowSeconds);
if (!validated.ok || cacheIdentity(validated.value) !== writableIdentity) {
  throw new PublicationFault("invalid-publication-event");
}
repository.recordSigned(candidateId, signed); // before relay I/O
```

### One complete server query

```sql
SELECT server_url
FROM replica_work
WHERE candidate_id = ? AND status = 'proven'
GROUP BY server_url
HAVING COUNT(*) = (SELECT blob_count FROM publication_state WHERE candidate_id = ?)
ORDER BY MIN(server_ordinal)
LIMIT 1;
```

### Relay barrier

```ts
// Source: applesauce-relay 6.2.1 PublishResponse
const responses = await pool.publish(relays, event, {
  retries: 0,
  reconnect: false,
  timeout: limits.relayAttemptMs,
});
for (const response of responses) {
  repository.recordRelayOutcome(event.id, response.from, response.ok, safeCode(response.message));
}
if (!repository.hasConfiguredPublicationAck(event.id)) return;
repository.commitPublication(candidate.id, event.id);
selector.accept(event); // same normal validated admission path
```

## Typed Diagnostics and Health Contract

Use a closed union such as `event_rejected`, `merge_conflict`, `upstream_failed`, `signer_state`, `batch_state`, `replica_attempt`, `replica_complete`, `relay_ack`, `publication_promoted`. Common safe fields: timestamp, code, cache identity, candidate/event/hash prefix or full public hash, canonical credential-free endpoint identity, attempt/count/duration. The sink must serialize exactly allow-listed fields; it must not recursively serialize arbitrary causes. [VERIFIED: OPER-02 and locked context]

Recommended health JSON:

```json
{
  "process": { "status": "ok", "reasons": [] },
  "read": { "status": "ok", "reasons": [] },
  "write": { "status": "blocked", "reasons": ["no-complete-replica"] }
}
```

Process reflects lifecycle/repository fatal state. Read reflects whether a selection or committed signer generation can answer and required repositories are healthy. Write is conjunction of owned ready signer, repository health, current valid BUD-03 destinations, configured publication relays, and coordinator nonfatal state; pending replication is a reason/state, not process failure. Snapshot only—no synchronous network. [VERIFIED: locked context]

## Validation Architecture

Omitted because `.planning/config.json` explicitly sets `workflow.nyquist_validation` to `false`. The phase must nevertheless implement OPER-04 and run the following acceptance matrix. [VERIFIED: config]

| Test file | Coverage | Fast command |
|-----------|----------|--------------|
| `tests/integration/blossom_publication_test.ts` | streaming upload, auth, mismatch/truncation, same-server partials, proof barrier | `deno test --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/blossom_publication_test.ts` |
| `tests/integration/relay_publication_test.ts` | OK true/false/duplicate, absent response, timeout, restart identical id, local relay counting | same scoped integration task/filter |
| `tests/integration/publication_recovery_test.ts` | restart at every implemented transition, retry/repair, no rollback | same scoped integration task/filter |
| `tests/integration/health_diagnostics_test.ts` | process/read/write combinations, pure endpoint, redaction corpus | same scoped integration task/filter |
| `tests/e2e/nix_publication_roundtrip_test.ts` | real upload→signed promotion→delete/absence→sole-substituter restore | `deno task test:nix-e2e` |

Use fake clocks and injected randomness/hash jitter in integration tests. Measure maximum concurrent upload readers and use slow consumers to show bounded concurrency/backpressure. Fixtures must capture request headers for assertions but redact/discard them rather than include secrets in failure dumps. [VERIFIED: existing test patterns and locked context]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Owned Applesauce signer plus local event verification and exact identity checks. |
| V3 Session Management | yes | NIP-46 lifecycle and short-lived BUD-11 capability tokens; no secret persistence in publication rows. |
| V4 Access Control | yes | PUT/signing gated by configured owned identity; BUD-11 token scoped to action/hash/server. |
| V5 Input Validation | yes | Existing publication, URL, descriptor, response framing, sizes, and canonical identity validators. |
| V6 Cryptography | yes | Applesauce/nostr-tools signatures and Noble incremental SHA-256; never hand-roll. |

### Known Threat Patterns for Deno/Nostr/Blossom

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious advertised endpoint/redirect | Spoofing / SSRF | exact URL validation, pinned DNS transport, recheck every redirect, bounded hops |
| Server claims possession without bytes | Spoofing | exact HEAD metadata plus verified GET fallback/adversarial sampling |
| Partial replicas combined | Tampering | server-keyed proof matrix and transactional aggregate |
| Signer modifies template | Tampering | field equality, owner/kind/identity checks, full event verification |
| Relay send without acceptance | Repudiation | durable correlated NIP-01 `OK true` record |
| Auth/header/error disclosure | Information disclosure | allow-list diagnostics and per-attempt ephemeral token |
| Retry storm / huge inventory | Denial of service | candidate inventory ceilings, bounded concurrency, deadline, capped backoff/jitter |
| Crash duplicates event | Integrity / availability | durable signed bytes/id before relay I/O and identical retry |

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Trust upload 2xx alone | Upload descriptor validation plus BUD-01 possession proof | Barrier is evidence-backed. |
| One-shot multi-relay publish | Per-relay `PublishResponse` with durable retry | Acknowledgement policy is explicit/recoverable. |
| In-memory workflow | SQLite monotone saga | Restart does not re-sign or lose repair work. |
| Generic console calls | typed allow-list JSON diagnostics | Secret-safe machine-readable operation. |

**Deprecated/outdated:** do not use old Applesauce `applesauce-net`/raw relay APIs; current project pin is `applesauce-relay@6.2.1`. [VERIFIED: installed project graph]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Deno | all implementation/tests | ✓ | 2.9.4 (target 2.9.5) | CI/deployment pin 2.9.5 |
| Nix CLI | PUBL-07 | ✓ | 2.35.1 | none; E2E should skip only with explicit CI lane policy |
| `nix-store` | signed fixture and substitute proof | ✓ | 2.35.1 | none |
| Loopback sockets/temp filesystem | fixtures | ✓ | OS-provided | none |
| External relay/Blossom | production | not required for deterministic tests | — | in-process fixtures |

**Missing dependencies with no fallback:** none for local planning/execution.  
**Missing dependencies with fallback:** target Deno patch 2.9.5 is not the host binary; CI/deployment pin supplies it. [VERIFIED: environment probes]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact expiration lifetime for newly published cache-root events is not fixed by CONTEXT/NIP; preserve existing/configured semantics rather than inventing a default. | Open Questions | Planner must expose or explicitly omit expiration according to product decision. |
| A2 | HEAD exact length after just-uploaded known hash is acceptable routine possession evidence, with verified GET fallback for ambiguity. | API/Pitfalls | A stricter interpretation would increase bandwidth but not alter architecture. |

## Open Questions

1. **What publication expiration value should the daemon emit?**
   - What we know: `NIP.md` recommends NIP-40 expiration for bounded lifetime but does not mandate a lifetime; validation already honors it. [CITED: NIP.md and NIP-40]
   - What's unclear: no configuration field/lifetime decision is visible in Phase 4 context.
   - Recommendation: preserve an explicitly configured prior policy if present; otherwise omit `expiration` rather than invent a lifetime, and add configuration only if the planner has an upstream requirement.

2. **Which Nix signature-key tags are publication inputs?**
   - What we know: Phase 3 stages signed Narinfos, while the event must carry ordered canonical endorsed keys required by configured cache policy. [VERIFIED: NIP.md/current config scan]
   - What's unclear: current `ValidatedConfig` has no obvious signer-cache public-key list.
   - Recommendation: add an explicit validated ordered `nixSigKeys` configuration field; never infer endorsement from arbitrary staged `Sig` names.

3. **Does signer capability expose `signEvent` yet?**
   - What we know: Phase 3 intentionally exposed status/pubkey only; `SignerCapability` must be extended without exposing key material. [VERIFIED: codebase]
   - Recommendation: add `signEvent(template)` that rechecks ready/owner at call time and delegates to the held `ISigner`; keep the raw signer private.

## Sources

### Primary (HIGH confidence)

- Repository `AGENTS.md`, `NIP.md`, Phase 04 context/roadmap/requirements/state, all prior phase research/summaries/verification, current `src/` and `tests/` — constraints and exact seams.
- Installed official `applesauce-relay@6.2.1` declarations/implementation — `RelayPool.publish`, retry/timeout, and `PublishResponse`.
- Installed official `applesauce-signers@6.2.2` declarations/implementation — `ISigner` and `NostrConnectSigner.signEvent`.
- [Blossom BUD-01](https://github.com/hzrd149/blossom/blob/master/buds/01.md), [BUD-02](https://github.com/hzrd149/blossom/blob/master/buds/02.md), [BUD-03](https://github.com/hzrd149/blossom/blob/master/buds/03.md), [BUD-11](https://github.com/hzrd149/blossom/blob/master/buds/11.md) — retrieval, upload, advertised servers, authorization.
- [Nostr NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) and [NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md) — event acknowledgement, replaceable ordering, expiration.
- [Nix 2.35 binary-cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [HTTP serving guide](https://nix.dev/manual/nix/2.35/package-management/binary-cache-substituter.html) — stock client protocol and writable cache behavior.

### Secondary (MEDIUM confidence)

- Research-plan web results cross-checked against the official raw specification documents above.

### Tertiary (LOW confidence)

- None used as authoritative implementation evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — exact installed pins and local runtime inspected; no new dependencies.
- Architecture: HIGH — derived from locked decisions and concrete Phase 3 schema/lifecycle seams.
- External APIs: HIGH — installed official package source plus official protocols inspected.
- Pitfalls/security: HIGH — trace directly to threat constraints and durable-barrier invariants.
- E2E: HIGH — existing real-Nix harness and host Nix 2.35.1 verified.

**Research date:** 2026-08-12  
**Valid until:** 2026-09-11 for pinned packages/spec revisions; re-check Blossom master before execution because BUDs are drafts.
