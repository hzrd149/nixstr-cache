# nixstr-cache

Phase 1 exposes a read-only Nix HTTP binary cache backed by a verified Nostr
publication and bounded Blossom Hashtree traversal. The reproducible full-stack
acceptance gate is:

```sh
deno task test:nix-e2e
```

It requires exactly Nix 2.34.7 and uses only loopback listeners, temporary
source/destination stores, temporary SQLite state, and child processes. Run the
complete Phase 1 matrix with `deno task verify`. Tests bind ephemeral loopback
ports and create all state below the platform temporary directory; the Deno
tasks grant network access only to `127.0.0.1`, repository read access,
temporary read/write access, and (for the E2E only) execution of `nix`,
`nix-store`, and the pinned Deno runtime.

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

## Nix packaging

The flake packages the daemon with [deno2nix](https://github.com/hzrd149/deno2nix)
and ships a NixOS module and a disposable demonstration VM:

```sh
nix build .#nixstr-cache   # wrapped `deno run` with vendored dependencies
nix run .#vm -- -nographic # demonstration VM, forwarded to 127.0.0.1:8787
nix develop                # deno plus the Nix version the E2E gate asserts
```

`nixosModules.default` exposes `services.nixstr-cache` as a hardened
`DynamicUser` systemd service. Configuration passes through as `NIXSTR_*`
environment variables, with `NIXSTR_BIND_HOST`, `NIXSTR_BIND_PORT`,
`NIXSTR_DATABASE_PATH`, and `NIXSTR_SPOOL_DIRECTORY` defaulted by the module:

```nix
services.nixstr-cache = {
  enable = true;
  settings = {
    NIXSTR_CACHE_IDENTITIES = "17091:<64-hex-pubkey>:";
    NIXSTR_RELAY_URLS = "wss://relay.example.com";
  };
};
```

Anything in `settings` enters the world-readable Nix store, so signing material
for the writable overlay belongs in `environmentFile` or in files referenced by
absolute path. See [`nix/VM-EXAMPLE.md`](./nix/VM-EXAMPLE.md) for the full
walkthrough, including how to match `trusted-public-keys` to a publication.

Publisher URLs remain SSRF-restricted. An operator-configured local Blossom
origin is allowed only by exact origin match. A cryptographically mismatching
origin is quarantined durably; after investigating and correcting that server,
release it explicitly through `BlobFetcher.release("https://origin.example")`.
There is no automatic quarantine expiry and Phase 1 exposes no PUT capability.
