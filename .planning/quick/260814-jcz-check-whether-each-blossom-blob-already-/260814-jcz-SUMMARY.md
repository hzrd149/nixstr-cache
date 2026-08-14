---
quick_id: 260814-jcz
status: complete
commit: dcb70cd
completed: 2026-08-14
---

# Quick Task 260814-jcz Summary

Blossom publication now performs a pinned BUD-01 HEAD request for each blob. A
200 response skips upload authorization, file opening, and PUT; a 404 follows
the existing streamed upload path. Other statuses and transport failures fail
closed. Both paths retain the complete streamed GET and SHA-256 proof before a
replica receives credit.

The pinned HTTP/1.1 transport now handles HEAD response framing without trying
to consume the resource-sized `Content-Length` as a response body. Publication
fixtures and tests cover the preflight and prove that a second publication of
the same blob does not issue another PUT or authorization request.

## Verification

- Focused Blossom publication suite: 6 passed.
- `deno task lint`, `deno task check`, 52 protocol tests, 164 integration tests,
  and both stock-Nix E2E tests pass.
- The aggregate `deno task verify` wrapper stops only because the unrelated
  untracked user file `config copy.json` is not formatted; it was left untouched.
