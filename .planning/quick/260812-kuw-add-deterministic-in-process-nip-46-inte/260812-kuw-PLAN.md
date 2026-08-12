---
quick_id: 260812-kuw
type: quick
status: ready
files_modified:
  - tests/fixtures/nostr_connect.ts
  - tests/integration/nip46_signer_test.ts
---

<objective>
Replace Phase 03's sole human-needed verification item with deterministic automated evidence that the shipped daemon's Applesauce `NostrConnectSigner` and `RelayPool` boundary authorizes exactly the configured owner, fails closed, sanitizes diagnostics, and releases its network lifecycle on shutdown.
</objective>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Exercise the production NIP-46 lifecycle against an in-process signer</name>
  <files>tests/fixtures/nostr_connect.ts, tests/integration/nip46_signer_test.ts</files>
  <behavior>
    - A daemon launched in NIP-46 mode with an owner-only `nbunksec` file begins read-only, completes the real encrypted NIP-46 connect/auth/get-public-key exchange through a loopback relay, requests only `get_public_key` and `sign_event:17091` or `sign_event:37091`, and enables PUT only when the returned user pubkey exactly owns the configured writable identity.
    - When the remote signer returns a different user pubkey, the daemon remains read-only and closes the signer connection; when authorization or connection fails, PUT remains 405 and no staging side effect occurs.
    - Daemon shutdown closes the production `NostrConnectSigner` subscription and its `RelayPool` idempotently; captured observable diagnostics contain none of the `nbunksec`, client private key, bunker secret, authorization URL/token, encrypted request content, or raw remote error.
  </behavior>
  <action>Create a reusable, minimal loopback NIP-01 WebSocket fixture following the existing `Deno.serve` plus `Deno.upgradeWebSocket` pattern in `tests/e2e/nix_substitution_test.ts`. Give the fixture a real remote `PrivateKeySigner`; accept the production client's `REQ` and kind-24133 `EVENT` frames; acknowledge published events with `OK`; verify and NIP-44-decrypt requests; and publish verified, NIP-44-encrypted kind-24133 responses addressed to the client. Implement only the NIP-46 methods needed by the production lifecycle (`connect` and `get_public_key`) plus configurable auth-required, auth-denied/connection-failed, and returned-owner outcomes. For an auth-required request, send the standard `auth_url` response and then deterministically complete or deny the same request after recording that the headless callback was reached. Record subscription, method, connect-permission, socket-open/close, and request-count facts behind bounded wait helpers; never expose fixture key material through failure messages. Generate the `nbunksec` with the installed `NostrConnectSigner.createNbunksec` API from ephemeral remote/client keys and the fixture relay URL, store it with mode `0600`, and remove the temp tree in `finally`.

Add focused integration tests that call `launchDaemon` with production dependencies: inject only the existing publication-event stream and HTTP bind hooks needed to isolate unrelated cache-publication traffic, while leaving production NIP-46 signer construction, `RelayPool`, session parsing, signer capability, ownership comparison, write-readiness computation, handler, and shutdown untouched. Configure a valid staging directory, publication relay, and Blossom destination so signer state is the discriminating readiness condition. Capture the bound handler immediately to prove PUT returns `405` while connecting; after the matching 17091 and named 37091 auth flows reach ready, prove a valid stock-Nix PUT route is no longer rejected as disabled. In separate fresh fixture/daemon instances, return a mismatched pubkey and deny/fail authorization, then prove PUT stays `405`, no staged route/bytes appear, and the signer socket closes where the lifecycle terminates. Finally call daemon shutdown twice and assert the signer subscription/socket and fixture server close without leaked pending work.

