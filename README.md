# nixstr-cache

Phase 1 exposes a read-only Nix HTTP binary cache backed by a verified Nostr
publication and bounded Blossom Hashtree traversal. The reproducible full-stack
acceptance gate is:

```sh
deno task test:nix-e2e
```

It requires exactly Nix 2.34.7 and uses only loopback listeners, temporary
source/destination stores, temporary SQLite state, and child processes. Run the
complete Phase 1 matrix with `deno task verify`.

For a daemon assembled with the runtime dependencies from `src/app.ts`, set
`NIXSTR_BIND_HOST`, `NIXSTR_BIND_PORT`, `NIXSTR_PUBLISHER_PUBKEYS`,
`NIXSTR_RELAY_URLS`, and optionally `NIXSTR_PREFERRED_BLOSSOM_URL`. Configure
stock Nix with only that endpoint and the publication's exact key:

```sh
nix-store --realise /nix/store/<hash>-<name> \
  --option substituters http://127.0.0.1:8787 \
  --option trusted-public-keys '<cache-name>:<base64-public-key>' \
  --option fallback false --option require-sigs true
```

Publisher URLs remain SSRF-restricted. An operator-configured local Blossom
origin is allowed only by exact origin match. A cryptographically mismatching
origin is quarantined durably; after investigating and correcting that server,
release it explicitly through `BlobFetcher.release("https://origin.example")`.
There is no automatic quarantine expiry and Phase 1 exposes no PUT capability.
