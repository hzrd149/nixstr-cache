# Phase 1 API Capability Coverage

**Phase:** 01 — Verified Nix Substitution Walking Slice
**Decision rule:** Every externally observable capability is either integrated in Phase 1 or explicitly outside its boundary.

| Surface | Capability | Decision | Plan / reason |
|---|---|---|---|
| Nostr relay | Subscribe to kinds `17091`, `37091`, and publisher kind `10063` events | INTEGRATE | 01-02; required for publication selection and BUD-03 source discovery. |
| Nostr relay | Verify event id/signature before store admission | INTEGRATE | 01-02; PROT-02 trust boundary. |
| Nostr relay | Publish events | OPT-OUT | Phase 4 owns publication. |
| Publication protocol | Strict `d`, `htree`, `nhash`, `nixSigKey`, `blossom`, expiration validation | INTEGRATE | 01-02. |
| Publication protocol | Plaintext BUD-18 root | INTEGRATE | 01-02 and 01-03. |
| Publication protocol | BUD-15 self-encrypted root | OPT-OUT | Explicitly rejected by PROT-06 in v1. |
| Durable state | Selected publication plus `(created_at,id)` watermark/tie state | INTEGRATE | 01-02. |
| Durable state | Signed-history, downgrade consent, and source quarantine | INTEGRATE | 01-02 and 01-04. |
| Blossom HTTP | Ordered sources: configured origin, event tags, BUD-03 list | INTEGRATE | 01-03. |
| Blossom HTTP | GET immutable blob by SHA-256 | INTEGRATE | 01-03. |
| Blossom HTTP | HEAD immutable blob | OPT-OUT | Tree path `HEAD` authenticates manifests and the final link without probing final blob availability per D-10. |
| Blossom HTTP | Upload / mirror fetched blobs | OPT-OUT | Phase 2 owns verified read/write-through caching; D-08. |
| Blossom HTTP | Automatic redirects | OPT-OUT | Manual bounded redirects with per-hop address approval are mandatory. |
| Hashtree | BUD-16 `t=1`, `t=2`; BUD-17 `t=3`; BUD-18 strict `nhash` | INTEGRATE | 01-03, pinned proposal revisions. |
| Hashtree | Full crawl/materialization | OPT-OUT | Phase requires lazy request-path traversal only. |
| Nix HTTP cache | `GET`/`HEAD /nix-cache-info` | INTEGRATE | 01-04. |
| Nix HTTP cache | `GET`/`HEAD /<store-hash>.narinfo` | INTEGRATE | 01-04. |
| Nix HTTP cache | `GET`/`HEAD` referenced NAR path | INTEGRATE | 01-04. |
| Nix HTTP cache | Preserve all syntactically valid `Sig` lines and classify publisher endorsement separately | INTEGRATE | 01-04, D-12/READ-04. |
| Nix HTTP cache | PUT upload routes | OPT-OUT | Phase 3 owns signer-gated writes. Unsupported methods return `405` with `Allow: GET, HEAD`. |
| Nix client | Real pinned Nix `2.34.7` substitution from an isolated uncached store | INTEGRATE | 01-05 final gate. |
| Operations | Environment configuration, aggregate validation, start/stop lifecycle | INTEGRATE | 01-01 and 01-04. |
| Operations | Health endpoint and production observability | OPT-OUT | Phase 4 requirements OPER-02/OPER-03. Rejection diagnostics required by PROT-02 remain integrated. |

No capability in the three in-scope external protocols is implicit: relay publication, Blossom upload/cache-fill, encrypted roots, full-tree crawl, PUT, and health/production telemetry are explicitly assigned to later phases or rejected by the v1 contract.

## Multi-Source Coverage Audit

| Source | Items audited | Coverage |
|---|---|---|
| GOAL | Validated startup; latest eligible plaintext selection; GET/HEAD metadata/narinfo/NAR; hostile bounded verified streaming; real Nix substitution | COVERED by 01-01 through 01-05. |
| REQ | PROT-02–06; TREE-01–05; READ-01–04, READ-07; OPER-01 | COVERED; every ID appears in PLAN frontmatter. |
| RESEARCH | Package legitimacy gate; address-pinned transport feasibility; exact BUD proposal fixtures; strict codecs; SQLite commit-before-emit; verify-to-spool; shared traversal ledger; status taxonomy; Nix 2.34.7 | COVERED by executable tasks and blocking gates. |
| CONTEXT | D-01 through D-16 | COVERED with decision IDs cited in task or must-have text. D-12 is already reconciled and is implemented without re-opening the decision. |
| CONTEXT deferred | Verified Blossom read/write-through caching | EXCLUDED; explicitly assigned to Phase 2 per D-08. |
| Spec-less edges | 28 applicable, zero resolved | COVERED by exactly 28 explicit `flagged_assumptions` entries across the five plans. |
| Prohibition recall | Safety/value prohibitions retained after dropping generic canon candidates | COVERED by descriptor-less, `status: unverified`, `flagged: true` entries. Generic SSRF/DoS/path/resource canon is handled in threat models and was not duplicated as speculative product prohibitions. |

No source item is missing and no phase split is required.
