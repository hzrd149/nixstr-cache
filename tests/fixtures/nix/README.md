# Stock Nix fixture contract

The end-to-end test creates its fixture reproducibly at runtime with the pinned
supported stock Nix release (2.34.7 in the original fixture contract; 2.35.1 is
also accepted for environments carrying the compatible patch-forward CLI). It
adds a directory containing the UTF-8 file `payload` with contents
`nixstr-cache walking slice\n` to a fresh `local?root=...` source store,
generates an ephemeral `nixstr-e2e-1` binary-cache key, and uses `nix copy` to
produce a signed file cache. The private key stays in the test's mode-0700
temporary directory and is deleted with that directory; only the public key is
passed to the isolated destination Nix processes.

The generated `.narinfo` and compressed NAR are SHA-256 addressed, placed under
canonical BUD-16 directory manifests encoded by `@msgpack/msgpack@3.1.3`, and
published by a freshly signed kind `17091` event. The test records every relay,
Blossom, and daemon request. This deliberately avoids a static private key while
still making fixture provenance, inputs, and protocol revisions auditable.

Protocol basis: NIP.md plus BUD-16, BUD-17, and BUD-18 revisions recorded in
`tests/fixtures/bud/README.md`. Regenerate by running `deno task test:nix-e2e`;
the test fails unless `nix --version` is one of the explicitly accepted stock
Nix versions.
