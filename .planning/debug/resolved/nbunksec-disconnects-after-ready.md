---
status: resolved
trigger: "There seems to be an issue with the nbunksec signer in the background. it initially connects and fetches the pubkey but then disconnects and causes the write feature to break."
created: 2026-08-13T14:46:25Z
updated: 2026-08-13T15:52:00Z
---

# Symptoms

- expected: An inline or CLI nbunksec signer remains connected after resolving its public key, and write capability stays ready.
- actual: Startup logs signer_connecting, then signer_ready, then signer_disconnected less than one second later, followed by write_activation_failed.
- errors: No underlying exception is logged in the supplied output.
- timeline: Observed after adding inline nbunksec and CLI signer override support.
- reproduction: Run `deno run --allow-env --allow-net --allow-read --allow-write main.ts --config config.json` with the current writable nbunksec signer and existing `data/state.sqlite.writes`.

# Current Focus

- hypothesis: Confirmed: durable writable-owner mismatch throws after signer readiness; the catch closes the signer and suppresses the cause.
- test: Compare the public key returned by the configured NIP-46 session with `writable_owner.identity` in the write database, and trace the `signerReady` catch path.
- expecting: The keys differ and `WriteRepository.bindIdentity()` throws `WriteIdentityMismatch` before write activation.
- next_action: Decide separately whether operator diagnostics should expose the sanitized mismatch and how intentional signer migration should be performed.
- reasoning_checkpoint: The disconnect is daemon-initiated cleanup, not an upstream relay disconnect.
- tdd_checkpoint: Diagnosis only; no test or production behavior changed.

# Evidence

- timestamp: 2026-08-13T15:48:00Z
  observation: `signerReady` calls `assertIdentity()`, then `writeRepository.bindIdentity()`, and its catch unconditionally calls `signer.close()` while discarding the exception.
  implication: Any identity-binding failure produces ready, disconnected, then write_activation_failed with no useful cause.
- timestamp: 2026-08-13T15:49:00Z
  observation: `data/state.sqlite.writes` is bound to `17091:4a4fbc5f593f09b6878bb34206e3a864deb23221cfc5d5383193cafec22272f5:`.
  implication: The repository will reject any other signer owner by design.
- timestamp: 2026-08-13T15:52:00Z
  observation: A bounded direct NIP-46 handshake using the configured nbunksec returned public key `266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5` and closed cleanly.
  implication: NIP-46 connectivity works, but the returned owner differs from the durable owner.
- timestamp: 2026-08-13T15:52:00Z
  observation: `WriteRepository.bindIdentity()` throws `WriteIdentityMismatch("durable writable identity mismatch")` when an existing owner differs.
  implication: This is the precise post-ready exception that triggers daemon-owned signer shutdown.

# Eliminated

- hypothesis: The remote signer or relay spontaneously disconnects immediately after returning the public key.
  reason: A direct handshake returned the public key and closed cleanly; application code explicitly closes the signer on the subsequent binding exception.
- hypothesis: The nbunksec cannot be decoded or authorized.
  reason: `fromNbunksec()` connected successfully and returned the configured account public key.

# Resolution

- root_cause: The write database is durably bound to pubkey `4a4f...72f5`, while the configured nbunksec resolves to pubkey `2668...08a5`. The anti-owner-change invariant throws after the signer reaches ready. The daemon catches that exception, closes the signer, and emits only the generic write_activation_failed diagnostic, making the intentional cleanup appear to be a background disconnect.
- fix: Not applied; the user requested investigation. A safe follow-up should improve the sanitized diagnostic and define an explicit operator migration/reset path rather than weakening the durable ownership invariant.
- verification: Direct configured nbunksec handshake succeeded and returned `2668...08a5`; read-only SQLite inspection showed the conflicting durable owner `4a4f...72f5`; source tracing proves the thrown mismatch feeds the observed log sequence.
- files_changed: Only this debug artifact.
