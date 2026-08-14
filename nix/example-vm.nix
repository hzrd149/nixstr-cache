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

      # Add NIXSTR_CACHES when this VM should read trusted published caches.
      # Add NIXSTR_EXTRA_RELAYS only for relays beyond discovered NIP-65 outboxes.
      # With neither setting, cache-path requests return 503 until writes are
      # configured and the signer overlay contains data.
    };
  };

  # Wire the daemon in as a substituter the way a real consumer would. Nix only
  # accepts store paths whose signatures it trusts, so a publication's exact
  # `<cache-name>:<base64-public-key>` has to be appended to trusted-public-keys
  # before anything substitutes; this empty example has nothing to trust yet.
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
