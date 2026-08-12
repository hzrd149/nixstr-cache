<!-- GSD:project-start source:PROJECT.md -->

## Project

**nixstr-cache**

`nixstr-cache` is a single-user background daemon that presents Nostr- and Blossom-published Nix caches to an unmodified Nix client through the standard HTTP binary-cache interface. It aggregates kind `17091` default-cache and kind `37091` named-cache publication events from a configured whitelist, resolves their BUD-18 Hashtrees, and exposes one merged cache with deterministic publisher priority.

When a signer is connected, the daemon also accepts streamed HTTP PUT uploads, updates one configured cache identity owned by that signer, uploads the resulting immutable Hashtree blobs to the signer's BUD-03 Blossom servers, and publishes the new signed cache-root event. The signer's writable cache is overlaid at the highest priority in the merged read view.

**Core Value:** An unmodified Nix client can reliably read and publish a decentralized binary cache while the daemon preserves the trust, integrity, freshness, and bounded-resource guarantees defined by `NIP.md` without buffering large files or datasets in memory.

### Constraints

- **Protocol**: `NIP.md` is normative for cache publication and resolution — implementation choices must not weaken its MUST/MUST NOT requirements.
- **Runtime**: Build on the existing Deno/TypeScript project unless later research proves a blocking incompatibility — the repository is already initialized for Deno.
- **Nostr stack**: Use Applesauce packages and examples, especially reactive stores, casts, and observable composition — cache state should update from streams rather than imperative polling snapshots.
- **Streaming**: Avoid whole-file and whole-dataset buffering — hashing, upload, download, verification, tree traversal, and HTTP serving must use streams with backpressure.
- **Resource safety**: Bound manifest size, depth, links per node, total visited nodes, decoded bytes, redirect depth, server attempts, and decompressed output — hostile signed publishers and hostile transports are within the threat model.
- **Network safety**: Re-check SSRF restrictions after DNS resolution and on every redirect for publisher-provided URLs; operator-configured local services may be explicitly allowed.
- **Integrity**: Verify Nostr events and content hashes before selection or use; v1 rejects BUD-15 self-encrypted roots as unsupported.
- **Freshness**: Persist the greatest accepted `created_at` per cache identity, honor expiration, and do not silently roll back or downgrade a formerly signed identity to unsigned.
- **Compatibility**: Serve stock Nix's HTTP binary-cache paths and semantics; gateway validation supplements but does not replace Nix's own signature and hash checks.
- **Write authorization**: HTTP PUT is unavailable without a connected signer and configured owned identity; only that identity can be mutated.
- **Availability**: A new event may be published only after one advertised Blossom server has a complete reachable tree; failures elsewhere must remain visible and retryable.
- **Deployment**: Optimize v1 for a single-user local daemon while keeping subsystem boundaries suitable for a later shared gateway.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Deno | `2.9.5` | Runtime, HTTP server, permissions, Web Streams, filesystem/process APIs | It is the project's existing runtime and supplies `Deno.serve`, standards-native request/response streams, npm/JSR imports, TypeScript execution, and a built-in test runner. Pin the patch version in CI/deployment; do not target an unbounded `2.x`. |
| TypeScript | Deno-bundled `6.0.3` | Application and protocol types | Use the compiler bundled with the pinned Deno release so local and CI type checking cannot drift. Strict types are particularly valuable for validated vs. unvalidated events/blobs. |
| `applesauce-core` | `6.2.0` | Verified event ingestion, `EventStore`, reactive models/casts, event helpers | This is the required Nostr application core. `EventStore` exposes synchronous reactive views of replaceable/addressable state and now has explicit `dispose()` support for daemon shutdown. Wrap NIP-XX validation ahead of store admission. |
| `applesauce-relay` | `6.2.1` | RxJS relay connections, pooled/group subscriptions, reconnect, publish | Use `RelayPool`/groups for whitelisted publisher filters and publication acknowledgements. It natively exposes Observables, deduplicates group events, reconnects, and resubscribes; no imperative polling layer is needed. |
| `applesauce-signers` | `6.2.2` | Common signer interface, NIP-46 remote signer, local key signer | `NostrConnectSigner` implements NIP-46/bunker flows and `PrivateKeySigner` implements the same `ISigner` contract. Put both behind a daemon-owned signer lifecycle that exposes connected/authorized state. |
| RxJS | `7.8.2` | State composition, cancellation, debounce/max-delay publication scheduling | This is the version required by current Applesauce signers and compatible with the rest of Applesauce 6.x. Use it for event/state control flow, never as the byte-stream transport for NARs or blobs. |
| Web Streams API | Deno 2.9 built-in | Backpressured HTTP bodies, hashing pipelines, Blossom upload/download, NAR serving | `Request.body` and `Response` bodies are standards-native streams. Keeping the data plane as `ReadableStream<Uint8Array>` avoids Observable buffering and enables cancellation/backpressure end to end. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `applesauce-loaders` | `6.2.0` | Observable loaders combining cache/store and upstream requests | Use for BUD-03 kind `10063`, NIP-65 relay lists, and one-shot relay-backed lookups that should feed the shared `EventStore`. Do not force the Hashtree byte DAG through it. |
| `applesauce-sqlite` | `6.0.0` | Persistent Applesauce event database | Use its documented `applesauce-sqlite/deno` export when persistence of selected Nostr events is useful. Keep the security-critical highest-accepted timestamps and downgrade consent in a separate domain repository/schema so cleanup of relay data cannot erase anti-rollback state. |
| `@db/sqlite` | `0.13.0` | Small durable domain-state database | Recommended for freshness watermarks, accepted signed/unsigned state, pending publication metadata, and retry queues. SQLite transactions match publication-boundary semantics and avoid inventing a journal format. |
| `@noble/hashes` | `2.3.0` | Incremental SHA-256 and HMAC/HKDF primitives | Use `sha256.create().update(chunk)` in TransformStreams for bounded-memory hashing. Web Crypto `subtle.digest()` takes a complete buffer and is therefore unsuitable for multi-GB NAR/blob paths. |
| `@noble/curves` | `2.3.0` | Ed25519 verification for Nix `Sig` records | Use its Ed25519 verifier after strict canonical base64/key parsing. Applesauce/nostr-tools remains authoritative for Nostr event verification; do not duplicate Schnorr event verification in domain code. |
| `@scure/base` | `2.3.0` | Bech32 decoding/encoding for strict `nhash` handling | Use only the low-level bech32 codec plus a project-owned strict TLV decoder enforcing exactly the NIP.md-allowed type `0` and optional type `5` records. |
| Web Crypto API | Deno 2.9 built-in | CSPRNG and symmetric crypto building blocks | Use for secure randomness and only those BUD-15 operations whose exact algorithm is supported without whole-blob buffering. Keep BUD-15 behind a dedicated codec interface because the proposal may change. |
| `@std/assert` | `1.0.19` | Unit/integration assertions | Keep the existing JSR major pin, but lock the resolved patch in `deno.lock`. Use Deno's built-in `Deno.test` runner. |
| `@std/testing` | `1.0.20` | Test spies, mocks, and time utilities | Use sparingly for deterministic publication timers and dependency-boundary tests; prefer real local HTTP/WebSocket fixtures for protocol behavior. |
| `fast-check` | `4.9.0` | Property/fuzz testing of parsers and bounded DAG traversal | Use for TLV, tags, `.narinfo`, manifest limits, redirect handling, duplicate DAG paths, and stream chunk-boundary invariants. |

