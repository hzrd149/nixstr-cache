---
status: resolved
trigger: "deno task dev does not visibly prompt for the configured ncryptsec password"
created: 2026-08-13
updated: 2026-08-13
---

# ncryptsec prompt not visible

## Symptoms

- Expected: startup clearly states that the signer is locked and requests its password.
- Actual: no durable prompt was visible during `deno task dev`.
- Reproduction: start the watch task with an enabled ncryptsec signer.

## Evidence

- A PTY reproduction emitted the original inline prompt and then immediately failed with `AddrInUse` on port 8787.
- PID 1072599 currently owns `127.0.0.1:8787`.
- Deno watch clears/redraws terminal output, making the inline prompt easy to miss during the immediate failure.

## Resolution

- root_cause: The prompt lacked a durable explanatory line, and an existing daemon caused immediate startup failure on the configured port.
- fix: Emit a full locked-signer explanation on its own line followed by `Password: `; retain raw-mode echo suppression.
- verification: Focused ncryptsec suite passes 4/4; formatting, lint, and diff checks pass; PTY reproduction shows the new message.
- files_changed: `src/runtime/password_prompt.ts`, `tests/integration/ncryptsec_signer_test.ts`
