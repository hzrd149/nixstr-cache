---
id: SEED-001
status: implemented
planted: 2026-08-12
planted_during: project initialization
trigger_when: when relevant
scope: unknown
---

# SEED-001: a simple way to test this project is to use the `nix` cli to read and write to the http cache api

## Why This Matters

_To be filled in. Run `$gsd-capture --seed --enrich SEED-001` to add context._

## When to Surface

**Trigger:** when relevant

This seed will surface during `$gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `$gsd-capture --seed --enrich SEED-001` to estimate effort.

## Breadcrumbs

- `NIP.md` — specifies presenting the cache through the standard Nix HTTP binary-cache store.
- `.planning/PROJECT.md` — requires end-to-end tests against the daemon's streamed GET/HEAD/PUT interface.

## Notes

Implemented in v1.0. `tests/e2e/nix_substitution_test.ts` exercises stock-Nix HTTP-cache reads and verified local reuse; `tests/e2e/nix_publication_roundtrip_test.ts` exercises stock-Nix uploads and publication across two distinct generations, deletes the source objects, and substitutes both back through the production daemon.
