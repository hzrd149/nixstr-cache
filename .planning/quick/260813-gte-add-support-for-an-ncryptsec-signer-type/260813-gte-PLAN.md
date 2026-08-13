---
quick_id: 260813-gte
type: quick
status: ready
autonomous: true
commit: false
files_modified:
  - main.ts
  - src/config/config.ts
  - src/runtime/password_prompt.ts
  - src/runtime/daemon.ts
  - src/signer/capability.ts
  - tests/integration/operator_config_test.ts
  - tests/integration/ncryptsec_signer_test.ts
  - config.example.json
  - README.md
  - .env.example
---

<objective>
Add an enabled writable signer form `signer: { type: "ncryptsec", ncryptsec: "..." }` that decrypts the configured NIP-49 secret only after securely prompting for its unlock password on daemon startup, then participates in the existing signer-derived ownership and publication flow.

Preserve the shared dirty worktree and its in-progress nested writable configuration exactly: extend the current shape in place, do not reset, checkout, restore, clean, overwrite unrelated edits, or revert preceding quick-task work. This execution is commit-free; do not stage or commit files.
</objective>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Extend config and signer startup with an injectable NIP-49 unlock path</name>
  <files>main.ts, src/config/config.ts, src/runtime/password_prompt.ts, src/runtime/daemon.ts, src/signer/capability.ts, tests/integration/operator_config_test.ts, tests/integration/ncryptsec_signer_test.ts</files>
  <behavior>
    - Enabled JSON accepts exactly `signer: { type: "ncryptsec", ncryptsec: "ncryptsec1..." }`; local and nip46 continue to require `path`, while every signer mode rejects the other mode's source field and missing/empty input.
    - The matching `NIXSTR_WRITABLE_SIGNER_NCRYPTSEC` leaf participates in the current recursive environment-over-JSON merge without being treated as a path or written to diagnostics; disabled writable configuration continues to ignore signer siblings.
    - Startup asks for one password only when ncryptsec mode is enabled, passes it through an injected prompt boundary, and uses locked `nostr-tools/nip49.decrypt(ncryptsec, password): Uint8Array` to obtain the key before constructing the existing `PrivateKeySigner` capability.
    - A correct password reaches ready state, derives the expected pubkey, signs a valid event, and follows the same durable ownership/readiness path as a local signer; malformed ncryptsec, wrong password, EOF, unavailable stdin, or prompt failure produces a sanitized failed signer state and leaves PUT unavailable.
    - Closing or failed startup zeroes every owned decrypted-key byte buffer; the password is never logged, placed in config/state/diagnostics, cached on the capability, or retained after the synchronous decrypt handoff.
  </behavior>
  <action>Write focused tests first, generating deterministic encrypted fixtures with the already-locked `nostr-tools/nip49.encrypt` API. Extend `RawWritableConfig`, `WriteIntent`, and `ValidatedWritableConfig` as discriminated signer-source unions: local/nip46 retain protected absolute `path`; ncryptsec retains the encrypted string and no path. Validate enabled ncryptsec input as a nonempty `ncryptsec`-prefixed value at config time, leaving full authenticated NIP-49 decoding to startup; keep diagnostics sanitized and never include the encrypted value or password. Update JSON closed-field validation, recursive environment mapping, and config-relative path resolution so only path-bearing modes are resolved. Add `NIXSTR_WRITABLE_SIGNER_NCRYPTSEC` consistently with the current environment leaf contract, while documenting JSON as the preferred encrypted-secret source.

Create `src/runtime/password_prompt.ts` as a small injectable boundary with a production implementation over `Deno.stdin`/`Deno.stderr`. When stdin is a terminal, write the prompt to stderr, call `Deno.stdin.setRaw(true)` before reading, collect a bounded UTF-8 line without echo (handling Enter, backspace, Ctrl-C/EOF), and restore raw mode in `finally`, including after read/decode errors. When stdin is not a terminal, read exactly one bounded newline-terminated password from stdin so supervised startup can supply it, without echo-control claims; reject empty input, EOF before a password, invalid UTF-8, and excess length with sanitized errors. Do not use `prompt()`, command execution such as `stty`, terminal escape hacks, or add a password-prompt dependency: Deno's `isTerminal()`, `setRaw()`, byte reads, and `finally` restoration are the secure built-in facility available here. Make reader/writer/terminal operations injectable so TTY echo suppression, restoration on every exit path, non-TTY input, byte bounds, and absence of password output are deterministic tests rather than manual-only behavior.

Extend `SignerCapabilityOptions` with an injected password request used only by ncryptsec mode. Decrypt via the locked import `nostr-tools/nip49`, require exactly 32 returned bytes, immediately construct `PrivateKeySigner` from a copy, and zero temporary/decrypted buffers on success and failure using the capability's existing ownership discipline. Map malformed ciphertext/wrong password to `invalid_source` and prompt/terminal inability to a clear sanitized startup failure (add a dedicated failure code if needed); do not echo the exception text from the crypto library or secret inputs. Wire production daemon startup to the secure prompt implementation without changing local or NIP-46 behavior, signer-derived ownership binding, async read availability, or publication readiness gates.</action>
  <verify>
    <automated>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts tests/integration/ncryptsec_signer_test.ts</automated>
  </verify>
  <done>The ncryptsec signer is a closed, validated third signer mode; its password is acquired through a tested echo-suppressing/bounded stdin boundary, the locked NIP-49 API unlocks it, failures are secret-safe and fail closed, and successful startup uses the existing signer ownership/publication capability.</done>