### Project-Owned Protocol Modules (Required)

| Module | Responsibility | Constraint |
|--------|----------------|------------|
| `hashtree-codec` | Canonical manifest parsing/encoding and strict `nhash` TLV | Lock fixtures to the exact upstream PR revisions adopted by this project; reject unknown TLVs even where generic BUD-18 is permissive. |
| `hashtree-reader` | Bounded, hash-deduplicated DAG traversal | Limits for manifest bytes, depth, links, unique nodes, decoded bytes, and declared link sizes are constructor-required, not optional defaults. |
| `hashtree-writer` | Persistent copy-on-write tree update and root construction | Produce immutable blobs in staging; never expose or publish a root until all reachable data is committed and one advertised replica is complete. |
| `blossom-client` | BUD-01 HEAD/GET and BUD-02/BUD-11 upload over streams | Manual redirect handling, per-hop SSRF/DNS checks, request timeouts, response size enforcement, and post-stream hash verification are mandatory. |
| `nix-cache-codec` | Strict `nix-cache-info`/`.narinfo` parsing and compatible signature merging | Preserve repeatable fields, reject malformed/ambiguous records, verify signature bytes against declared keys, and strip undeclared signatures before serving. |

### Development and Test Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `deno fmt`, `deno lint`, `deno check` | Formatting, linting, type checking | Make all three CI gates. Enable strict compiler options and disallow unchecked dependency drift via a committed `deno.lock`. |
| `deno test` | Unit, protocol, integration tests | Default tests should need no broad permissions. Split tests into permission-scoped tasks; integration tests may receive only the temp paths/loopback ports they need. |
| In-process Deno fixtures | Deterministic Nostr relay and hostile Blossom HTTP servers | Implement the minimum NIP-01 relay fixture with `Deno.upgradeWebSocket`; implement Blossom fixtures with `Deno.serve`. These make malformed frames, redirects, truncation, slow streams, and hash mismatches easy to reproduce. |
| Upstream `hzrd149/blossom-server` | Compatibility integration target | Run a pinned commit/container in integration CI. It is Deno 2-based and supports streamed upload plus BUD-01/02/11, but it is not a Hashtree implementation. |
| Nix CLI | End-to-end client compatibility | Test a pinned Nix release against the daemon as an HTTP substituter/uploader. Unit tests cannot prove stock Nix path, HEAD, signature, and compression behavior. |

