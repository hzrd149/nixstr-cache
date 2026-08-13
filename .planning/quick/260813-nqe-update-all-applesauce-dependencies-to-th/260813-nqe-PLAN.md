---
quick_id: 260813-nqe
type: quick
status: ready
autonomous: true
commit: true
files_modified:
  - deno.json
  - deno.lock
---

<objective>
Update every direct Applesauce dependency to the exact alpha build
`0.0.0-next-20260813160224`, regenerate the Deno lockfile from the changed
manifest, and prove that the unified prerelease package set remains compatible
with the complete daemon test matrix.

Purpose: Consume the coordinated Applesauce bug-fix build without leaving a
mixed stable/prerelease dependency graph or an out-of-date lockfile.
Output: Updated `deno.json` and freshly resolved `deno.lock`, committed as one
atomic dependency update by the executor.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Pin the complete Applesauce family, refresh the lock, validate, and commit</name>
  <files>deno.json, deno.lock</files>
  <action>Change all five direct Applesauce import-map entries—`applesauce-core`, `applesauce-common`, `applesauce-loaders`, `applesauce-relay`, and `applesauce-signers`—to exact npm specifiers ending in `@0.0.0-next-20260813160224`. Keep every non-Applesauce dependency unchanged and do not add, remove, or rename package aliases. Regenerate `deno.lock` through Deno dependency resolution from the updated `deno.json`; do not hand-edit integrity hashes or retain stale stable-version Applesauce specifiers/workspace roots. Run `deno task check` first so API or type incompatibilities are surfaced immediately, then run the complete `deno task verify` gate. Inspect the resulting diff to confirm only `deno.json` and `deno.lock` changed, every direct Applesauce alias resolves to the requested exact build, the lockfile workspace dependency list matches the manifest, and the lock contains the resolved prerelease package graph. If all gates pass, create one executor commit containing both files with a dependency-update message; do not amend or combine it with unrelated work.</action>
  <verify>
    <automated>deno task check &amp;&amp; deno task verify &amp;&amp; deno eval 'const j=JSON.parse(await Deno.readTextFile("deno.json")); const v="0.0.0-next-20260813160224"; const names=["applesauce-core","applesauce-common","applesauce-loaders","applesauce-relay","applesauce-signers"]; for (const n of names) if (j.imports[n] !== `npm:${n}@${v}`) throw new Error(`${n} is not pinned to ${v}`);' &amp;&amp; git diff --check</automated>
  </verify>
  <done>All five direct Applesauce imports use exactly `0.0.0-next-20260813160224`, `deno.lock` is freshly resolved and consistent with `deno.json`, all repository Deno validation passes, and the executor has committed the two-file update atomically.</done>
</task>

</tasks>

<verification>
- `deno task check` proves the prerelease APIs type-check across application and test entry points.
- `deno task verify` runs formatting, linting, type checking, protocol tests, integration tests, and stock-Nix end-to-end tests.
- The manifest assertion proves the five direct Applesauce aliases all use the requested exact build.
- Diff inspection and `git diff --check` prove the dependency update is scoped and mechanically clean before the executor commits it.
</verification>

<source_audit>
- GOAL — Upgrade the complete direct Applesauce family to the coordinated alpha bug-fix build: Task 1.
- REQ — Exact version pinning, lockfile refresh, Deno validation, and executor commit: Task 1 action, automated verification, and done criteria.
- RESEARCH — Not applicable in quick mode; this changes versions of five existing direct packages and introduces no new package identity.
- CONTEXT — The project remains on Deno/TypeScript and Applesauce; non-Applesauce dependencies and application behavior remain unchanged.
</source_audit>

<success_criteria>
- No direct Applesauce dependency remains on a stable 6.x version or a different prerelease build.
- Deno resolves and records a coherent lock graph for the exact requested build.
- The complete repository verification task passes without source changes.
- `deno.json` and `deno.lock` are committed together by the executor in one atomic commit.
</success_criteria>
