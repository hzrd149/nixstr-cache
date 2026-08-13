---
quick_id: 260813-ftf
type: quick
status: ready
files_modified:
  - main.ts
  - src/config/config.ts
  - tests/integration/operator_config_test.ts
  - tests/integration/http_cache_test.ts
  - tests/integration/address_pinning_test.ts
  - tests/e2e/nix_substitution_test.ts
  - tests/e2e/nix_publication_roundtrip_test.ts
  - README.md
  - .env.example
  - nix/module.nix
  - nix/example-vm.nix
  - nix/VM-EXAMPLE.md
---

<objective>
Make `caches` the sole read-cache input with `NIXSTR_CACHES` as its environment
variable. Remove the old cache identity and publisher fallback inputs entirely.
</objective>

<tasks>
<task type="auto" tdd="true">
  <name>Remove legacy inputs from runtime and tests</name>
  <action>Remove RawConfig.publisherPubkeys, NIXSTR_PUBLISHER_PUBKEYS, NIXSTR_CACHE_IDENTITIES, and JSON publisherPubkeys. Require caches directly and update all configuration-facing tests and E2E environments.</action>
  <verify>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts</verify>
</task>
<task type="auto">
  <name>Update operator interfaces and docs</name>
  <action>Document and deploy NIXSTR_CACHES only in examples, templates, and Nix assertions.</action>
  <verify>deno fmt --check &amp;&amp; deno lint &amp;&amp; deno check</verify>
</task>
</tasks>