## Installation

# Core runtime dependencies (exact versions)

# Persistence and protocol primitives

# Add only if persisting the Applesauce event store itself

# Test dependencies

## Prescriptive Integration Pattern

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `Deno.serve` directly | Hono/Oak | Use a framework only if route/middleware count grows substantially. V1 has a tiny fixed protocol surface and direct `Response` streams reduce hidden buffering risk. |
| Applesauce 6.x packages | `nostr-tools` directly or NDK | Use them only in a different project without the explicit Applesauce constraint. Applesauce already depends on `nostr-tools` for primitives and supplies the required reactive store/casts. |
| RxJS 7.8.2 for control plane | RxJS 8 | Revisit only after Applesauce releases declare RxJS 8 compatibility. Do not mix major versions in one Observable graph. |
| Web Streams for bytes | RxJS Observables of byte chunks | Only use chunk Observables at a narrowly audited adapter required by a dependency. Native streams provide backpressure and integrate directly with Fetch/HTTP. |
| Project-owned strict Hashtree codec | Import upstream PR branch or generic tree library | A branch can be used temporarily in a protocol spike, never as a production dependency. Generic Merkle/tree packages do not implement the proposed manifest and self-encryption formats. |
| SQLite domain state | Deno KV or JSON files | KV could make sense for a distributed future gateway. JSON is acceptable only for throwaway prototypes; neither is preferred for transactional publication and anti-rollback state in v1. |
| In-process hostile fixtures + one upstream server compatibility suite | Testcontainers for every test | Use Testcontainers later if CI already standardizes Docker orchestration. Most security/stream failure cases are faster and more controllable in process. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Deprecated `applesauce-net` `0.10.0` | It is the old relay-tools package; current Applesauce uses `applesauce-relay` 6.x. | `applesauce-relay@6.2.1` |
| `applesauce-factory` for new work | Event factories moved into current Applesauce core/actions; the standalone package is on an older release line. | Current `applesauce-core` factories/helpers plus `applesauce-signers` |
| `SimplePool`/raw `nostr-tools` as the application relay layer | It bypasses the required Applesauce reactive pool/store composition and duplicates reconnect/deduplication logic. | `RelayPool` from `applesauce-relay` |
| RxJS 8 | Applesauce 6.2 package manifests depend on `rxjs ^7.8.x`; premature adoption risks duplicate/incompatible Observable types and operator behavior. | `rxjs@7.8.2` |
| `crypto.subtle.digest()` for NAR/blob hashing | It requires the entire input in memory, violating the project's bounded-memory constraint. | Incremental `@noble/hashes` SHA-256 in a TransformStream |
| `response.arrayBuffer()`, `request.arrayBuffer()`, `Blob`, or `File` on unbounded bodies | These silently turn streams into whole-memory buffers. | Stream readers/pipelines with explicit byte ceilings |
| Automatic redirects for publisher URLs | The daemon cannot re-check scheme, DNS result, and private ranges on each hop. | `redirect: "manual"` plus a bounded, validated redirect loop |
| Unpinned GitHub imports of BUD-15–18 code | The BUDs remain open proposals and can change incompatibly without a package release. | Project-owned codec locked to recorded upstream PR revisions and conformance fixtures |
| `window`-dependent NIP-46 defaults | Applesauce's default auth handler opens a browser window and is unsuitable in a daemon. | Pass a daemon-safe `onAuth` callback and explicit relay `subscriptionMethod`/`publishMethod` or pool |
| In-memory `PrivateKeySigner` as the only local-key protection | The class correctly signs but deliberately holds raw key bytes in memory; it is not at-rest protection. | Load/decrypt a permission-restricted key only when enabling writes, minimize lifetime, zero owned buffers where practical, and document process-memory exposure |
| Full cache materialization in the Applesauce event store/SQLite | Nostr stores are for small events, not Hashtree manifests, chunks, or NARs. | Verified immutable blob storage/staging files plus small metadata rows |

