{
  pkgs,
  nodejs,
  treefmtWrapper,
}:
let
  inherit (pkgs.lib) getExe;
in
pkgs.mkShell {
  packages = [
    nodejs
    pkgs.git
    pkgs.biome
    treefmtWrapper
  ];

  shellHook = ''
    export BIOME_BINARY="${getExe pkgs.biome}"
    git config core.hooksPath .husky
  '';
}
