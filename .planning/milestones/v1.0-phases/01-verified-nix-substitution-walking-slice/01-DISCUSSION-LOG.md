# Phase 1: Verified Nix Substitution Walking Slice - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-12
**Phase:** 1-Verified Nix Substitution Walking Slice
**Areas discussed:** Publication selection and recovery, Upstream source behavior, HTTP cache semantics, Configuration and safety limits

---

## Publication Selection and Recovery

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Behavior after expiration | Retain stale snapshot; stop serving; configurable policy | Stop serving |
| Restart with watermark newer than relay events | Unavailable; persisted verified root; explicit rollback | Persisted verified root |
| Persisted root with missing blobs | Per-path serving; disable whole cache; cached-only | Per-path serving |
| Valid root with later path failure | Keep selected; automatic fallback; quarantine root | Keep selected |

**User's choice:** Strict eligibility and anti-rollback, with persisted verified state and request-local failure handling.
**Notes:** Missing blobs are expected and cache reads must account for them. A path failure does not justify publication rollback.

---

## Upstream Source Behavior

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Source order | Event then BUD-03; BUD-03 then event; race sources; local configured source first | Local configured source, event tags, BUD-03 |
| Corrupt response | Skip request source; temporary suppression; server quarantine | Server quarantine |
| Quarantine release | Operator only; health probe; timed retry | Operator only |
| Trigger | Hash mismatch only; any malformed response; repeated failures | Hash mismatch only |

**User's choice:** Prefer the configured cache server and durably quarantine a source after one hash mismatch.
**Notes:** Ordinary availability or protocol failures do not trigger quarantine. Local Blossom write-through remains Phase 2.

---

## HTTP Cache Semantics

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Failed lookup status | Distinguish absence/failure; always 404; always 503 | Distinguish absence/failure |
| HEAD depth | Full final-blob verification; metadata-only; local-only | Metadata-only |
| Snapshot lifetime | Per request; per connection; always latest | Per request |
| Undeclared signatures | Strip; hide record; validation error; pass valid signatures | Pass all syntactically valid signatures |

**User's choice:** Preserve valid signature material and leave trust enforcement to Nix.
**Notes:** The user explicitly judged the current `NIP.md` rule incorrect. This decision requires reconciling `NIP.md` and `READ-04` before planning.

---

## Configuration and Safety Limits

| Decision | Alternatives considered | Selected |
|----------|-------------------------|----------|
| Invalid startup config | Fail startup; readiness-disabled; partial operation | Fail startup |
| Limit overrides | Defaults plus hard ceilings; all explicit; unrestricted | Defaults plus hard ceilings |
| Private/local source authority | Operator configuration only; publisher allowed; global switch | Operator configuration only |
| Additional private-network flag | Required; config itself authorizes; implicit loopback only | Config itself authorizes |

**User's choice:** Fail closed on configuration, bound all resource controls, and allow private destinations only through the operator's environment configuration.
**Notes:** Publisher-controlled sources resolving to local/private/reserved addresses are ignored.

## the agent's Discretion

- Exact gateway status code mapping, configuration names/defaults/ceilings, and quarantine-release interface.

## Deferred Ideas

- Phase 2: write verified upstream blobs into the configured local Blossom cache.
