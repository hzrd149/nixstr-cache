---
quick_id: 260813-fhz
type: quick
status: ready
autonomous: true
commit: false
files_modified:
  - main.ts
  - src/config/config.ts
  - src/runtime/daemon.ts
  - src/signer/capability.ts
  - src/persistence/write_repository.ts
  - tests/integration/operator_config_test.ts
  - tests/integration/nip46_signer_test.ts
  - tests/integration/writable_cache_test.ts
  - tests/integration/publication_recovery_test.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
  - config.example.json
  - .env.example
  - README.md
  - nix/module.nix
  - nix/example-vm.nix
  - nix/VM-EXAMPLE.md
---

<objective>
Replace every flat writable-cache setting with one nested `writable` configuration contract, derive the writable publisher pubkey from the connected signer, and bind all durable write/publication state to that derived identity so signer changes fail closed.

Preserve the already-uncommitted JSON configuration and read-identity work in the dirty worktree: modify it in place, do not reset, checkout, restore, clean, overwrite unrelated edits, or revert prior quick-task changes. This execution is explicitly commit-free; do not run `git add`, `git commit`, or any GSD commit command.
</objective>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Replace the config boundary with the nested writable contract</name>
  <files>main.ts, src/config/config.ts, tests/integration/operator_config_test.ts</files>
  <behavior>
    - Missing `writable`, or `writable.enabled: false`, yields disabled writes; the false branch ignores every other nested writable value without type or semantic diagnostics.
    - Enabled `writable.type` is exactly `root` or `named`; `named` requires a valid nonempty name and `root` rejects a name. No writable pubkey is accepted from JSON or environment.
    - Enabled configuration groups `signer: { type: local|nip46, path }`, `staging: { directory, bodyBytes, aggregateBytes }`, and `publication: { nixSigKeys, lifetimeSeconds, localRelayUrl, concurrency, maxAttempts }`, retaining existing bounds/default semantics where values were previously optional.
    - Only nested `NIXSTR_WRITABLE_*` variables are recognized, and each defined leaf recursively overrides the matching JSON leaf without discarding sibling file values.
    - Relative JSON `writable.signer.path` and `writable.staging.directory` resolve from the selected config file; environment paths remain absolute.
    - Every removed flat JSON field and old writable environment variable is unsupported rather than treated as an alias.
  </behavior>
  <action>Write failing table-driven tests first. Replace the flat writable members in `RawConfig`, normalized input, and `ValidatedConfig` with discriminated nested raw/validated types. Use a disabled branch and enabled root/named branches; normalize and validate nested content only after `enabled === true`, so disabled mode deliberately ignores malformed or contradictory siblings. Keep diagnostics fully qualified (`writable.signer.path`, etc.), preserve validation-before-side-effects, immutable validated output, numeric ceilings, aggregate-at-least-body validation, canonical Nix signature key checks, and credential-free relay URL checks. Represent the enabled identity as kind plus identifier only (`root` maps to kind 17091 and empty identifier; `named` maps to kind 37091 and the validated name); do not retain a configured publisher key or a compatibility parser for the removed writable fields.

In `main.ts`, replace the old writable allowlist with `NIXSTR_WRITABLE_ENABLED`, `NIXSTR_WRITABLE_TYPE`, `NIXSTR_WRITABLE_NAME`, `NIXSTR_WRITABLE_SIGNER_TYPE`, `NIXSTR_WRITABLE_SIGNER_PATH`, `NIXSTR_WRITABLE_STAGING_DIRECTORY`, `NIXSTR_WRITABLE_STAGING_BODY_BYTES`, `NIXSTR_WRITABLE_STAGING_AGGREGATE_BYTES`, `NIXSTR_WRITABLE_PUBLICATION_NIX_SIG_KEYS`, `NIXSTR_WRITABLE_PUBLICATION_LIFETIME_SECONDS`, `NIXSTR_WRITABLE_PUBLICATION_LOCAL_RELAY_URL`, `NIXSTR_WRITABLE_PUBLICATION_CONCURRENCY`, and `NIXSTR_WRITABLE_PUBLICATION_MAX_ATTEMPTS`. Parse the enabled environment leaf strictly as a boolean string accepted by the config contract, construct only defined nested leaves, and recursively merge plain objects field-by-field over JSON. Validate a closed nested JSON schema and native booleans/arrays/numbers. Resolve the two nested file-owned paths before environment merge. Remove all old writable variable handling; do not alter read-side legacy behavior such as `NIXSTR_PUBLISHER_PUBKEYS` unless required by the already-dirty prior task.

