{
  description = "A lightweight coding agent with minimal configuration, multi-provider LLM support, and an extensible architecture.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # nixpkgs unstable no longer supports Intel macOS. Keep using the final
    # Darwin branch that does so for pi's x86_64-darwin package.
    nixpkgs-darwin-x64.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-darwin-x64,
    }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      nixpkgsFor =
        system:
        (if system == "x86_64-darwin" then nixpkgs-darwin-x64 else nixpkgs).legacyPackages.${system};
      inherit (nixpkgs) lib;

      forAllSystems = lib.genAttrs systems;

      perSystem =
        system:
        let
          pkgs = nixpkgsFor system;
          source = self;
          nodejs = pkgs.nodejs_22;
          packageJson = pkgs.lib.importJSON "${source}/packages/coding-agent/package.json";
          pi = pkgs.callPackage ./nix/package.nix {
            inherit
              source
              nodejs
              packageJson
              ;
            platforms = systems;
          };
        in
        {
          inherit pkgs pi;
        };
    in
    {
      packages = forAllSystems (system: {
        default = (perSystem system).pi;
        pi = (perSystem system).pi;
      });

      apps = forAllSystems (system: rec {
        default = pi;
        pi = {
          type = "app";
          program = lib.getExe (perSystem system).pi;
          meta.description = (perSystem system).pi.meta.description;
        };
      });

      overlays.default = final: _previous: {
        pi = final.callPackage ./nix/package.nix {
          source = self;
          platforms = systems;
        };
      };
    };
}
