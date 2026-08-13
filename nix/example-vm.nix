{
  config,
  lib,
  pkgs,
  ...
}:

{
  # This is a complete demonstration VM, not a production server baseline.
  services.nixstr-cache = {
    enable = true;
    openFirewall = true;

    settings = {
      NIXSTR_BIND_HOST = "0.0.0.0";
      NIXSTR_BIND_PORT = "8787";

      # Placeholder default-cache identity (kind 17091, empty identifier).
      # Replace the all-zero pubkey with a publisher you actually trust; until
      # then the daemon serves a valid but permanently empty merged cache.
      NIXSTR_CACHES = "0000000000000000000000000000000000000000000000000000000000000000";

      NIXSTR_RELAY_URLS = "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net";
    };
  };

  # Wire the daemon in as a substituter the way a real consumer would. Nix only
  # accepts store paths whose signatures it trusts, so a publication's exact
  # `<cache-name>:<base64-public-key>` has to be appended to trusted-public-keys
  # before anything substitutes; with the placeholder identity above there is
  # nothing to trust yet.
  nix.settings = {
    substituters = [ "http://127.0.0.1:${config.services.nixstr-cache.settings.NIXSTR_BIND_PORT}" ];
    fallback = true;
  };

  # Startup diagnostics are the daemon's contract for bad configuration, so make
  # them visible on the console of this demonstration VM instead of only in the
  # journal.
  systemd.services.nixstr-cache.serviceConfig = {
    StandardOutput = "journal+console";
    StandardError = "journal+console";
  };

  environment.systemPackages = [ pkgs.curl ];

  # Console credentials for this disposable demonstration VM.
  # Do not copy this plaintext password into a production configuration.
  users.users.nixstr = {
    isNormalUser = true;
    initialPassword = "nixstr";
    extraGroups = [ "wheel" ];
  };
  security.sudo.wheelNeedsPassword = false;

  # `nix run .#vm` forwards the cache to 127.0.0.1:8787 on the host.
  virtualisation = {
    graphics = false;
    memorySize = 2048;
    cores = 2;
    # Keep the demonstration disposable instead of creating a qcow2 image.
    diskImage = null;
    forwardPorts = [
      {
        from = "host";
        proto = "tcp";
        host.address = "127.0.0.1";
        host.port = lib.toInt config.services.nixstr-cache.settings.NIXSTR_BIND_PORT;
        guest.port = lib.toInt config.services.nixstr-cache.settings.NIXSTR_BIND_PORT;
      }
    ];
  };

  networking.hostName = "nixstr-cache-vm";
  system.stateVersion = "26.05";
}
