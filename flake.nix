{
  description = "nixstr-cache - Nostr/Blossom-backed Nix HTTP binary cache daemon";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    deno2nix.url = "github:hzrd149/deno2nix";
    deno2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      deno2nix,
    }:
    let
      systems = [
        "x86_64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f system (
            import nixpkgs {
              inherit system;
              overlays = [ deno2nix.overlays.default ];
            }
          )
        );

      # Exactly what `deno run main.ts` needs, listed explicitly so unrelated
      # files — planning notes, test fixtures, .env files, `nix build` result
      # symlinks — can never change the derivation or leak into the store.
      src = nixpkgs.lib.fileset.toSource {
        root = ./.;
        fileset = nixpkgs.lib.fileset.unions [
          ./main.ts
          ./deno.json
          ./deno.lock
          ./src
        ];
      };
    in
    {
      nixosModules = {
        nixstr-cache = import ./nix/module.nix self;
        default = self.nixosModules.nixstr-cache;
      };

      packages = forAllSystems (
        system: pkgs:
        (import ./nix/package.nix {
          inherit pkgs src;
          version = (builtins.fromJSON (builtins.readFile ./deno.json)).version;
        })
        // {
          # `nix run .#vm` — a disposable read-only demonstration VM.
          vm =
            (nixpkgs.lib.nixosSystem {
              modules = [
                { nixpkgs.hostPlatform = system; }
                "${nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"
                self.nixosModules.default
                ./nix/example-vm.nix
              ];
            }).config.system.build.vm;
        }
      );

      apps = forAllSystems (
        system: _pkgs: {
          default = {
            type = "app";
            program = "${self.packages.${system}.default}/bin/nixstr-cache";
            meta.description = "Run the nixstr-cache daemon";
          };
        }
      );

      devShells = forAllSystems (
        _system: pkgs: {
          default = pkgs.mkShell {
            # `deno task test:nix-e2e` drives a real Nix CLI and asserts an exact
            # supported version, so the shell provides one rather than relying on
            # whichever Nix happens to be on the host PATH. flake.lock pins this
            # to 2.35.1; widen the assertion in tests/e2e before bumping past a
            # version that test accepts.
            packages = [
              pkgs.deno
              pkgs.nixVersions.latest
            ];

            shellHook = ''
              echo "nixstr-cache dev shell"
              echo "  deno task dev"
              echo "  deno task verify"
              echo "  nix build .#nixstr-cache"
            '';
          };
        }
      );

      checks = forAllSystems (
        system: _pkgs: {
          package = self.packages.${system}.default;
        }
      );
    };
}
