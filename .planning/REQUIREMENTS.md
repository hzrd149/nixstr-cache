# Requirements: nixstr-cache

**Defined:** 2026-08-12
**Core Value:** An unmodified Nix client can reliably read and publish a decentralized binary cache while the daemon preserves the trust, integrity, freshness, and bounded-resource guarantees defined by `NIP.md` without buffering large files or datasets in memory.

## v1 Requirements

### Protocol and Trust

- [x] **PROT-01**: Operator can configure an ordered whitelist of kind `17091` default-cache and kind `37091` named-cache identities using raw Nostr pubkeys and exact `d` values.
- [x] **PROT-02**: Daemon accepts only publication events that pass every applicable validation and expiration rule in `NIP.md`, and reports rejected candidates without selecting them.
- [x] **PROT-03**: Daemon selects the latest valid event per raw cache identity using NIP-01 replaceable/addressable ordering and atomically exposes updated selections through Applesauce reactive casts.
- [x] **PROT-04**: Daemon persists the greatest accepted timestamp and tie-break state per identity so a restart or stale relay cannot silently roll a cache back.
- [x] **PROT-05**: Daemon refuses a signed-to-unsigned cache downgrade unless the operator has recorded explicit consent for that identity.
- [x] **PROT-06**: Daemon rejects BUD-15 self-encrypted `nhash` roots as unsupported in v1 while accepting valid plaintext BUD-18 roots.

### Blob and Hashtree Reads

- [x] **TREE-01**: Daemon discovers ordered Blossom sources from valid event `blossom` tags and the publisher's BUD-03 kind `10063` server list, with optional configured mirrors.
- [x] **TREE-02**: Daemon streams every fetched blob through SHA-256 verification before parsing, caching, or serving it and discards mismatched bytes before trying another source.
- [x] **TREE-03**: Daemon applies HTTP(S)-only URL policy, private-network restrictions, DNS/address checks, redirect revalidation, redirect limits, and source-attempt limits to publisher-controlled requests.
- [x] **TREE-04**: Daemon resolves BUD-16/17/18 Hashtree paths lazily with visited-hash deduplication and configurable bounds on manifests, depth, links, nodes, declared sizes, and total decoded bytes.
- [x] **TREE-05**: Daemon streams manifests, chunks, NARs, hashing, temporary storage, and responses with backpressure and without whole-file or whole-tree memory buffering.
- [ ] **TREE-06**: Operator can configure a local Blossom URL as a read/write-through cache that receives only verified immutable blobs.

### Merged Nix Read API

- [x] **READ-01**: Nix client can GET and HEAD `nix-cache-info` from one stable daemon URL with valid binary-cache metadata.
- [x] **READ-02**: Nix client can GET and HEAD `.narinfo` and referenced NAR paths resolved across selected trees in configured priority order.
- [x] **READ-03**: Each request uses one immutable merged-root snapshot so relay updates cannot change publisher roots midway through resolution.
- [x] **READ-04**: Daemon preserves every syntactically valid `.narinfo` `Sig` field unchanged, records which signatures verify against key bytes declared in the selected event as publisher-endorsed, and leaves trust selection to the Nix client.
- [ ] **READ-05**: Daemon unions `Sig` fields from duplicate `.narinfo` records only when all non-signature semantic fields agree.
- [ ] **READ-06**: Daemon serves the highest-priority record and emits a structured warning when duplicate `.narinfo` records disagree semantically.
- [x] **READ-07**: A real `nix` CLI can substitute an uncached store path through the daemon and verify the returned metadata and NAR successfully.

### Signers and Write API

- [ ] **WRIT-01**: Operator can configure exactly one writable kind `17091` or kind `37091` cache identity owned by the active signer.
- [ ] **WRIT-02**: Operator can connect either an Applesauce NIP-46 remote signer or a protected local private-key signer through one capability interface.
- [ ] **WRIT-03**: Daemon disables PUT readiness when no signer is connected, signer pubkey does not own the configured identity, or required publication destinations are unavailable.
- [ ] **WRIT-04**: Nix client can stream standard binary-cache PUT paths into durable staging without whole-body buffering and receive idempotent success for identical content.
- [ ] **WRIT-05**: Daemon makes a store object eligible for publication only when its `.narinfo`, referenced NAR, and declared store-path references are resolvable in the candidate tree.
- [ ] **WRIT-06**: Complete staged objects are readable through the signer-first merged view while incomplete objects remain invisible.

### Publication

