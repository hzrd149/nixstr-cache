# Phase 1: Verified Nix Substitution Walking Slice - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 20 proposed new/modified files
**Analogs found:** 3 / 20

## Scope Interpretation

`01-CONTEXT.md` names only `main.ts` and `deno.json`. `01-RESEARCH.md` specifies subsystem directories rather than exact filenames, so the filenames below are the smallest concrete module/test set implied by that structure and the phase requirements. The planner may split a listed module, but should preserve its trust boundary and data-flow classification.

The repository contains no application implementation beyond an 18-line hello-world HTTP entry point. Consequently, only the composition root, request handler seam, and Deno configuration have local analogs. All security-critical modules are intentionally listed under **No Analog Found** and must follow `01-RESEARCH.md`, `NIP.md`, and pinned upstream fixtures rather than inventing consistency with `main.ts`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `main.ts` | config / composition root | event-driven | `main.ts` | exact seam only |
| `deno.json` | config | batch | `deno.json` | exact |
| `src/app.ts` | service / provider | event-driven | `main.ts` | partial |
| `src/config/config.ts` | config | transform | none | no analog |
| `src/protocol/publication.ts` | model / utility | transform | none | no analog |
| `src/protocol/nhash.ts` | utility / model | transform | none | no analog |
| `src/protocol/hashtree.ts` | utility / model | transform | none | no analog |
| `src/protocol/narinfo.ts` | utility / model | transform | none | no analog |
| `src/persistence/state_repository.ts` | service / model | CRUD | none | no analog |
| `src/nostr/selection.ts` | store / service | event-driven | none | no analog |
| `src/network/safe_fetcher.ts` | service | streaming / request-response | none | no analog |
| `src/blossom/source_plan.ts` | utility | transform | none | no analog |
| `src/blossom/blob_fetcher.ts` | service | streaming / file-I/O | none | no analog |
| `src/hashtree/reader.ts` | service | streaming / transform | none | no analog |
| `src/nix/http_handler.ts` | controller / route | request-response / streaming | `main.ts` | role-match seam |
| `tests/protocol/codecs_test.ts` | test | transform | none | no analog |
| `tests/integration/publication_selection_test.ts` | test | event-driven / CRUD | none | no analog |
| `tests/integration/hostile_blossom_test.ts` | test | streaming / request-response | none | no analog |
| `tests/integration/http_cache_test.ts` | test | request-response / streaming | none | no analog |
| `tests/e2e/nix_substitution_test.ts` | test | batch / request-response | none | no analog |

## Pattern Assignments

### `main.ts` (config/composition root, event-driven)

**Analog:** `main.ts`

**Exported handler seam** (`main.ts`, lines 1-2):

```typescript
export function handler(req: Request): Response {
  const url = new URL(req.url);
```

Keep the handler importable for tests. Replace route behavior; do not retain the sample `/api` or HTML responses.

**Side-effect guard** (`main.ts`, lines 16-18):

```typescript
if (import.meta.main) {
  Deno.serve(handler);
}
```

Preserve `import.meta.main`, but change startup to: parse all configuration and collect all errors, then open durable state, then establish reactive subscriptions, and bind the listener last. No listener or network connection may be created when configuration is invalid.

---

### `deno.json` (config, batch)

**Analog:** `deno.json`

**Task/import layout** (`deno.json`, lines 1-8):

```json
{
  "tasks": {
    "dev": "deno run --watch --allow-net main.ts"
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@1"
  }
}
```

Retain JSON task/import maps, but pin exact dependency versions and add format, lint, check, unit, permission-scoped integration, and Nix E2E tasks. Permissions must be narrow; phase tests should not all inherit `--allow-all`.

---

### `src/app.ts` (service/provider, event-driven)

**Analog:** `main.ts` (partial: exported callable plus side-effect-free importability)

Use an exported composition function which receives validated configuration/dependencies and returns the handler plus shutdown lifecycle. `main.ts` remains the only executable entry point. Unlike the existing sample, `src/app.ts` must not call `Deno.serve` at module import time.

Core ordering to implement from `01-RESEARCH.md` lines 271-274:

