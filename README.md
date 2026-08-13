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
`NIXSTR_BIND_HOST`, `NIXSTR_BIND_PORT`, `NIXSTR_CACHES`, `NIXSTR_EXTRA_RELAYS`,
and optionally `NIXSTR_PREFERRED_BLOSSOM_URL`. Configure stock Nix with only
that endpoint and the publication's exact key:

```sh
nix-store --realise /nix/store/<hash>-<name> \
  --option substituters http://127.0.0.1:8787 \
  --option trusted-public-keys '<cache-name>:<base64-public-key>' \
  --option fallback false --option require-sigs true
```

## Configuration

The daemon can load an explicitly selected JSON configuration file. For local
development, copy the example and start the watched task:

```sh
cp config.example.json config.json
deno task dev
```

`config.json` is ignored. JSON list fields use arrays and numeric fields use
numbers; see [`config.example.json`](./config.example.json) for the complete
read-only shape. Relative `databasePath`, `spoolDirectory`,
`writable.signer.path`, and `writable.staging.directory` values resolve from the
directory containing the selected configuration file.

Each `caches` entry may be a bare lowercase 64-character pubkey or an `npub` for
a default cache, or a kind-37091 `naddr` for a named cache. Canonical
`17091:<hex>:` and `37091:<hex>:<name>` strings remain compatible. Entries are
normalized internally and retain their array order as cache priority; aliases of
the same identity are rejected as duplicates. Relay hints embedded in an `naddr`
are ignored. Publisher NIP-65 outboxes are discovered through `bootstrapRelays`
and combined with operator-controlled `extraRelays`.

Writes use one nested `writable` object. Missing configuration or
`{"enabled":false}` is read-only and ignores every other writable member. An
enabled cache selects `type: "root"`, or `type: "named"` with a valid `name`,
plus `signer: {type: "local"|"nip46", path}` or
`signer: {type: "ncryptsec", ncryptsec: "ncryptsec1..."}` or
`signer: {type: "nbunksec", nbunksec: "nbunksec1..."}`,
`staging: {directory,
bodyBytes?, aggregateBytes?}`, and publication policy. The
publisher pubkey is always derived from the connected signer; it is never
configured. Environment leaves use `NIXSTR_WRITABLE_*` and recursively override
only their matching JSON leaves. There are no aliases for the removed flat
settings: migrate all values atomically. Changing signer or root/named identity
against existing durable write state fails closed; use an explicitly fresh
state/staging location rather than migrating pending publication data
automatically.

An enabled `ncryptsec` signer asks for its unlock password before the HTTP
listener is opened. On a terminal, input echo is disabled, incorrect passwords
prompt again, and terminal mode is restored after every attempt. Non-terminal
stdin accepts one bounded, newline-terminated attempt for supervised startup;
supply it through a secure secret channel chosen by the operator. The password
is not a configuration field and is never logged or persisted. Missing,
malformed, cancelled, or incorrect non-terminal input aborts startup without
opening the server. An interactive password is therefore unsuitable for
unattended systemd startup unless stdin is deliberately and securely provided.
JSON is preferred for the encrypted `ncryptsec` value. The corresponding
`NIXSTR_WRITABLE_SIGNER_NCRYPTSEC` environment leaf exists for completeness, but
process environments may expose even encrypted material.

For a one-run signer override, pass an `nsec`, `ncryptsec`, or `nbunksec` in
either supported form:

```sh
deno task start -- --config /path/to/config.json --signer ncryptsec1...
deno task start -- --signer=nbunksec1...
```

`--signer` replaces only the configured signer. The configuration must still
contain an enabled writable cache with its root/named identity, staging, and
publication policy. An `nsec` signs locally, an `ncryptsec` uses the same
mandatory pre-listener password flow, and an `nbunksec` uses NIP-46 while the
read server starts normally and PUT remains unavailable until authorization. CLI
arguments may be visible in shell history and process listings, so the daemon
prints a warning and operators should prefer protected configuration for
long-lived deployments. Signer values are never repeated in logs or errors.

For production, select a file explicitly:

```sh
deno task start -- --config /path/to/config.json
```

Supported `NIXSTR_*` environment values override JSON field-by-field. Limit
overrides merge member-by-member, so setting `NIXSTR_LIMIT_MAX_REDIRECTS` does
not discard other values under JSON `limits`. Environment-provided owner paths
must remain absolute; they are not resolved relative to the JSON file.

Omitting `--config` retains environment-only startup. This remains the intended
mode for the NixOS module described below; no `config.json` is auto-discovered.

## Nix packaging

The flake packages the daemon with
[deno2nix](https://github.com/hzrd149/deno2nix) and ships a NixOS module and a
disposable demonstration VM:

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
    NIXSTR_CACHES = "<64-lowercase-hex-pubkey-or-npub>";
    NIXSTR_EXTRA_RELAYS = "wss://relay.example.com";
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
