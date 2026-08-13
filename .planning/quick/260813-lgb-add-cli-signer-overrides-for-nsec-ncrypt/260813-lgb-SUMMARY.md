---
quick_id: 260813-lgb
status: complete
completed: 2026-08-13
subsystem: cli-signing
tags: [cli, signer, nsec, ncryptsec, nbunksec]
---

# Quick Task 260813-lgb Summary

Added strict per-run `--signer` overrides for nsec, ncryptsec, and nbunksec,
backed by Applesauce signer constructors. Overrides replace only signer
selection and require an otherwise complete enabled writable configuration.

Daemon launch is now asynchronous. Effective ncryptsec signers unlock, derive
their public key, and bind durable ownership before the HTTP listener opens.
TTY password failures retry until cancellation; piped input remains one-shot;
all failures dispose initialized resources without binding.

Verification completed successfully: formatting, linting, full type checking,
23 protocol tests, 127 integration tests, and both stock-Nix E2E tests. The
implementation was kept uncommitted because another agent was concurrently
editing shared runtime and write-activation files; their changes were preserved
and the pre-bind gate was integrated only after those files stabilized.