</task>

<task type="auto">
  <name>Task 2: Document encrypted-key startup and run the complete repository gate</name>
  <files>config.example.json, README.md, .env.example</files>
  <action>Extend operator documentation without disturbing the current dirty nested-config/read-cache edits. Show the ncryptsec JSON signer shape, explain that daemon startup reads one unlock password from stdin, terminal input disables echo and restores terminal state, and non-terminal stdin supports supervised input but must be supplied through an operator-chosen secure secret channel. State that the password is neither a config field nor logged or persisted, that invalid/missing input leaves writes unavailable, and that an interactive password makes unattended systemd startup unsuitable unless stdin is deliberately provided. Include the environment leaf only as part of the complete configuration reference and warn that process environments may expose even encrypted material; never add a real ncryptsec or password to tracked examples.

Run the focused tests and `deno task verify`, then use targeted searches to confirm no password value enters logging, config, state, or diagnostic objects and no unmasked generic prompt is used. Inspect `git diff --check` and `git status --short` to ensure all pre-existing dirty work remains and no secret fixture/config was added. Do not stage or commit.</action>
  <verify>
    <automated>deno task verify &amp;&amp; git diff --check</automated>
  </verify>
  <done>Operators can configure and safely unlock the signer with clear interactive/non-interactive constraints, all tests and repository gates pass, no secret is logged or persisted, and the shared worktree remains uncommitted and intact.</done>
</task>

</tasks>

<verification>
- Locked API proof: `nostr-tools@2.19.4` exports `decrypt(ncryptsec: string, password: string): Uint8Array` from `nostr-tools/nip49`; tests import that subpath directly and exercise correct/wrong passwords.
- Focused gate: `deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts tests/integration/ncryptsec_signer_test.ts`
- Full gate: `deno task verify`
- Secret/hygiene review: targeted `rg` for password logging/persistence and generic prompt use, followed by `git diff --check` and `git status --short`; do not stage or commit.
</verification>

<threat_model>
## Trust Boundaries

| Boundary | Risk | Required control |
|---|---|---|
| Operator config to NIP-49 decoder | Malformed or attacker-supplied encrypted key consumes work or exposes error details | Closed signer schema, bounded config input, locked decoder, sanitized failure |
| Terminal/stdin to daemon memory | Password echo, unbounded input, stuck raw terminal, or secret retention | TTY raw mode, bounded reads, `finally` restoration, injected tests, shortest practical lifetime |
| Decrypted key to signer capability | Key copies survive failure/shutdown or wrong identity becomes writable | Exact 32-byte check, owned-buffer zeroing, existing derived-owner binding and readiness gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-gte-01 | Information Disclosure | password prompt and diagnostics | high | mitigate | Disable TTY echo with `setRaw`, never interpolate secrets, bound and discard password input after decrypt |
| T-gte-02 | Denial of Service | stdin and NIP-49 input | medium | mitigate | Bound password/config lengths, reject EOF/invalid input clearly, perform one startup attempt |
| T-gte-03 | Tampering | decrypted signer identity | high | mitigate | Reuse signer-derived pubkey and durable owner binding before enabling PUT/publication |
| T-gte-04 | Information Disclosure | decrypted key lifecycle | high | mitigate | Zero owned temporary and retained byte arrays on all failure and close paths |
</threat_model>

<source_audit>
- GOAL — Accept a configured ncryptsec signer and securely unlock it from stdin at startup: Tasks 1-2.
- REQ — Hidden echo on TTY, non-TTY stdin support, clear fail-closed errors, no password logging/storage, injectable prompting, and locked dependency API verification: Task 1 behavior/action/verification and Task 2 documentation/audit.
- RESEARCH — No new dependency is needed: locked `nostr-tools@2.19.4` provides `nip49.decrypt(string, string): Uint8Array`, and Deno provides `stdin.isTerminal()`, `stdin.setRaw()`, and byte reads.
- CONTEXT — Current nested writable config, signer-derived ownership, dirty worktree, and commit-free execution are preserved; no deferred BUD-15 work is introduced (NIP-49 protects the signing key, not Hashtree content).
</source_audit>

<success_criteria>
- `ncryptsec` is a validated signer mode with an encrypted-string source and no ambiguous path/source combination.
- TTY passwords are not echoed and terminal mode is restored on success, EOF, cancellation, and error; non-TTY stdin is bounded and testable.
- Correct NIP-49 credentials produce the existing ready/sign/publish capability; wrong, malformed, or unavailable credentials fail closed without exposing secrets.
- Passwords never enter configuration objects, logs, diagnostics, persistent state, or long-lived capability fields, and decrypted key buffers are zeroed on failure/close.
- Focused and complete verification pass without reverting, staging, or committing any shared dirty-worktree changes.
</success_criteria>