Expand operator tests for missing/false/complete root/complete named cases, name constraints, both signer types, nested type errors and limits, recursive partial overrides at every group, config-relative nested paths, absolute environment paths, rejection of old JSON/env names, and zero startup side effects for invalid enabled config. Include an end-to-end loader-to-daemon tracer proving a syntactically enabled signer starts read service while PUT remains 405 before signer readiness.</action>
  <verify>
    <automated>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts</automated>
  </verify>
  <done>The only writable configuration surface is the nested `writable` object and matching `NIXSTR_WRITABLE_*` leaves; disabled semantics, root/named rules, recursive merge, relative paths, and absence of a configured pubkey are covered by focused tests.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Derive signer ownership and bind durable write state fail-closed</name>
  <files>src/runtime/daemon.ts, src/signer/capability.ts, src/persistence/write_repository.ts, tests/integration/nip46_signer_test.ts, tests/integration/writable_cache_test.ts, tests/integration/publication_recovery_test.ts, tests/e2e/nix_publication_roundtrip_test.ts</files>
  <behavior>
    - Local and NIP-46 signer startup derive the pubkey with `getPublicKey()` and combine it with configured root/named kind and name; no configured-pubkey ownership comparison remains.
    - HTTP reads start normally and PUT returns 405 while the signer is disconnected, connecting, failed, or rejected by durable identity binding.
    - The first ready signer atomically binds the write repository to its complete canonical writable identity before PUT, batching, signing, repair, or publication work becomes ready.
    - Reopening existing durable write state with the same canonical identity resumes normally; a different signer pubkey or root/named identity fails closed and cannot read, mutate, sign, publish, repair, or relabel that pending state.
    - A signer's public key changing after readiness makes the capability fail closed and prevents subsequent signing/publication.
  </behavior>
  <action>Refactor `SignerCapability` so its intent contains signer type/path and the configured kind/identifier, while readiness exposes the signer-derived pubkey. Remove `ownership_mismatch` against configuration and retain a dedicated identity-change failure for a signer whose `getPublicKey()` no longer equals its initially derived key. Keep protected-source checks, key zeroing, headless NIP-46 behavior, signing-event pubkey checks, close semantics, and secret-safe diagnostics.

Add a durable singleton owner record to `WriteRepository` and an atomic bind/assert API for the canonical `kind:derived-pubkey:identifier` identity. Binding an empty repository establishes the owner; matching restart is idempotent. If an owner exists and differs, throw a typed sanitized error without updating the owner or any pending/staged/overlay/saga/history/repair rows. Treat all existing durable content as identity-bearing, including pending candidate and publication repair data; do not infer permission to migrate from the absence of an active saga. Tests may create legacy unbound databases only as fresh empty stores—there is no silent migration path for nonempty unbound durable write state.