```typescript
// conceptual ordering, not an existing local implementation
const parsed = parseConfig(rawEnvironment);
if (!parsed.ok) return parsed.errors;
const repository = openRepository(parsed.value);
const selection = startSelection(repository, parsed.value);
return bindHttp(selection, parsed.value);
```

---

### `src/config/config.ts` (config, transform)

**Analog:** none. Use the research Pattern 5 contract.

- Convert environment strings into a raw object first.
- Validate every field and cross-field invariant without side effects.
- Return all diagnostics together.
- Apply conservative defaults, reject zero/disabled bounds, and reject values above compiled ceilings.
- Treat only the environment-configured preferred Blossom origin as authorized to resolve to local/private space (D-16).

---

### `src/protocol/publication.ts` (model/utility, transform)

**Analog:** none. Follow `NIP.md` Validation and Resolution exactly.

The boundary returns a branded immutable `ValidatedPublication`; raw relay events must never be admitted to selection/store state. Verify NIP-01 id/signature, time bounds/expiration, exact raw identity, tag multiplicity, strict `nixSigKey`, strict plaintext `htree://nhash`, and individually ignore invalid `blossom` tags.

Fallback pipeline from `01-RESEARCH.md` lines 222-235:

```typescript
relayEvents$.pipe(
  map((event) => validatePublication(event, clock.now())),
  tap((result) => result.ok ? store.add(result.value.event) : rejectionLog(result.error)),
  filter((result): result is ValidPublicationResult => result.ok),
).subscribe((result) => selector.accept(result.value));
```

Validation must precede `store.add`.

---

### `src/protocol/nhash.ts` (utility/model, transform)

**Analog:** none. Copy the strict plaintext profile from `01-RESEARCH.md` lines 371-389.

```typescript
const decoded = bech32.decode(value, NHASH_MAX_LENGTH);
if (decoded.prefix !== "nhash") throw new ProtocolError("wrong HRP");
const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
const records = decodeExactTlv(bytes);
const roots = records.filter((r) => r.type === 0);
const keys = records.filter((r) => r.type === 5);
if (roots.length !== 1 || roots[0].value.length !== 32) throw new ProtocolError("root");
if (keys.length !== 0) throw new UnsupportedError("BUD-15 root");
if (records.some((r) => r.type !== 0)) throw new ProtocolError("unknown TLV");
```

Also enforce canonical Bech32 and reject the legacy bare-32-byte form.

---

### `src/protocol/hashtree.ts` (utility/model, transform)

**Analog:** none. Decode MessagePack with `@msgpack/msgpack`, then validate a project-owned discriminated union for `t=1`, `t=2`, and `t=3`.

- Validate the complete manifest before selecting a child.
- `t=1`: ordered unnamed chunks; each positive declared `s` must equal emitted bytes.
- `t=2`: unique exact UTF-8 names and valid typed links.
- `t=3`: unnamed links, positive `count`, ordered non-overlapping `first`/`last` ranges.
- Wire-byte and decoded-allocation limits are separate.

Pin fixtures to BUD-16 `1b2f140…`, BUD-17 `1848f77…`, and BUD-18 `018f3e3…`.

---

### `src/protocol/narinfo.ts` (utility/model, transform)

**Analog:** none. Implement strict line-oriented parsing with repeatable `Sig` preservation.

Per the reconciled D-12 contract in `NIP.md` lines 515-529, every syntactically valid `Sig` field must be emitted unchanged, including signatures not endorsed by an event `nixSigKey`. `nixSigKey` is endorsement metadata, not an output filter; stock Nix applies its own configured trust policy. Preserve repeatable fields and reject malformed/ambiguous scalar records.

---

### `src/persistence/state_repository.ts` (service/model, CRUD)

**Analog:** none. Use a narrow `@db/sqlite` repository.

One transaction must commit the accepted publication, `(created_at, id)` watermark/tie state, and signed-history/downgrade transition before the in-memory selection emits. Persist quarantine by canonical source origin. Only a typed cryptographic `HashMismatch` may insert quarantine; ordinary HTTP, timeout, truncation, oversize, and policy errors must not.

Expose an explicit operator release operation rather than automatic expiry.

---

### `src/nostr/selection.ts` (store/service, event-driven)

