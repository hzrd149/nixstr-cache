---
quick_id: 260812-igi
type: quick
status: ready
files_modified:
  - main.ts
  - tests/integration/operator_config_test.ts
---

<objective>
Close the Phase 1 verifier gap by making the production entry collect every supported `NIXSTR_LIMIT_*` environment variable and by exercising that exact exported production collection-and-mapping boundary in integration tests.
</objective>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire and test the production limit-environment boundary</name>
  <files>main.ts, tests/integration/operator_config_test.ts</files>
  <behavior>
    - A non-default value supplied through each supported `NIXSTR_LIMIT_*` name is collected by the exported production entry boundary, mapped to the corresponding `RawConfig.limits` field, and accepted into the matching `ValidatedConfig.limits` field.
    - An invalid limit supplied through that same production boundary returns the expected configuration diagnostic and `launchDaemon` performs no relay, listener, filesystem, or other startup side effect.
  </behavior>
  <action>Refactor `main.ts` so the environment collection used by the `import.meta.main` branch is an exported, dependency-injectable production function rather than an inline allow-list that tests cannot call. Make that function collect the existing base and signer variables plus all 15 limit variables already understood by `rawConfigFromEnvironment`: manifest wire bytes, decoded metadata bytes, blob transfer bytes, request transfer bytes, request output bytes, traversal depth, links per node, unique manifest nodes, total decoded manifest bytes, source attempts, maximum redirects, connect timeout, idle timeout, total timeout, and concurrent fetches. Keep environment access narrowly allow-listed; do not enumerate or expose unrelated process variables. Have `import.meta.main` call this same exported function before `launchDaemon`, eliminating any duplicate production-only list that can drift from the tested path. Extend `tests/integration/operator_config_test.ts` to call the exported production collector with an injected environment reader, cover every supported limit name with distinct valid non-default values, pass the resulting raw config through `parseConfig`, and assert the exact camel-case `ValidatedConfig.limits` mapping. Add a discriminating invalid-limit case through the same collector and `launchDaemon` hooks, asserting the relevant diagnostic and zero relay/listener calls plus no filesystem creation. Preserve existing defaults, ceilings, strict numeric parsing, signer behavior, and startup ordering; this task changes only environment reachability and its regression coverage.</action>
  <verify>
    <automated>deno test --allow-env --allow-read --allow-write tests/integration/operator_config_test.ts &amp;&amp; deno fmt --check main.ts tests/integration/operator_config_test.ts &amp;&amp; deno lint main.ts tests/integration/operator_config_test.ts &amp;&amp; deno check main.ts tests/integration/operator_config_test.ts</automated>
  </verify>
  <done>The production `import.meta.main` path and the integration test share one exported environment collector; all 15 supported limit variables reach their exact validated fields; and an invalid production-entry override fails with diagnostics before any startup side effect.</done>
</task>

</tasks>

<verification>
Run the focused integration test and static gates. Review the diff to confirm `main.ts` has one authoritative production collection path, every `NIXSTR_LIMIT_*` key mapped by `rawConfigFromEnvironment` is reachable through it, and the tests invoke that exported boundary for both valid and invalid values.
</verification>

<success_criteria>
- Every supported `NIXSTR_LIMIT_*` environment variable is collected by the shipped entry point and maps to the correct `ValidatedConfig.limits` field.
- The regression test executes the same exported collector called by `import.meta.main`, so a future production allow-list omission fails the test.
- Invalid limit input from the production boundary produces configuration diagnostics before relay creation, listener binding, or filesystem state creation.
- Existing configuration defaults, ceilings, signer/write-intent handling, and daemon startup behavior remain unchanged.
</success_criteria>
