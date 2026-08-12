# nixstr-cache NixOS VM example

The repository flake exposes `packages.<system>.vm`, a disposable QEMU VM built
from [`example-vm.nix`](./example-vm.nix) on top of `nixosModules.default` in
[`module.nix`](./module.nix). It runs the daemon as a hardened `DynamicUser`
systemd service and forwards it to the host.

## Build and run locally

```sh
nix run path:.#vm -- -nographic
```

The explicit `path:.` form includes untracked files while developing the
example; after the `nix/` directory is committed, `nix run .#vm` works too. Quit
QEMU with <kbd>Ctrl-a</kbd>, then <kbd>x</kbd>. The VM keeps no disk image, so
every boot starts from a clean `/var/lib/nixstr-cache`.

Once systemd reaches its target, the cache answers on the host:

```sh
curl --fail http://127.0.0.1:8787/nix-cache-info
```

```
StoreDir: /nix/store
WantMassQuery: 1
Priority: 40
```

Log in on the console as `nixstr` / `nixstr` to inspect the service:

```sh
systemctl status nixstr-cache
journalctl -u nixstr-cache -f
```

## Point it at a real publisher

The example ships an all-zero placeholder pubkey, so it serves a valid but
permanently empty merged cache. Substituting anything real requires two matched
changes:

1. Set `services.nixstr-cache.settings.NIXSTR_CACHE_IDENTITIES` to a publisher
   you trust — `17091:<64-hex-pubkey>:` for a default cache, or
   `37091:<64-hex-pubkey>:<name>` for a named one. Multiple comma-separated
   identities merge in the order given.
2. Append that publication's exact `<cache-name>:<base64-public-key>` to
   `nix.settings.trusted-public-keys`. Nix verifies signatures itself, so the
   daemon cannot make an untrusted path substitutable.

Reaching relays through the VM's NAT also needs working DNS, which the default
QEMU user networking provides.

## Deploy to an existing NixOS machine

Copy [`example-vm.nix`](./example-vm.nix) into your own flake, drop the
QEMU-only `virtualisation` block and the plaintext demonstration user, add the
target's hardware configuration, and keep `NIXSTR_BIND_HOST` on loopback unless
other machines need to substitute from it. A minimal consumer looks like this:

```nix
{
  inputs.nixstr-cache.url = "github:hzrd149/nixstr-cache";

  outputs = { nixpkgs, nixstr-cache, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        nixstr-cache.nixosModules.default
        ./configuration.nix
        {
          services.nixstr-cache = {
            enable = true;
            settings = {
              NIXSTR_CACHE_IDENTITIES = "17091:<64-hex-pubkey>:";
              NIXSTR_RELAY_URLS = "wss://relay.example.com";
              NIXSTR_PREFERRED_BLOSSOM_URL = "https://blossom.example.com";
            };
          };

          nix.settings = {
            substituters = [ "http://127.0.0.1:8787" ];
            trusted-public-keys = [ "<cache-name>:<base64-public-key>" ];
          };
        }
      ];
    };
  };
}
```

## Enabling the writable overlay

The read path needs no secrets. A signer-gated writable cache does, and those
must never be written into `settings`, which lands in the world-readable Nix
store. Provision the signing material out of band and reference it by path:

```nix
services.nixstr-cache = {
  environmentFile = "/run/secrets/nixstr-cache.env";
  settings = {
    NIXSTR_SIGNER_MODE = "local"; # or "nip46"
    NIXSTR_WRITABLE_IDENTITY = "37091:<64-hex-pubkey>:<name>";
    NIXSTR_STAGING_DIRECTORY = "/var/lib/nixstr-cache/staging";
    NIXSTR_LOCAL_KEY_PATH = "/var/lib/nixstr-cache/signer.key";
  };
};
```

The daemon accepts exactly the protected source matching the mode:
`NIXSTR_LOCAL_KEY_PATH` for `local`, `NIXSTR_NIP46_SESSION_PATH` for `nip46`.
Supplying both, or either one while `NIXSTR_SIGNER_MODE` is `disabled`, is
rejected at startup with a printed diagnostic.