## Stack Patterns by Variant

- Construct relay pool, validators, event store/casts, tree reader, merged index, and HTTP GET/HEAD server.
- Do not construct PUT routes as merely unauthorized handlers; return `405`/disabled capability until both signer and writable identity are configured.
- Persist freshness/downgrade state even when event bodies themselves are ephemeral.
- Construct `NostrConnectSigner` with explicit `relays`, a persistent client key/secret, pool-backed connection methods, and a headless `onAuth` handler that logs a safe actionable URL/state.
- Call `open()` during signer activation and `close()` during shutdown; gate write readiness on successful connection and ownership of the configured publication pubkey.
- Never publish a root based only on signer connection: complete replica reachability remains a separate precondition.
- Use `PrivateKeySigner.fromKey()` only after decrypting/reading the protected key through a narrow key-provider boundary.
- Bind configuration/secrets permissions tightly and keep signer creation outside the reactive cache model so key material is not captured in replayed values/logs.
- Treat raw-key memory exposure as an explicit v1 limitation, not as hardware-grade isolation.
- Keep BUD-15 code optional behind the same reader/writer interfaces as plaintext trees.
- Verify ciphertext address first, decrypt locally, then verify plaintext content key, exactly in that order.
- Never describe this mode as privacy or authorization; it is storage opacity only.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Deno `2.9.5` | npm ESM packages and JSR dependencies above | Current Deno npm compatibility handles the Applesauce ESM packages. Validate the complete locked graph with `deno check` in CI. |
| `applesauce-core@6.2.0` | `nostr-tools ^2.24`, `rxjs ^7.8.1` | Its manifest supplies both transitively; explicitly pin RxJS once at `7.8.2` to keep one graph instance. |
| `applesauce-relay@6.2.1` | `applesauce-core ^6.2.0`, `rxjs ^7.8.1` | Keep all current Applesauce packages on the same 6.x release family. |
| `applesauce-loaders@6.2.0` | `applesauce-core ^6.2.0`, `rxjs ^7.8.1` | Its current README describes loaders as Observable-based and designed to feed a unified `EventStore.eventLoader`. |
| `applesauce-signers@6.2.2` | `applesauce-core ^6.2.0`, `rxjs ^7.8.2` | This exact signer patch is the floor that drives the explicit RxJS `7.8.2` pin. |
| `applesauce-sqlite@6.0.0` | `applesauce-core ^6.0.0`; Deno/native peer selected explicitly | Import only from `applesauce-sqlite/deno`; verify Deno permissions and native dependency behavior before making it required for MVP. |
| `@noble/hashes@2.3.0`, `@noble/curves@2.3.0`, `@scure/base@2.3.0` | Deno 2.9/npm ESM | Use explicit subpath imports documented by each package so only required primitives enter the graph. |

