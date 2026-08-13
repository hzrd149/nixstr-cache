---
quick_id: 260813-frn
type: quick
status: ready
files_modified:
  - main.ts
  - src/config/config.ts
  - tests/integration/operator_config_test.ts
  - config.example.json
  - README.md
---

<objective>
Rename the JSON and RawConfig read-cache field from `cacheIdentities` to
`caches`, including indexed diagnostics and documentation, while preserving the
established `NIXSTR_CACHE_IDENTITIES` environment variable and canonical
ValidatedConfig output.
</objective>

<tasks>
<task type="auto" tdd="true">
  <name>Rename the configuration boundary field and tests</name>
  <files>main.ts, src/config/config.ts, tests/integration/operator_config_test.ts</files>
  <action>Rename all raw and JSON field handling to caches, map the existing environment variable into it, reject the old JSON key as unknown, and update indexed diagnostics and tests.</action>
  <verify>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts</verify>
</task>
<task type="auto">
  <name>Update examples and documentation</name>
  <files>config.example.json, README.md</files>
  <action>Use caches in JSON examples and explanatory text while leaving environment-variable documentation unchanged.</action>
  <verify>deno fmt --check &amp;&amp; deno lint &amp;&amp; deno check main.ts tests/integration/operator_config_test.ts</verify>
</task>
</tasks>