**Analog:** none. Use Applesauce `EventStore`/relay Observables and RxJS composition.

- Validate before admission.
- Compare eligible events by `(created_at, event.id)` using adopted NIP-01 ordering.
- Consult and atomically advance durable anti-rollback state.
- Emit immutable snapshots only after commit.
- Expiration clears availability; it does not select an older event.
- A corrupt/unreachable path never changes publication selection.
- Dispose subscriptions/store during shutdown.

---

### `src/network/safe_fetcher.ts` (service, streaming/request-response)

**Analog:** none. This is a Wave 0 proof gate, not routine `fetch` wrapping.

Copy the redirect control shape from `01-RESEARCH.md` lines 392-407:

```typescript
for (let hop = 0; hop <= limits.redirects; hop++) {
  const target = await policy.resolveAndApprove(url, sourceTrust);
  const response = await transport.fetchPinned(target, {
    redirect: "manual",
    signal: deadline.signal,
  });
  if (!isRedirect(response.status)) return response;
  url = policy.resolveLocation(url, requiredLocation(response));
}
throw new RedirectLimitExceeded();
```

`fetchPinned` must connect to the approved DNS address without re-resolution while preserving HTTP Host and HTTPS SNI/certificate verification. Re-run policy on every redirect. Publisher-controlled sources reject any local/private/reserved answer; the configured source follows D-16.

---

### `src/blossom/source_plan.ts` (utility, transform)

**Analog:** none.

Produce an immutable, deduplicated ordered plan: environment-configured preferred source, valid event `blossom` tags in tag order, then verified publisher BUD-03 kind `10063` sources. Canonicalize only enough to deduplicate origins without altering preserved path prefixes. Filter durable quarantine before attempts.

---

### `src/blossom/blob_fetcher.ts` (service, streaming/file-I/O)

**Analog:** none. Copy verify-to-spool from `01-RESEARCH.md` lines 238-257:

```typescript
import { sha256 } from "@noble/hashes/sha2.js";

const hash = sha256.create();
for await (const chunk of response.body!) {
  budget.consumeTransfer(chunk.byteLength);
  hash.update(chunk);
  await tempFile.write(chunk);
}
const actual = hash.digest();
if (!equalBytes(actual, expected.bytes)) throw new HashMismatch(source);
```

Use OS-created unique owner-only temporary files, await every write, close before comparison, reopen only after verification, and delete on every failure/cancellation path. Never tee unverified bytes to a decoder or client. Carry typed failure causes so only hash mismatch quarantines.

---

### `src/hashtree/reader.ts` (service, streaming/transform)

**Analog:** none. Use an iterative walker with explicit frames, one request-local mutable budget ledger, and hash-deduplicated visited nodes.

The same ledger must cover manifest wire bytes, decoded bytes, depth, links, unique nodes, attempts, redirects, time, and concurrency. HEAD traverses and authenticates manifests through the final link but does not fetch/hash the final content blob. GET streams only a previously verified file/chunk sequence and validates authenticated sizes.

---

### `src/nix/http_handler.ts` (controller/route, request-response/streaming)

**Analog:** `main.ts` lines 1-13 for standards-native `Request`, `URL`, and `Response` only.

```typescript
export function handler(req: Request): Response {
  const url = new URL(req.url);
  // route using url.pathname and return a standards-native Response
}
```

Replace the sample route with strict GET/HEAD grammar for `/nix-cache-info`, `/<store-hash>.narinfo`, and referenced NAR paths. Capture selection exactly once at request entry and pass the immutable snapshot through every helper:

```typescript
const snapshot = state.selection.current();
if (!snapshot) return new Response("cache unavailable", { status: 503 });
return req.method === "HEAD"
  ? await resolveHead(req, snapshot)
  : await resolveGet(req, snapshot, req.signal);
```

Status policy: authenticated absence `404`; unavailable selection `503`; deadline/all-timeout failure `504`; integrity/policy/malformed authenticated data/non-timeout exhaustion `502`; unsupported method `405` with `Allow: GET, HEAD`.

---

### Test files

**Analogs:** none; no test files exist.