Temporarily capture `console.warn`/`console.error` around each lifecycle and restore them in `finally`; serialize captured arguments and assert they contain none of per-test sentinel session material, client key, bunker secret, full auth URL/token, encrypted payload, or remote denial text, while allowing only the production generic authorization notice and sanitized signer state behavior. Use explicit sub-second/low-second deadlines for every readiness and close assertion so protocol regressions fail deterministically instead of hanging. Do not add internet access, sleep-based timing assumptions, a fake `PublicKeySigner`, a test-only bypass in `src/`, cache-root signing/publication, or any dependency. Keep the fixture byte/control traffic bounded and close all WebSockets, HTTP servers, subscriptions, daemon resources, repositories, and temp files in failure paths.</action>
  <verify>
    <automated>deno test --allow-env --allow-net=127.0.0.1 --allow-read=.,/tmp --allow-write=/tmp tests/integration/nip46_signer_test.ts &amp;&amp; deno fmt --check tests/fixtures/nostr_connect.ts tests/integration/nip46_signer_test.ts &amp;&amp; deno lint tests/fixtures/nostr_connect.ts tests/integration/nip46_signer_test.ts &amp;&amp; deno check tests/fixtures/nostr_connect.ts tests/integration/nip46_signer_test.ts &amp;&amp; deno task test:integration</automated>
  </verify>
  <done>WRIT-02 and the Phase 03 human-needed truth have automated production-boundary evidence for relay/auth/ownership readiness, mismatch, auth/connection failure, secret-safe diagnostics, and terminal signer/pool shutdown, using only deterministic in-process loopback services.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| owner-only `nbunksec` file to production signer | Secret client key and bunker authorization enter the real signer lifecycle and must not reach state, logs, or assertions. |
| loopback relay/signer to daemon | Signed but remote-controlled NIP-46 responses determine ownership readiness and must fail closed on mismatch, denial, malformed lifecycle, or disconnect. |
| signer readiness to HTTP PUT | Asynchronous authorization must enable mutation only after exact ownership and every existing readiness prerequisite hold. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-kuw-01 | Spoofing | NIP-46 relay response | high | mitigate | Fixture signs and encrypts real kind-24133 responses; tests prove exact returned-owner comparison before PUT enablement. |
| T-kuw-02 | Information Disclosure | signer diagnostics and test failures | high | mitigate | Sentinel secrets and auth/error payloads are negative-checked across captured diagnostics; fixture assertions report only safe counters/method names. |
| T-kuw-03 | Denial of Service | async signer connection/auth | medium | mitigate | Every transition and teardown assertion has a bounded deadline and all resources close in `finally`. |
| T-kuw-04 | Elevation of Privilege | readiness-to-PUT gate | high | mitigate | Matching, mismatch, auth-denied, and pre-ready cases all execute the shipped handler and assert mutation is reachable only in the matching ready state. |
| T-kuw-SC | Tampering | package supply chain | low | accept | No package install occurs; tests use exact dependencies already locked and approved in Phase 03. |
</threat_model>

<verification>
Run the focused test first, then the complete integration suite. Confirm the test imports and executes `launchDaemon` rather than injecting `createNip46Signer`, that all relay traffic stays on `127.0.0.1`, and that every daemon/fixture instance has bounded teardown in `finally`. Re-run Phase 03 verification after execution; the former human-needed item should cite this test as behavioral evidence and no longer require a live external signer.
</verification>

<success_criteria>
- The production Applesauce NIP-46 relay, encryption, auth callback, permission request, public-key ownership, readiness, handler, and shutdown path are all exercised without internet access.
- Matching default and named writable identities transition from PUT-disabled to enabled only after authorization and exact ownership.
- Mismatched ownership and connection/auth failure remain PUT-disabled and create no staging state.
- Shutdown demonstrably closes the signer subscription and pool-owned WebSocket, including idempotent repeated shutdown.
- Logs, observable diagnostics, and assertion output reveal no session secret, client key, bunker secret, auth URL/token, ciphertext, or raw remote error.
- `deno task test:integration` remains green, providing sufficient deterministic evidence to remove Phase 03's `human_needed` status on re-verification.
</success_criteria>
