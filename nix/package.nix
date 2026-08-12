{
  pkgs,
  src,
  version,
}:
let
  inherit (pkgs) lib;

  nixstr-cache = pkgs.buildDenoApplication {
    pname = "nixstr-cache";
    inherit version src;

    entrypoint = "main.ts";
    denoDepsHash = "sha256-CDc7jLnPG6RVIAs5ACIKKBue30i2T3jYwDYXZIq3xYM=";

    runFlags = [
      # Resolve dependencies from the vendor/ and node_modules/ trees installed
      # beside the application rather than from DENO_DIR, which is empty on a
      # fresh machine and unwritable under `--cached-only`. "manual" is required
      # because the store copy is read only.
      "--vendor=true"
      "--node-modules-dir=manual"

      # The daemon reads its whole configuration from NIXSTR_* environment
      # variables, serves HTTP while fetching relays and Blossom servers, and
      # keeps its SQLite state, spool, and staging directories on disk.
      "--allow-env"
      "--allow-net"
      "--allow-read"
      "--allow-write"
    ];

    meta = {
      description = "Nostr- and Blossom-backed Nix HTTP binary cache daemon";
      homepage = "https://github.com/hzrd149/nixstr-cache";
      license = lib.licenses.mit;
    };
  };
in
{
  default = nixstr-cache;
  inherit nixstr-cache;
  denoDeps = nixstr-cache.denoDeps;
}