- [ ] **PUBL-01**: Daemon freezes one serialized publication batch after five seconds without writes or after sixty seconds of sustained write activity.
- [ ] **PUBL-02**: Daemon builds a deterministic plaintext BUD-16/17/18 copy-on-write tree containing only the dependency-closed eligible batch.
- [ ] **PUBL-03**: Daemon uploads all newly reachable blobs to the signer's current BUD-03 Blossom servers and proves at least one advertised server contains the complete reachable tree before signing.
- [ ] **PUBL-04**: Daemon signs and publishes the correct kind `17091` or `37091` event only after the completeness barrier passes, then reactively commits that root to the signer-first read view.
- [ ] **PUBL-05**: Daemon records incomplete replicas after publication and retries them asynchronously without blocking the committed root.
- [ ] **PUBL-06**: Daemon can publish observed and newly signed events to an optional local relay configured as a read/write-through event cache.
- [ ] **PUBL-07**: A real `nix` CLI can upload a store object through the daemon, trigger publication, remove the local object, and substitute it back from the newly published cache root.

### Configuration and Operations

- [x] **OPER-01**: Operator can start the daemon from validated configuration covering listen address, whitelist order, relays, optional local caches, limits, signer mode, and writable identity.
- [ ] **OPER-02**: Daemon emits structured logs for event rejection, cache conflicts, upstream failures, signer state, batch state, replication, and publication outcomes without exposing secrets.
- [ ] **OPER-03**: Operator can query a basic health endpoint that distinguishes process health, read availability, and write availability.
- [ ] **OPER-04**: Automated tests cover strict protocol fixtures, hostile inputs, bounded streaming behavior, local relay/Blossom integration, and real `nix` CLI read/write workflows.

## v2 Requirements

### Self-Encrypted Hashtrees

- **ENCR-01**: Daemon can read BUD-15 self-encrypted Hashtrees using ciphertext verification, streaming decryption, and plaintext content-key verification.
- **ENCR-02**: Daemon can publish BUD-15 self-encrypted Hashtrees without exposing decryption keys to Blossom requests.

### Production Operations

- **HARD-01**: Operator can monitor protocol, request, cache, batching, replication, and publication metrics.
- **HARD-02**: Operator can configure disk quotas, retention policy, concurrency limits, and overload behavior.
- **HARD-03**: Daemon passes crash-injection recovery tests at every publication-saga transition.
- **HARD-04**: Daemon supports graceful draining and advanced liveness/readiness integration for service managers.

### Expanded Deployment

- **MULT-01**: Shared gateway can isolate multiple users, writable identities, signer sessions, quotas, and authorization policies.
- **MULT-02**: Operator can select arbitrary writable cache identities through authenticated request routing.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Graphical interface | v1 is a headless local daemon. |
| Custom Nix store implementation | Standard HTTP binary-cache compatibility is sufficient. |
| BUD-15 confidentiality or access control | The protocol provides storage opacity, not confidentiality. |
| Full cache crawl or materialization | Lazy path resolution preserves streaming and bounded-resource goals. |
| Garbage collection of published blobs | Safe deletion requires reachability and retention policy beyond v1. |
| All-replica publication barrier | One complete advertised replica provides availability; remaining replicas converge asynchronously. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROT-01 | Phase 2 | Complete |
| PROT-02 | Phase 1 | Gaps Found |
| PROT-03 | Phase 1 | Gaps Found |
| PROT-04 | Phase 1 | Gaps Found |
| PROT-05 | Phase 1 | Gaps Found |
| PROT-06 | Phase 1 | Gaps Found |
| TREE-01 | Phase 1 | Gaps Found |
| TREE-02 | Phase 1 | Gaps Found |
| TREE-03 | Phase 1 | Gaps Found |
| TREE-04 | Phase 1 | Gaps Found |
| TREE-05 | Phase 1 | Gaps Found |
| TREE-06 | Phase 2 | Pending |
| READ-01 | Phase 1 | Gaps Found |
| READ-02 | Phase 1 | Gaps Found |
| READ-03 | Phase 1 | Gaps Found |
| READ-04 | Phase 1 | Gaps Found |
| READ-05 | Phase 2 | Pending |
| READ-06 | Phase 2 | Pending |
| READ-07 | Phase 1 | Gaps Found |
| WRIT-01 | Phase 3 | Pending |
| WRIT-02 | Phase 3 | Pending |
| WRIT-03 | Phase 3 | Pending |
| WRIT-04 | Phase 3 | Pending |
| WRIT-05 | Phase 3 | Pending |
| WRIT-06 | Phase 3 | Pending |
| PUBL-01 | Phase 3 | Pending |
| PUBL-02 | Phase 3 | Pending |
| PUBL-03 | Phase 4 | Pending |
| PUBL-04 | Phase 4 | Pending |
| PUBL-05 | Phase 4 | Pending |
| PUBL-06 | Phase 4 | Pending |
| PUBL-07 | Phase 4 | Pending |
| OPER-01 | Phase 1 | Gaps Found |
| OPER-02 | Phase 4 | Pending |
| OPER-03 | Phase 4 | Pending |
| OPER-04 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-08-12*
*Last updated: 2026-08-12 after roadmap creation*