- `tests/protocol/codecs_test.ts`: fixed NIP/BUD/narinfo vectors plus property cases for malformed TLV/MessagePack, duplicates, canonical encodings, and limit boundaries.
- `tests/integration/publication_selection_test.ts`: in-process relay, validation-before-admission, restart rollback/tie behavior, expiration, signed downgrade consent, and transaction-before-emission.
- `tests/integration/hostile_blossom_test.ts`: address pinning/rebinding, mixed DNS answers, redirect pivots, attempt order, timeout/truncation/oversize, hash mismatch, durable quarantine, explicit release, cleanup, cancellation, and bounded memory.
- `tests/integration/http_cache_test.ts`: snapshot changes mid-request, GET/HEAD distinction, strict routes, status taxonomy, and verbatim valid `Sig` preservation.
- `tests/e2e/nix_substitution_test.ts`: isolated Nix 2.34.7 store, only daemon substituter/key, uncached signed fixture path, and proof no fallback substituter supplied it.

Use `Deno.test` and `@std/assert`; give integration/E2E tasks only the permissions and loopback/temp paths they require.

## Shared Patterns

### Trust-boundary types

Apply branded/discriminated types to every boundary: raw versus validated publication, unverified versus verified blob, raw versus validated manifest, and selected immutable snapshot. Functions downstream of validation should not accept raw equivalents.

### Error handling

Use typed domain errors rather than a generic catch policy. At minimum distinguish verified absence, timeout/deadline, transport failure, policy rejection, malformed authenticated data, size/budget exhaustion, unsupported encrypted root, and `HashMismatch`. Map them centrally in the Nix handler; only `HashMismatch` mutates quarantine.

### Snapshot consistency

Read selection once per request. Pass that value explicitly through source planning, path resolution, narinfo handling, HEAD, and NAR streaming. Never read reactive current state again during the request.

### Backpressure and integrity

RxJS is control-plane only. Byte transport uses Web Streams/file streams with awaited writes and cancellation. Network bytes are fully hashed into a bounded spool before decode or response.

### Resource budgets

Construct one required request budget; do not allow optional/unlimited defaults in lower-level APIs. Check limits before allocation, fetch, redirect, or descent. Compiled hard ceilings remain enforced even when environment defaults are raised.

### Startup and durability ordering

`parse all config -> report all errors -> open/migrate SQLite -> restore selection/policy -> start relay graph -> bind listener`. For candidate changes: `validate -> transaction -> emit snapshot`.

### Nix signature contract

Strictly parse `.narinfo`, preserve all syntactically valid repeatable `Sig` lines byte-for-byte, and leave trust acceptance to stock Nix. Event `nixSigKey` values mark publisher endorsement only.

## No Analog Found

| File(s) | Role | Data Flow | Reason / Required Source |
|---|---|---|---|
| `src/config/config.ts` | config | transform | No parser/config validation exists; use Research Pattern 5 and D-13–D-16. |
| `src/protocol/*.ts` | utility/model | transform | No codecs exist; use `NIP.md`, pinned BUD revisions, and official Nix protocol. |
| `src/persistence/state_repository.ts` | service/model | CRUD | No database exists; use transactional ordering from Research. |
| `src/nostr/selection.ts` | store/service | event-driven | No Nostr/RxJS code exists; use Applesauce official reactive pattern. |
| `src/network/safe_fetcher.ts` | service | streaming/request-response | No outbound transport exists; Wave 0 must prove address binding. |
| `src/blossom/*.ts` | service/utility | streaming/file-I/O | No Blossom client exists; use source-order and verify-to-spool contracts. |
| `src/hashtree/reader.ts` | service | streaming/transform | No traversal code exists; use pinned BUD vectors and shared ledger. |
| `tests/**` | test | mixed | No repository test pattern exists; use Deno test conventions and phase validation architecture. |

## Metadata

**Analog search scope:** repository root, excluding `.git` and dependency caches  
**Source files scanned:** 4 (`main.ts`, `deno.json`, `AGENTS.md`, `NIP.md`) plus phase context/research  
**Existing implementation analogs:** 2 files (`main.ts`, `deno.json`)  
**Pattern extraction date:** 2026-08-12

The absence of local analogs is itself a planning constraint: do not infer error handling, persistence, validation, network, or test conventions from the hello-world scaffold.
