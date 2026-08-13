self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.nixstr-cache;

  # An empty value here means "not configured in the Nix store"; the setting may
  # still arrive from environmentFile, which this module cannot read.
  setting = name: cfg.settings.${name} or "";
  configuredOutOfStore = cfg.environmentFile != null;
in
{
  options.services.nixstr-cache = {
    enable = lib.mkEnableOption "nixstr-cache Nix binary cache daemon";

    package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "nixstr-cache" { };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether to open the configured nixstr-cache TCP port in the firewall.
        Only enable this when the cache should serve other machines; the daemon
        binds to loopback by default.
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/nixstr-cache.env";
      description = ''
        Environment file containing additional `NIXSTR_*` settings or secrets.
        Values set here override {option}`settings`, which enters the
        world-readable Nix store.
      '';
    };

    settings = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = lib.literalExpression ''
        {
          NIXSTR_BIND_HOST = "0.0.0.0";
          NIXSTR_CACHES = "<64-lowercase-hex-pubkey-or-npub>";
          NIXSTR_RELAY_URLS = "wss://relay.example.com,wss://nos.lol";
          NIXSTR_PREFERRED_BLOSSOM_URL = "https://blossom.example.com";
        }
      '';
      description = ''
        `NIXSTR_*` environment variables passed to the daemon. The daemon reads
        its entire configuration from this namespace and refuses to start with a
        printed diagnostic when a value is missing or invalid.

        At minimum `NIXSTR_CACHES` and `NIXSTR_RELAY_URLS` are required.
        Cache identities accept a bare lowercase hex pubkey or `npub` for a
        default cache, and a kind-37091 `naddr` for a named cache. The
        module defaults `NIXSTR_BIND_HOST`, `NIXSTR_BIND_PORT`,
        `NIXSTR_DATABASE_PATH`, and `NIXSTR_SPOOL_DIRECTORY`.

        Enabling the writable overlay additionally requires
        `NIXSTR_WRITABLE_ENABLED=true`, `NIXSTR_WRITABLE_TYPE` (`root` or
        `named`), `NIXSTR_WRITABLE_SIGNER_TYPE` (`nip46` or `local`),
        `NIXSTR_WRITABLE_STAGING_DIRECTORY` (for example
        `/var/lib/nixstr-cache/staging`), and the absolute path of exactly the
        protected source in `NIXSTR_WRITABLE_SIGNER_PATH`. This file holds signing material, so
        provision them outside the Nix store and keep them readable by the
        service user only.

        Secret values must be supplied through {option}`environmentFile`
        because everything set here enters the world-readable Nix store.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    services.nixstr-cache.settings = {
      NIXSTR_BIND_HOST = lib.mkDefault "127.0.0.1";
      NIXSTR_BIND_PORT = lib.mkDefault "8787";
      NIXSTR_DATABASE_PATH = lib.mkDefault "/var/lib/nixstr-cache/state.sqlite";
      NIXSTR_SPOOL_DIRECTORY = lib.mkDefault "/var/lib/nixstr-cache/spool";
    };

    assertions = [
      {
        assertion = configuredOutOfStore || setting "NIXSTR_RELAY_URLS" != "";
        message = ''
          services.nixstr-cache.settings.NIXSTR_RELAY_URLS must list at least
          one wss:// or ws:// relay URL, or be supplied through
          services.nixstr-cache.environmentFile.
        '';
      }
      {
        assertion =
          configuredOutOfStore
          || setting "NIXSTR_CACHES" != "";
        message = ''
          services.nixstr-cache requires at least one cache identity in
          settings.NIXSTR_CACHES, or an
          services.nixstr-cache.environmentFile that supplies one.
        '';
      }
    ];

    networking.firewall.allowedTCPPorts = lib.optional cfg.openFirewall (
      lib.toInt cfg.settings.NIXSTR_BIND_PORT
    );

    systemd.services.nixstr-cache = {
      description = "nixstr-cache Nix binary cache daemon";
      documentation = [ "https://github.com/hzrd149/nixstr-cache" ];
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = cfg.settings // {
        DENO_DIR = "/var/cache/nixstr-cache/deno";
      };
      restartTriggers = [ cfg.environmentFile ];

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
        StateDirectory = "nixstr-cache";
        StateDirectoryMode = "0700";
        CacheDirectory = "nixstr-cache";
        WorkingDirectory = "/var/lib/nixstr-cache";
        UMask = "0077";

        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RestrictSUIDSGID = true;
      }
      // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      };
    };
  };
}
