---
quick_id: 260813-ecz
type: quick
status: ready
files_modified:
  - main.ts
  - src/config/config.ts
  - tests/integration/operator_config_test.ts
  - config.example.json
  - deno.json
  - .gitignore
  - README.md
---

<objective>
Add an explicitly selected JSON configuration source while preserving environment-only startup: `--config <path>` loads native JSON arrays and numbers, resolves file-owned paths relative to the config file, then applies supported environment variables field-by-field as the final overrides before the existing side-effect-free validation boundary.

Locked decisions: JSON and `config.example.json` are the runtime/example format (D-01); selection is only through `--config <path>` and environment fields override file fields (D-02); JSON collections and numeric settings use native arrays and numbers (D-03); `deno task dev` loads ignored `config.json` copied from the example (D-04).
</objective>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Load, merge, resolve, and validate one JSON-config startup path</name>
  <files>main.ts, src/config/config.ts, tests/integration/operator_config_test.ts</files>
  <behavior>
    - With `--config <path>`, a JSON object using native arrays for list fields and native numbers for ports, byte ceilings, publication controls, and nested limits reaches the same validated daemon configuration as equivalent environment strings per D-01 and D-03.
    - Relative `databasePath`, `spoolDirectory`, `localKeyPath`, `nip46SessionPath`, and `stagingDirectory` values from JSON resolve against the selected config file's directory before existing absolute-owner-path validation; absolute file paths remain unchanged, while environment-provided owner paths retain the existing absolute-path requirement.
    - Every defined supported environment value replaces the corresponding file value, including one nested `limits` member without discarding sibling file limits, per D-02; absent environment values leave file values intact, and no `--config` preserves current environment-only behavior.
    - Missing `--config` operands, unsupported arguments, unreadable files, malformed JSON, non-object roots, wrong native JSON field types, and invalid merged values fail deterministically before relay creation, listener binding, or daemon-owned filesystem creation.
  </behavior>
  <action>Start with focused failing integration tests, then adapt the configuration boundary without introducing a second validator. Broaden `RawConfig` only as needed to represent both legacy environment strings and the native JSON values mandated by D-03: list-bearing fields accept arrays of strings, numeric fields and `limits` members accept numbers, and scalar text fields remain strings. Update `parseConfig` through small shared coercion helpers so both representations receive the same trimming, cardinality, uniqueness, URL, integer, ceiling, signer, and aggregate validations; reject mixed/non-string arrays and non-number JSON numeric values with field-specific diagnostics rather than relying on incidental methods or JavaScript coercion. Preserve all current environment inputs, defaults, diagnostics semantics, immutable validated output, and validation-before-side-effects.

In `main.ts`, add an exported, dependency-injectable startup-config loader used by `import.meta.main`. Parse only the exact CLI forms of no arguments or `--config <path>` (D-02), read and parse the selected JSON object, resolve only file-sourced owner-path fields against the absolute parent directory of the selected config path, collect the existing allow-listed environment mapping, and merge environment values over file values. Merge the nested `limits` object member-by-member so one environment override does not erase unrelated JSON limits. Keep file I/O and argument/config errors ahead of `launchDaemon`; render actionable diagnostics and exit nonzero from the executable path. Do not auto-discover `config.json`, read arbitrary environment names, resolve relative environment paths, mutate the parsed JSON object, or move runtime side effects into config parsing.

Extend `tests/integration/operator_config_test.ts` around the exported production loader and `launchDaemon` hooks. Cover a temp-directory JSON file with arrays, numbers, nested limits, and relative owner paths; exact per-field and nested environment precedence; no-argument env-only compatibility; absolute path preservation; malformed CLI/file/type/value failures; and zero relay/listener/filesystem startup effects after invalid loaded configuration. Use injected readers where practical and real temp files for path-base behavior.</action>
  <verify>
    <automated>deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts &amp;&amp; deno fmt --check main.ts src/config/config.ts tests/integration/operator_config_test.ts &amp;&amp; deno lint main.ts src/config/config.ts tests/integration/operator_config_test.ts &amp;&amp; deno check main.ts tests/integration/operator_config_test.ts</automated>
  </verify>
  <done>The shipped entry path supports explicit JSON loading with native types, config-relative owner paths, member-wise environment precedence, and unchanged env-only operation; every load, merge, or validation failure occurs before daemon startup side effects (D-01, D-02, D-03).</done>
