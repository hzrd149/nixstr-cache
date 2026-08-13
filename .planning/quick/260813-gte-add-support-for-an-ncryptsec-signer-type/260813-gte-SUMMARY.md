---
quick_id: 260813-gte
status: complete
completed: 2026-08-13
subsystem: signer
tags: [nip49, ncryptsec, password-signer, tty]
key_files:
  created:
    - src/runtime/password_prompt.ts
    - tests/integration/ncryptsec_signer_test.ts
  modified:
    - main.ts
    - src/config/config.ts
    - src/runtime/daemon.ts
    - src/signer/capability.ts
    - tests/integration/operator_config_test.ts
    - config.example.json
    - README.md
    - .env.example
---

# Quick Task 260813-gte Summary

Added a closed `ncryptsec` writable signer mode backed by the locked Applesauce `PasswordSigner`, with bounded echo-suppressing terminal input, supervised stdin support, sanitized fail-closed startup, and explicit decrypted-key zeroing before lock/close.

## Implementation

- Extended JSON and recursive environment configuration with the mutually exclusive `ncryptsec` signer source.
- Added an injectable stdin/stderr password boundary that uses Deno raw terminal mode and restores it in `finally`.
- Wired daemon startup to request one password only for enabled `ncryptsec` mode.
- Used `PasswordSigner.fromNcryptsec`; because its `lock()` only clears its key reference, the capability explicitly fills the owned key bytes with zero before locking.
- Preserved existing signer-derived ownership, event signing, readiness, and PUT gates.
- Documented interactive and supervised startup constraints without adding real secrets.

## Verification

- Focused config and ncryptsec suite: 29 passed, 0 failed.
- Protocol suite: 23 passed, 0 failed.
- Full integration suite: 117 passed, 0 failed.
- `deno check` passed for the application and focused tests.
- `git diff --check` passed.
- The aggregate `deno task verify` stopped at its initial format gate because concurrent pre-existing edits in `src/runtime/daemon.ts` around `EligibilityModel` are not formatted. A targeted lint likewise reports the pre-existing unused `batchScheduler` in that same concurrent section. Those unrelated shared-worktree edits were intentionally left untouched.
- Secret hygiene searches found no password logging/persistence and no generic `prompt()` use.

## Deviations from Plan

- Used the user-preferred locked `applesauce-signers@6.2.2` `PasswordSigner` instead of calling `nostr-tools/nip49.decrypt` directly. Exact installed API inspection showed it supports `fromNcryptsec`, unlock, signing, and lock; explicit byte zeroing was added to strengthen its reference-only lock behavior.
- No commits were created, as required for the shared dirty worktree.

## Known Stubs

None.
