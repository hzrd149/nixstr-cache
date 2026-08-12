---
phase: 01-verified-nix-substitution-walking-slice
reviewed: 2026-08-12T12:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - src/config/config.ts
  - src/network/safe_fetcher.ts
  - tests/integration/address_pinning_test.ts
  - deno.json
  - src/protocol/nhash.ts
  - src/protocol/publication.ts
  - src/persistence/state_repository.ts
  - src/nostr/selection.ts
  - tests/protocol/publication_test.ts
  - tests/integration/publication_selection_test.ts
  - src/protocol/hashtree.ts
  - src/blossom/source_plan.ts
  - src/blossom/blob_fetcher.ts
  - src/hashtree/reader.ts
  - tests/protocol/hashtree_test.ts
  - tests/integration/hostile_blossom_test.ts
  - src/protocol/narinfo.ts
  - src/nix/http_handler.ts
  - src/app.ts
  - tests/protocol/narinfo_test.ts
  - tests/integration/http_cache_test.ts
  - main.ts
  - tests/e2e/nix_substitution_test.ts
  - tests/fixtures/nix/README.md
  - README.md
findings:
  critical: 9
  warning: 3
  info: 0
  total: 12
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-12T12:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The Phase 01 implementation has nine ship-blocking correctness/security defects and three robustness defects. The most serious gaps are that live Nostr events bypass the configured publisher whitelist, global selection is arrival-dependent rather than publisher-priority-driven, response body reads lose all configured deadlines after headers, and the SSRF filter accepts expanded loopback and IPv4-mapped IPv6 addresses. Hashtree file assembly reverses multi-manifest content, chunked HTTP responses are hashed with their framing bytes, `.narinfo` is materialized without its configured metadata ceiling, undeclared signatures are served unchanged, and the repository's advertised daemon entry point cannot start the daemon.

`deno task check` and `deno task test` pass, but the passing tests encode or omit several of these unsafe behaviors and therefore do not establish correctness.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Live publications bypass the configured publisher whitelist

**Classification:** BLOCKER
**File:** `src/nostr/selection.ts:68-82`
**Issue:** `accept()` validates the event's signature and immediately persists/exposes it without checking `publisherPubkeys` or the optional `identities` allow-list. `identities` is used only while restoring database rows. Any signer whose event reaches the Observable can therefore become the active cache publisher, defeating the project's primary trust boundary.
**Fix:** Require an explicit publisher/identity allow-list in `SelectionOptions` and reject a validated publication before repository admission unless its pubkey and cache identity are allowed. Add a live-stream test using a correctly signed event from a non-whitelisted key.

### CR-02: Cache selection ignores deterministic publisher priority

**Classification:** BLOCKER
**File:** `src/nostr/selection.ts:53-64`
**Issue:** Every newly accepted identity is exposed unconditionally. Freshness comparison occurs only within an identity in `StateRepository`; across publishers, the last event delivered wins. Restart restoration instead chooses the globally newest timestamp. Thus the selected cache changes with relay ordering and restart state rather than configured publisher priority, and an older event from a lower-priority publisher can replace the current view.
**Fix:** Maintain one accepted candidate per allowed identity and derive the selected publication using the configured publisher order (and cache identity rules). Recompute that deterministic selection on admission, expiry, and restore instead of calling `expose()` for every accepted event.

### CR-03: Total and connect deadlines stop applying once response headers arrive

**Classification:** BLOCKER
**File:** `src/network/safe_fetcher.ts:318-323`
**Issue:** `PinnedTransport.fetch()` removes the abort listener before returning the response body. `SafeFetcher` does not expose its internally created total signal to the caller, so a server can send headers promptly and then stall the body forever. The configured `idleTimeoutMs` is not represented in `SafeFetcherLimits` at all. This violates the mandatory total/idle timeout guarantees and permits trivial request-slot and spool-file exhaustion.
**Fix:** Keep a request-lifetime abort handler attached through body completion/cancellation, implement a resetting idle timer around each body read, and dispose timers/listeners only when the body closes. Ensure the total signal, not merely the caller signal, governs the returned stream.

### CR-04: IPv6 textual variants bypass the SSRF address filter

**Classification:** BLOCKER
**File:** `src/network/safe_fetcher.ts:46-51`
**Issue:** IPv6 filtering is based on string prefixes and exact compressed literals. Expanded loopback (`0:0:0:0:0:0:0:1`) and hexadecimal IPv4-mapped loopback/private forms such as `::ffff:7f00:1` are treated as public. A publisher-controlled hostname resolving to one of these representations can reach local services despite the SSRF policy.
**Fix:** Parse every resolver answer into canonical 128-bit address bytes, normalize IPv4-mapped addresses to IPv4, then apply CIDR checks to loopback, unspecified, link-local, unique-local, multicast, documentation, and all forbidden IPv4 ranges. Add tests for compressed, expanded, and mapped representations.

### CR-05: HTTP/1.1 chunked bodies are not decoded