</task>

<task type="auto">
  <name>Task 2: Ship the example, local dev task, ignore rule, and operator documentation</name>
  <files>config.example.json, deno.json, .gitignore, README.md</files>
  <action>Create committed `config.example.json` as valid JSON using native arrays and numbers per D-01 and D-03. Include a coherent read-only configuration that documents the supported shape, including nested limits, without secrets or a real publisher identity; because JSON has no comments, use obvious replace-me values while keeping types accurate. Update `deno.json` so `deno task dev` invokes `main.ts --config config.json` with the existing watch and permissions, per D-04; keep `start` compatible with explicit operator arguments rather than implicitly selecting a file. Add root `config.json` to `.gitignore` without ignoring the example.

Revise `README.md` with a concise configuration section covering: copying `config.example.json` to `config.json`; running `deno task dev`; production invocation with `deno task start -- --config /path/to/config.json`; native JSON list/number syntax; environment-over-file precedence including member-wise `limits`; relative file paths resolving from the config file directory; environment path values still needing to be absolute; and continued env-only startup when `--config` is omitted. Retain the NixOS environment-variable guidance and clearly distinguish it from JSON operation.</action>
  <verify>
    <automated>deno eval 'const value=JSON.parse(await Deno.readTextFile("config.example.json")); if (!Array.isArray(value.cacheIdentities) || !Array.isArray(value.relayUrls) || typeof value.bindPort !== "number" || typeof value.limits?.maxRedirects !== "number") throw new Error("example must use native JSON types")' &amp;&amp; deno task fmt &amp;&amp; deno task lint &amp;&amp; deno task check</automated>
  </verify>
  <done>`config.example.json` is committed and parseable with native JSON types, local `config.json` is ignored, `deno task dev` explicitly loads it, and operators can understand selection, precedence, relative paths, and env-only compatibility from the README (D-01, D-02, D-03, D-04).</done>
</task>

</tasks>

<verification>
Focused: `deno test --allow-env --allow-read=.,/tmp --allow-write=/tmp tests/integration/operator_config_test.ts`

Full: `deno task verify`

Also inspect `deno task dev --help` only if needed to diagnose argument forwarding; do not start the long-running daemon as an acceptance gate. Confirm the final diff contains no tracked `config.json` or credentials.
</verification>

<source_audit>
- GOAL — JSON config loading, explicit CLI selection, overrides, path resolution, example/dev/docs/tests: covered by Tasks 1-2.
- REQ — Preserve environment-only behavior and validation-before-side-effects: covered and directly tested in Task 1.
- RESEARCH — Existing Deno/TypeScript entry and native JSON support require no new dependency: covered by using built-in argument, filesystem, path, and JSON APIs.
- CONTEXT — D-01 through D-04: each is cited and implemented; no deferred item is included.
</source_audit>

<success_criteria>
- `--config <path>` is the only file-selection mechanism, and omitting it retains the current environment-only path.
- JSON accepts native arrays and numbers, rejects wrong types with useful diagnostics, and feeds the existing validated configuration contract.
- File-relative owner paths resolve against the config file directory; environment owner paths remain subject to the existing absolute-path rule.
- Supported environment values win field-by-field, including nested limit members, without erasing unrelated file settings.
- Invalid CLI, file, JSON, merged, or domain configuration cannot create runtime side effects.
- The committed example, ignored local copy convention, dev task, README, focused tests, and full verification all agree on the shipped behavior.
</success_criteria>
