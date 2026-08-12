---
quick_id: 260812-hsi
status: complete
files_modified:
  - NIP.md
---

# NIP narinfo Sig passthrough clarification

Updated `NIP.md` so `nixSigKey` declares publisher endorsement rather than an
exhaustive set of signatures permitted in `.narinfo` records. Gateways now
preserve all syntactically valid `Sig` fields unchanged and in order, and
compatible multi-cache records concatenate every source signature without
declaration-based filtering.

Also aligned unsigned-cache, key-rotation, and downgrade wording with those
semantics.

## Verification

- `git diff --check`
- Targeted searches for the removed exhaustive-key, signature-free unsigned
  cache, and key-removal implications
- Manual review of the complete `NIP.md` diff

`deno fmt --check NIP.md` was not applicable because Deno fmt does not process
Markdown and reported `No target files found.`
