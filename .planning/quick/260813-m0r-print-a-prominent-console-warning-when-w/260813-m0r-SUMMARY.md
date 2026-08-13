---
quick_id: 260813-m0r
status: complete
completed: 2026-08-13
subsystem: operator-diagnostics
tags: [signer, writable, diagnostics, nbunksec]
---

# Quick Task 260813-m0r Summary

Added a dedicated, prominent multi-line console warning for durable writable
owner mismatches. It states that `writable.enabled` was honored, explains why
PUT is disabled, displays the configured and durable canonical public cache
identities, documents the fail-closed anti-takeover behavior, and cautions the
operator against casually deleting state.

The warning is emitted at the exact identity-binding failure point before the
signer is closed. The durable ownership invariant and generic write activation
failure behavior remain unchanged.

Regression coverage proves the production nbunksec startup mismatch path emits
the warning and closes the remote session, and the diagnostic formatter remains
closed and secret-safe. Focused formatting, linting, type checking, 11
integration tests, and `git diff --check` all pass. No commit or STATE.md update
was made because the repository is a shared dirty worktree with another agent.