Rewire daemon startup as an asynchronous readiness transition: the read handler/listener remains available immediately, but write readiness, writable overlay publication identity, destination lookup, coordinator start/recovery, and health ownership become available only after signer readiness and successful repository binding. Build the canonical identity from the derived pubkey, then pass that exact immutable value to publication components. Ensure signer failure, changed identity, or repository mismatch leaves PUT at 405 and does not start publication work. Update direct capability fixtures and production local/NIP-46/restart tests to the nested config contract. Add durable mismatch coverage with pending publication data, proving bytes/rows and stored owner remain unchanged after attempted startup with a second key. Update the stock-Nix publication E2E environment to the new variable names and remove configured pubkey input.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/nip46_signer_test.ts tests/integration/writable_cache_test.ts tests/integration/publication_recovery_test.ts &amp;&amp; deno test --allow-run=nix,nix-store,deno --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/e2e/nix_publication_roundtrip_test.ts</automated>
  </verify>
  <done>Signer-derived identity is the sole write owner, readiness remains unavailable until durable binding succeeds, identity changes fail closed, and pending durable publication state cannot silently move to another pubkey.</done>
</task>

<task type="auto">
  <name>Task 3: Update every operator surface and run the complete repository gate</name>
  <files>config.example.json, .env.example, README.md, nix/module.nix, nix/example-vm.nix, nix/VM-EXAMPLE.md</files>
  <action>Update the JSON example to use one read-only `writable: { "enabled": false }` object. Document complete enabled root and named shapes, nested defaults/limits, signer-derived pubkeys, config-relative signer/staging paths, recursive environment-over-JSON merge, and the fact that disabled mode ignores all other writable members. Replace all old writable environment names in `.env.example`, README, NixOS module descriptions/examples, VM example, and VM guide with the exact nested `NIXSTR_WRITABLE_*` names from Task 1. State clearly that there are no backward-compatible aliases and operators must migrate atomically. Explain that signer changes against existing writable state fail closed and require an explicit operator-managed fresh state location rather than automatic pending-publication migration.

Preserve all unrelated dirty JSON/read-identity documentation and Nix module edits already present. Search production code, active examples, and tests for every removed flat config property and old writable environment name; remove active usages while leaving historical `.planning/milestones` artifacts untouched. Run formatting, lint, type checking, all protocol/integration/E2E tests through the repository's full verification task. Inspect `git diff` and `git status --short` only to confirm the pre-existing dirty work remains represented and no credential/config secret was added. Do not stage or commit any file.</action>
  <verify>
    <automated>deno task verify</automated>
  </verify>
  <done>Runtime, module, examples, documentation, and tests describe only the nested writable contract; the complete suite passes and the worktree remains uncommitted with prior dirty work preserved.</done>
</task>

</tasks>

<verification>
- Focused config: `deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts`
- Focused identity/runtime: `deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/nip46_signer_test.ts tests/integration/writable_cache_test.ts tests/integration/publication_recovery_test.ts`
- Full gate: `deno task verify`
- Final hygiene: `git diff --check` and `git status --short`; do not stage or commit.
</verification>

<source_audit>
- GOAL — Replace flat writable configuration across parsing, runtime, durable ownership, operator surfaces, and tests: Tasks 1-3.
- REQ — Missing/false disable semantics; root/named validation; grouped signer/staging/publication objects; signer-derived pubkey; recursive nested environment overrides; relative nested paths; read-only startup and PUT 405; fail-closed identity changes; complete documentation/tests: all explicitly covered in Tasks 1-3.
- RESEARCH — Existing Deno/TypeScript, signer capability, SQLite write repository, and direct Web/Applesauce runtime patterns are retained; no dependency install or external discovery is required.
- CONTEXT — The dirty JSON/read-identity worktree is preserved, backward aliases are prohibited, and execution performs no commits. No deferred project item is introduced.
</source_audit>

<success_criteria>
- Flat writable JSON fields and old writable environment variables are absent from active code, tests, examples, and operator docs, with no compatibility aliases.
- Disabled writable configuration is the default and ignores nested siblings; enabled root/named forms validate exactly as locked.
- Environment leaves recursively override JSON leaves and nested signer/staging JSON paths resolve relative to the config file.
- The signer pubkey is derived at startup, durable state is bound before write readiness, and any identity mismatch or later key change leaves PUT disabled without state migration.
- Read-only service remains available during signer connection/failure, the full suite passes, prior dirty work is not reverted, and no commit is created.
</success_criteria>
