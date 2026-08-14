# nixstr-cache

`nixstr-cache` publishes and retrieves Nix binary caches through Nostr and
Blossom while presenting a normal HTTP binary cache to Nix.

Each publisher announces the current cache root in a signed Nostr event. The
root points to an immutable BUD-18 Hashtree whose manifests, `.narinfo` files,
and NARs are stored as SHA-256-addressed Blossom blobs. `nixstr-cache` verifies
the event and tree, merges the configured publishers in priority order, and
serves the result at `http://127.0.0.1:8787`. Stock Nix needs no Nostr or
Blossom support.

When writing is enabled, `nix copy` uploads to the same HTTP endpoint. The
daemon builds a new Hashtree, copies all required blobs to one of the signer's
BUD-03 Blossom servers, and only then publishes the new signed root to Nostr.

## Run it

The packaged application can be run from a checkout with Nix:

```sh
nix run . -- --config "$PWD/config.json"
```

For development, install Deno 2.9 and run:

```sh
cp config.example.json config.json
deno task dev
```

`config.json` is ignored by Git. Relative state, signer, and staging paths are
resolved relative to the configuration file.

## Read a published cache

Create a minimal `config.json`:

```json
{
  "bindHost": "127.0.0.1",
  "bindPort": 8787,
  "caches": ["npub1PUBLISHER"],
  "databasePath": "data/state.sqlite"
}
```

`caches` accepts:

- A lowercase 64-character pubkey or `npub` for the publisher's default kind
  `17091` cache.
- A kind `37091` `naddr` for a named cache.
- Multiple identities, ordered from highest to lowest priority.

The daemon discovers publisher outbox relays and BUD-03 Blossom servers through
the default bootstrap relays. `caches` and `extraRelays` are optional; use
`extraRelays` only for additional Nostr relays and `extraServers` for ordered,
read-only Blossom fallbacks. `bootstrapRelays` defaults to public discovery
relays, but an explicitly configured list must not be empty. With no read-cache
identities, cache-path requests return `503` until a writable overlay is ready.

Check that the local cache is available:

```sh
curl --fail http://127.0.0.1:8787/nix-cache-info
```

## Configure Nix

Add the daemon and the Nix public key declared by the publisher to
`/etc/nix/nix.conf`:

```conf
substituters = https://cache.nixos.org http://127.0.0.1:8787
trusted-public-keys = cache.nixos.org-1:... <cache-name>:<base64-public-key>
```

Keep any substituters and keys you already trust. Restart `nix-daemon` after
editing a multi-user installation. On NixOS the equivalent is:

```nix
nix.settings = {
  substituters = [ "http://127.0.0.1:8787" ];
  trusted-public-keys = [ "<cache-name>:<base64-public-key>" ];
};
```

Nix can now retrieve paths through `nixstr-cache` as it would from any HTTP
binary cache:

```sh
nix build nixpkgs#hello
```

Nix still verifies every configured binary-cache signature. The Nostr signature
authenticates the publisher and Hashtree root; it does not replace Nix's own
trust configuration.

## Publish a cache

Publishing requires two independent keys:

- A Nostr signer, which owns and publishes the cache-root event.
- A Nix binary-cache key, which signs uploaded `.narinfo` records for Nix.

Generate the Nix key pair once:

```sh
nix-store --generate-binary-cache-key my-cache-1 \
  /run/secrets/my-cache.private /run/secrets/my-cache.public
```

Publish a BUD-03 kind `10063` server-list event for the Nostr signer so the
daemon knows which Blossom servers it may upload to. Then enable the writable
cache in `config.json`:

```json
{
  "bindHost": "127.0.0.1",
  "bindPort": 8787,
  "databasePath": "data/state.sqlite",
  "writable": {
    "enabled": true,
    "type": "root",
    "signer": {
      "type": "local",
      "path": "/run/secrets/nostr-secret-key"
    },
    "staging": {
      "directory": "data/staging"
    },
    "publication": {
      "nixSigKeys": ["my-cache-1:<base64-public-key>"]
    }
  }
}
```

The writable cache does not need to be repeated in `caches`, and publication
relays do not need to be repeated in `extraRelays`. After the signer connects,
the daemon queries its kind `10002` NIP-65 relay list through the bootstrap
relays. Writes become ready only after that effective relay set and at least one
valid BUD-03 Blossom destination are both available. A write-ready cache returns
`404` for misses until content is uploaded, then serves admitted content from
the signer overlay.

The local signer file contains the raw 32-byte Nostr secret key and should be
readable only by the daemon. `nip46`, `ncryptsec`, and `nbunksec` signers are
also supported; see `config.example.json` and `nix/VM-EXAMPLE.md` for deployment
options. Use `"type": "named"` with `"name": "my-cache"` to publish a named kind
`37091` cache.

Wait for `/health` to report that writes are ready, then upload a store path and
its closure using the Nix private key:

```sh
nix copy --to \
  'http://127.0.0.1:8787?secret-key=/run/secrets/my-cache.private' \
  /nix/store/<hash>-<name>
```

Accepted uploads are immediately visible through the local writable overlay.
They are batched into a new immutable Hashtree and announced after Blossom
replication succeeds.

## NixOS service

The flake exports `nixosModules.default`. A minimal read-only service is:

```nix
{
  inputs.nixstr-cache.url = "github:hzrd149/nixstr-cache";

  outputs = { nixpkgs, nixstr-cache, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        nixstr-cache.nixosModules.default
        {
          services.nixstr-cache = {
            enable = true;
            # Add settings.NIXSTR_CACHES to read trusted published caches.
            # The empty service starts successfully and returns 503 for misses.
          };
        }
      ];
    };
  };
}
```

Do not put signer material in `settings`, because Nix stores it world-readably.
Use `services.nixstr-cache.environmentFile` or protected files outside the Nix
store. See [`nix/VM-EXAMPLE.md`](./nix/VM-EXAMPLE.md) for a complete NixOS
example and [`config.example.json`](./config.example.json) for the baseline
configuration and resource limits.
