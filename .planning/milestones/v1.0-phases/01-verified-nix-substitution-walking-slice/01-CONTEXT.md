# Phase 1: Verified Nix Substitution Walking Slice - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning after protocol reconciliation

<domain>
## Phase Boundary

Deliver one safe read-only walking slice in which a real Nix client substitutes an uncached store path from one selected plaintext Nostr/Blossom cache. The slice includes publication validation and persistence, rollback and downgrade protection, bounded hostile-network traversal, verified streaming, and stock Nix HTTP GET/HEAD behavior. Multi-publisher merging, local Blossom write-through caching, signing, PUT staging, and publication remain later phases.

</domain>

<decisions>
## Implementation Decisions

### Publication Selection and Recovery
- **D-01:** Once a selected publication expires or otherwise becomes ineligible, stop serving it until a fresh eligible publication is selected.
- **D-02:** After restart, a persisted verified root may remain selected when relays expose only older events. Never replace it with an older relay candidate.
- **D-03:** Resolve availability per request. Missing blobs fail only the affected path and do not invalidate the selected root or unrelated paths.
- **D-04:** A newer event that passes publication validation remains selected if a later path is corrupt, incomplete, or unreachable. Fail the affected read; do not automatically roll back to an earlier root.

### Upstream Source Behavior
- **D-05:** Candidate order is: the operator-configured cache Blossom server, valid event `blossom` tags in tag order, then the publisher's BUD-03 list. Deduplicate identical URLs.
- **D-06:** One fetched-blob hash mismatch quarantines the entire source server. Quarantine persists across restarts and requires explicit operator release.
- **D-07:** Only a cryptographic hash mismatch triggers quarantine. Timeouts, HTTP failures, 404 responses, truncation, oversized responses, and redirect-policy failures remain ordinary source-attempt failures.
- **D-08:** Phase 1 may use the configured cache Blossom server as a preferred read source, but writing verified upstream blobs back to it remains Phase 2 scope.

### HTTP Cache Semantics
- **D-09:** Return `404` only when the verified tree proves the requested path is absent. Use an appropriate gateway failure or timeout status when upstream transport, availability, or integrity prevents resolution.
- **D-10:** `HEAD` proves that the Hashtree path exists but does not fetch or hash-verify the final content blob. It confirms indexed presence, not current end-to-end retrievability.
- **D-11:** Capture the selected publication snapshot at the beginning of each GET or HEAD request and use it through completion, even if reactive selection changes in flight.
- **D-12:** Correct the current signature-filtering rule: pass every syntactically valid `.narinfo` `Sig` line unchanged. `nixSigKey` identifies publisher-endorsed signatures but does not authorize deleting other signatures; stock Nix applies its configured key-trust policy. Malformed signature fields remain subject to strict `.narinfo` parsing. — **Reversibility:** one-way — this changes the public gateway contract and requires coordinated amendments to `NIP.md` and requirement `READ-04` before planning.

### Configuration and Safety Limits
- **D-13:** Missing or invalid required configuration fails startup, reports all discovered validation errors together, and binds no HTTP listener.
- **D-14:** Every resource and traversal bound has a conservative default. Operators may tighten limits or raise them only to compiled hard ceilings; limits cannot be disabled.
- **D-15:** Ignore event-provided and BUD-03-discovered sources that resolve to local, private, or reserved addresses.
- **D-16:** Only environment-based operator configuration may define the preferred cache Blossom server, whether local or remote. Setting that environment variable is itself authorization to access the configured server's resolved address; no second private-network opt-in is required.

### the agent's Discretion
- Choose exact HTTP status codes within the gateway-error versus timeout distinction in D-09, preserving stock Nix compatibility.
- Choose configuration variable names, conservative default values, and compiled hard ceilings during research and planning.
- Choose the operator command or configuration mechanism that explicitly releases a quarantined server.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Protocol and Phase Contract
- `NIP.md` — Normative publication, validation, freshness, Blossom discovery, Hashtree resolution, and Nix-facing rules. Its signature-filtering text must be reconciled with D-12 before planning.
- `.planning/REQUIREMENTS.md` — Phase requirement mapping and acceptance contract. `READ-04` must be reconciled with D-12 before planning.
- `.planning/ROADMAP.md` — Fixed Phase 1 boundary, requirements, and success criteria.
- `.planning/PROJECT.md` — Project-wide trust, streaming, network-safety, compatibility, and scope constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `main.ts`: Minimal `Deno.serve` entry point and exported request handler; useful only as the replaceable HTTP bootstrap seam.
- `deno.json`: Existing Deno task/import configuration to extend with pinned runtime dependencies and verification tasks.

### Established Patterns
- No application architecture or domain patterns exist yet; the repository is effectively greenfield.
- Standards-native Deno HTTP request/response types are already in use and align with the required Web Streams data plane.

### Integration Points
- Replace the hello-world routing in `main.ts` with validated startup composition and the Nix binary-cache routes.
- Treat `NIP.md` as the protocol boundary, subject to the explicit D-12 correction.

</code_context>

<specifics>
## Specific Ideas

- Missing blobs are expected in a decentralized cache and must be accounted for per read rather than treated as proof that the whole selected root is invalid.
- The operator-configured cache Blossom server is always attempted before publisher-controlled sources.
- Hash mismatch is treated as evidence against the server as a whole, warranting durable quarantine.
- Every syntactically valid Nix signature offers potential validity to the packaged NAR; the daemon preserves it and leaves trust selection to Nix.

</specifics>

<deferred>
## Deferred Ideas

- Writing verified fetched blobs into the configured local Blossom server is part of Phase 2's read/write-through cache capability.

</deferred>

---

*Phase: 1-Verified Nix Substitution Walking Slice*
*Context gathered: 2026-08-12*