**Classification:** BLOCKER
**File:** `src/network/safe_fetcher.ts:193-244`
**Issue:** When `Content-Length` is absent, `responseBody()` forwards bytes until EOF. It never interprets `Transfer-Encoding: chunked`, so ordinary streaming HTTP/1.1 Blossom responses include chunk-size lines and delimiters in the purported blob. Correct blobs then fail hash verification and their origins can be quarantined. Conflicting or unsupported transfer framing is also not rejected.
**Fix:** Implement strict HTTP/1.1 chunk decoding with bounded chunk/trailer parsing, reject ambiguous `Transfer-Encoding` plus `Content-Length`, and reject unsupported transfer codings. Cover split framing boundaries and trailers in integration tests.

### CR-06: Nested file manifests emit chunks in reverse order

**Classification:** BLOCKER
**File:** `src/hashtree/reader.ts:280-286`
**Issue:** Children are pushed onto a LIFO stack in reverse order, which already makes them pop in forward order, but each raw child is then added with `chunks.unshift()`. A file manifest containing chunks A then B produces B then A. The current E2E fixture uses raw directory links and never exercises a multi-chunk file manifest.
**Fix:** Append raw chunks with `chunks.push()` while traversing frames in forward logical order (or redesign traversal with explicit ordered frames). Add a test with at least two raw chunks and a nested file-manifest child asserting exact byte order.

### CR-07: Authenticated sizes allow unbounded disk transfer and `.narinfo` memory allocation

**Classification:** BLOCKER
**File:** `src/hashtree/reader.ts:220-225`
**Issue:** For raw data, `maxTransferBytes` is replaced by the publisher-declared link size, which may be as large as `Number.MAX_SAFE_INTEGER`; no per-request total data-byte ceiling exists. A hostile signed manifest can therefore fill disk while a blob is verified. For `.narinfo`, `src/nix/http_handler.ts:99` subsequently calls `new Response(resolved.body).bytes()`, allocating the entire authenticated size in memory. The configured `decodedMetadataBytes` ceiling is never applied at this boundary.
**Fix:** Add explicit configured per-blob and total transferred/output byte budgets and debit them while streaming. Before fetching `.narinfo`, reject descriptors above the metadata ceiling, then decode through a bounded reader rather than an unbounded `bytes()` call.

### CR-08: Undeclared and invalidly named signatures are served unchanged

**Classification:** BLOCKER
**File:** `src/nix/http_handler.ts:99-113`
**Issue:** The handler classifies endorsements only for telemetry and then serializes `rawText`, retaining every `Sig` line. `classifyEndorsements()` at `src/protocol/narinfo.ts:184-193` also ignores the signature's key name and tries every declared key. This violates the requirement to strip undeclared signatures and makes the gateway's endorsement result disagree with Nix's name-based key lookup.
**Fix:** Match a signature only against the declared key with the same name, construct the served narinfo from scalar lines plus only successfully endorsed signature lines, and test mixed valid, undeclared-name, wrong-key, and duplicate signature cases.

### CR-09: The advertised daemon entry point always exits without starting

**Classification:** BLOCKER
**File:** `main.ts:29-34`
**Issue:** Running `main.ts` (including `deno task dev`) unconditionally prints that composition is external and exits 1. No launcher in the reviewed implementation supplies `AppDependencies`, so the documented daemon cannot be started outside the bespoke E2E test process.
**Fix:** Build the real repository, relay selection, source plan, safe fetcher, resolver, and HTTP handler dependencies in the production entry point, call `run()`, and install signal-driven graceful shutdown. Make a smoke test launch the same entry point shipped to users.

## Warnings

### WR-01: Failed blob reads do not cancel the response stream

**Classification:** WARNING
**File:** `src/blossom/blob_fetcher.ts:197-222`
**Issue:** When a size limit, write error, or abort throws, the `finally` block only releases the reader lock. It does not cancel the reader/response, so the pinned socket can remain open and continue consuming resources until the peer or another timeout closes it (and CR-03 means that timeout may never occur).
**Fix:** Track successful EOF and call `await reader.cancel(error)` on every exceptional exit before releasing the lock.

### WR-02: Shutdown failures skip all application resource cleanup

**Classification:** WARNING
**File:** `src/app.ts:98-104`
**Issue:** If `listener.shutdown()` rejects, `app.closeResources()` is never invoked. The selection subscription and SQLite repository remain open during a failed shutdown.
**Fix:** Put `app.closeResources()` in a `finally` block around `await listener.shutdown()` and make resource closure idempotent.

### WR-03: Corrupt persisted JSON can abort selection startup

**Classification:** WARNING
**File:** `src/persistence/state_repository.ts:119-133`
**Issue:** `loadSelection()` parses `event_json` twice and calls `.tags.some()` before any shape validation. A truncated/corrupt row throws during `loadSelections()`, preventing all valid identities from being restored and stopping startup rather than isolating the damaged row.
**Fix:** Parse once inside a guarded repository decoding function, validate the minimal stored shape, and return/report a quarantined corrupt row so other selections can still load. The selector should still re-run full cryptographic validation before exposure.

---

_Reviewed: 2026-08-12T12:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
