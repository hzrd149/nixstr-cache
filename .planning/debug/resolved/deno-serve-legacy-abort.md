---
status: resolved
trigger: "Deno.serve: request.signal aborts on successful responses (legacy behavior). To detect when a request has been fully delivered use the completed promise on the handler's info argument. Move cleanup to the handler's return path, or opt in to the new behavior with --unstable-no-legacy-abort."
created: 2026-08-13
updated: 2026-08-13
---

# Debug Session: Deno.serve legacy abort

## Symptoms

- expected: Successful streaming responses keep `request.signal` usable solely for genuine client cancellation.
- actual: Deno 2.9.5 reports that the daemon is relying on legacy successful-response abort behavior.
- errors: Deprecation warning recommending `ServeHandlerInfo.completed` or `--unstable-no-legacy-abort`.
- timeline: Observed on the current Deno 2.9.5 runtime; prior behavior is not known.
- reproduction: Start the daemon and serve a request through `Deno.serve`; the handler reads `request.signal`.

## Current Focus

- hypothesis: Confirmed: project configuration had not enabled Deno's corrected request abort semantics.
- test: Enabled the granular `no-legacy-abort` feature, ran a live `Deno.serve` probe, and ran focused static/integration checks.
- expecting: Met: no legacy-abort warning and no regression in streaming request handling.
- next_action: Resolved.

## Evidence

- timestamp: 2026-08-13
  finding: `src/nix/http_handler.ts` passes `request.signal` to upload, resolution, and fetch cancellation paths; response resource cleanup uses stream terminal handling rather than successful signal abort.
- timestamp: 2026-08-13
  finding: Deno's migration documentation recommends `unstable: ["no-legacy-abort"]` for code using the signal only for genuine cancellation.

## Eliminated

- hypothesis: The handler intentionally uses successful `request.signal` abort as its response-delivery cleanup hook.
  reason: Signer overlay cleanup is implemented by `releaseOnTerminal`, and request diagnostics are emitted in the handler return path.

## Resolution

- root_cause: Deno 2.9.5 retains legacy successful-response abort behavior by default, while the project reads `request.signal` for genuine cancellation.
- fix: Added `unstable: ["no-legacy-abort"]` to `deno.json` so every project task uses corrected semantics.
- verification: Live serve probe emitted no warning; formatting, lint, type checks, and 20 focused HTTP/writable-cache integration tests passed.
- files_changed: `deno.json`