## Confidence and Open Stack Risks

| Finding | Confidence | Reason |
|---------|------------|--------|
| Deno 2.9 + Applesauce 6.x is a viable core | HIGH | Current official Deno release metadata, npm package manifests, and Applesauce upstream source were cross-checked. |
| Applesauce reactive store/relay/casts fit the daemon control plane | HIGH | Official package README/source explicitly uses RxJS, `EventStore`, relay pools/groups, models, and casts. |
| `NostrConnectSigner` and `PrivateKeySigner` can share one signer boundary | HIGH | Both implement Applesauce `ISigner`; current source exposes explicit open/close and connection-method injection for NIP-46. |
| A project-owned BUD-15–18 implementation is required | MEDIUM-HIGH | All four upstream Blossom PRs are still open and no released implementation package was found. Re-check before the Hashtree implementation phase. |
| `applesauce-sqlite/deno` is suitable for mandatory persistence | MEDIUM | The export and README are official, but native/peer dependency behavior should be proven in a Deno spike. The roadmap should not couple anti-rollback correctness to it until then. |
| BUD-15 streaming can be implemented entirely with built-in Web Crypto | MEDIUM-LOW | Exact proposal algorithms and Web Crypto streaming limitations need phase-specific validation. Keep it isolated and optional until conformance/large-file tests pass. |

## Sources

- [Applesauce monorepo](https://github.com/hzrd149/applesauce) — current package manifests, source, READMEs, changelogs, casts, relay pool, store disposal, signer APIs (HIGH).
- [Applesauce documentation](https://applesauce.build/) — official getting-started, relay, model/cast, and API reference entry point (HIGH).
- [applesauce-core on npm](https://www.npmjs.com/package/applesauce-core), [applesauce-relay on npm](https://www.npmjs.com/package/applesauce-relay), [applesauce-signers on npm](https://www.npmjs.com/package/applesauce-signers) — published versions and dependency constraints (HIGH).
- [Deno releases](https://github.com/denoland/deno/releases/tag/v2.9.5) — current stable runtime version (HIGH).
- [Deno HTTP server docs](https://docs.deno.com/api/deno/~/Deno.serve) and [Web Streams examples](https://docs.deno.com/examples/http_server_streaming/) — standards-native streaming server behavior (HIGH).
- [Deno npm compatibility](https://docs.deno.com/runtime/fundamentals/node/#using-npm-packages) — npm specifiers and Node/npm interoperability (HIGH).
- [Blossom specifications](https://github.com/hzrd149/blossom) — BUD-01/BUD-03 and protocol repository (HIGH for merged BUDs).
- [BUD-15 PR](https://github.com/hzrd149/blossom/pull/104), [BUD-16 PR](https://github.com/hzrd149/blossom/pull/105), [BUD-17 PR](https://github.com/hzrd149/blossom/pull/106), [BUD-18 PR](https://github.com/hzrd149/blossom/pull/107) — all open as checked 2026-08-12 (MEDIUM-HIGH; proposed specifications).
- [Official Blossom server](https://github.com/hzrd149/blossom-server) — Deno 2 implementation and BUD-01/02/11 compatibility test target (HIGH).
- [Nostr NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) — remote signer protocol (HIGH).
- [RxJS repository](https://github.com/ReactiveX/rxjs) and [rxjs npm package](https://www.npmjs.com/package/rxjs) — current 7.8.2 release and Observable APIs (HIGH).
- [Noble hashes](https://github.com/paulmillr/noble-hashes), [Noble curves](https://github.com/paulmillr/noble-curves), [Scure base](https://github.com/paulmillr/scure-base) — incremental hashing, Ed25519, and Bech32 primitives (HIGH).
- [Deno standard library assert](https://jsr.io/@std/assert), [testing](https://jsr.io/@std/testing), and [fast-check](https://fast-check.dev/) — test dependency APIs and current releases (HIGH).
- [Nix binary cache protocol](https://nix.dev/manual/nix/2.35/protocols/binary-cache/) and [HTTP binary cache store](https://nix.dev/manual/nix/2.35/store/types/http-binary-cache-store.html) — normative client-facing layout and store semantics selected by project `NIP.md` (HIGH).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
